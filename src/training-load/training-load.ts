/**
 * Charge d'entraînement : coût d'une séance, puis condition physique (CTL),
 * fatigue (ATL) et fraîcheur (TSB) qui en découlent.
 *
 * Module volontairement pur — aucune dépendance Nest ni Prisma — pour que les
 * conventions d'étalonnage ci-dessous soient testables ligne à ligne. Ce sont
 * des conventions, pas des mesures : toute charge renvoyée par ce module est
 * une estimation, et l'interface ne doit jamais la présenter autrement.
 */

// Coût en TSS d'une heure passée dans chaque zone FC, pour un athlète à cinq
// zones. Étalonnage usuel : une heure au seuil (haut de Z4) vaut 100. La
// progression est délibérément non linéaire — deux heures en Z1 ne fatiguent
// pas comme une heure en Z4.
const CANONICAL_ZONE_TSS_PER_HOUR = [30, 55, 75, 100, 120];

// Séance sans FC exploitable ni ressenti : on suppose de l'endurance
// fondamentale (Z2). Mieux vaut une estimation basse qu'un zéro, qui ferait
// plonger la CTL à chaque sortie faite sans capteur.
const FALLBACK_TSS_PER_HOUR = CANONICAL_ZONE_TSS_PER_HOUR[1];

// En dessous de cette part de la durée de la séance couverte par des mesures
// de FC, la trace est trop trouée pour que la charge FC veuille dire quelque
// chose (ceinture décrochée en cours de route, capteur oublié).
const MIN_HEART_RATE_COVERAGE = 0.5;

// Foster : charge perçue = RPE (1-10) × durée en minutes, en unités
// arbitraires. Ce facteur la ramène sur l'échelle TSS pour qu'elle soit
// mélangeable avec la charge FC — une heure à RPE 8 vaut à peu près une heure
// au seuil, donc 100.
const PERCEIVED_AU_TO_TSS = 100 / (8 * 60);

// Constantes de temps des deux moyennes exponentielles (Banister). 42 jours
// pour la condition, 7 pour la fatigue : c'est ce qui fait qu'une grosse
// semaine se paie tout de suite en fatigue et ne se gagne que lentement en
// condition.
export const CTL_TIME_CONSTANT_DAYS = 42;
export const ATL_TIME_CONSTANT_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TrainingLoadSource = 'HEART_RATE' | 'PERCEIVED' | 'DURATION';

export interface SessionLoadInput {
  durationSec: number;
  // Secondes passées dans chaque zone FC, index 0 = Z1. Vide quand l'athlète
  // n'a pas de zones synchronisées ou que la séance n'a pas de trace FC.
  secondsByZone?: readonly number[];
  // Activity.difficultyNote — RPE de 1 à 10 saisi par l'athlète.
  difficultyNote?: number | null;
}

export interface SessionLoad {
  load: number;
  source: TrainingLoadSource;
  // Les deux estimations restent exposées séparément : leur écart est en
  // lui-même un signal (ressenti qui grimpe à charge objective constante).
  heartRateLoad: number | null;
  perceivedLoad: number | null;
}

/**
 * Coût horaire de chaque zone pour un athlète en ayant `zoneCount`.
 *
 * Strava autorise un nombre de zones variable : la courbe canonique à cinq
 * zones est rééchantillonnée linéairement sur le nombre réel, ce qui la rend à
 * l'identique dans le cas courant (cinq zones) tout en restant monotone
 * ailleurs.
 */
export function zoneLoadCoefficients(zoneCount: number): number[] {
  if (zoneCount <= 0) return [];
  // Une zone unique n'a pas d'intensité relative : on la place au milieu de la
  // courbe plutôt que d'extrapoler quoi que ce soit.
  if (zoneCount === 1) return [CANONICAL_ZONE_TSS_PER_HOUR[2]];

  const lastIndex = CANONICAL_ZONE_TSS_PER_HOUR.length - 1;
  return Array.from({ length: zoneCount }, (_, i) => {
    const position = (i * lastIndex) / (zoneCount - 1);
    const low = Math.floor(position);
    const high = Math.ceil(position);
    const ratio = position - low;
    return (
      CANONICAL_ZONE_TSS_PER_HOUR[low] * (1 - ratio) +
      CANONICAL_ZONE_TSS_PER_HOUR[high] * ratio
    );
  });
}

/** Charge d'une séance à partir du temps passé dans chaque zone FC. */
export function heartRateLoad(secondsByZone: readonly number[]): number {
  const coefficients = zoneLoadCoefficients(secondsByZone.length);
  return secondsByZone.reduce(
    (sum, seconds, index) => sum + (seconds / 3600) * coefficients[index],
    0,
  );
}

/** Charge perçue (sRPE de Foster), ramenée sur l'échelle TSS. */
export function perceivedLoad(rpe: number, durationSec: number): number {
  return rpe * (durationSec / 60) * PERCEIVED_AU_TO_TSS;
}

/**
 * Charge d'une séance, par ordre de préférence : FC mesurée, ressenti déclaré,
 * puis durée seule. La provenance est renvoyée avec la valeur — une charge
 * estimée sur la durée seule ne vaut pas une charge mesurée, et l'interface
 * doit pouvoir le dire.
 */
export function sessionLoad(input: SessionLoadInput): SessionLoad {
  const { durationSec, secondsByZone = [], difficultyNote } = input;

  const measuredSeconds = secondsByZone.reduce((sum, s) => sum + s, 0);
  const hasUsableHeartRate =
    secondsByZone.length > 0 &&
    durationSec > 0 &&
    measuredSeconds / durationSec >= MIN_HEART_RATE_COVERAGE;

  const fromHeartRate = hasUsableHeartRate
    ? heartRateLoad(secondsByZone)
    : null;
  const fromPerceived =
    difficultyNote != null && difficultyNote > 0
      ? perceivedLoad(difficultyNote, durationSec)
      : null;

  if (fromHeartRate != null) {
    return {
      load: fromHeartRate,
      source: 'HEART_RATE',
      heartRateLoad: fromHeartRate,
      perceivedLoad: fromPerceived,
    };
  }
  if (fromPerceived != null) {
    return {
      load: fromPerceived,
      source: 'PERCEIVED',
      heartRateLoad: null,
      perceivedLoad: fromPerceived,
    };
  }

  return {
    load: (durationSec / 3600) * FALLBACK_TSS_PER_HOUR,
    source: 'DURATION',
    heartRateLoad: null,
    perceivedLoad: null,
  };
}

export interface TrainingLoadPoint {
  // Jour civil UTC, au format YYYY-MM-DD.
  date: string;
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
  // false tant que la CTL n'a pas eu une constante de temps complète
  // d'historique pour se remplir : avant cela elle part de zéro et sous-estime
  // la condition.
  settled: boolean;
}

function toUtcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Facteur de lissage d'une moyenne exponentielle de constante `days`. */
function smoothingFactor(days: number): number {
  return 1 - Math.exp(-1 / days);
}

/**
 * Série jour par jour de CTL / ATL / TSB entre deux dates.
 *
 * Les jours sans entraînement comptent : c'est précisément leur charge nulle
 * qui fait redescendre la fatigue. La série est donc construite sur tous les
 * jours civils de l'intervalle, pas seulement ceux qui portent une activité.
 *
 * TSB du jour = CTL - ATL de la veille (convention Banister) : la fraîcheur du
 * matin reflète ce qui a été accumulé jusqu'à la veille au soir, pas la séance
 * qui n'a pas encore été faite.
 *
 * Le découpage en jours se fait en UTC, faute de fuseau stocké sur le profil
 * athlète : une séance courue après minuit en heure locale peut donc tomber la
 * veille. Sans effet sur les moyennes, qui lissent sur 7 et 42 jours.
 */
export function buildTrainingLoadSeries(
  dailyLoads: ReadonlyMap<string, number>,
  from: Date,
  to: Date,
): TrainingLoadPoint[] {
  const points: TrainingLoadPoint[] = [];
  const ctlFactor = smoothingFactor(CTL_TIME_CONSTANT_DAYS);
  const atlFactor = smoothingFactor(ATL_TIME_CONSTANT_DAYS);

  const firstDayMs = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const settledFromMs = firstDayMs + CTL_TIME_CONSTANT_DAYS * MS_PER_DAY;

  let ctl = 0;
  let atl = 0;

  for (let dayMs = firstDayMs; dayMs <= to.getTime(); dayMs += MS_PER_DAY) {
    const date = toUtcDayKey(new Date(dayMs));
    const load = dailyLoads.get(date) ?? 0;

    // Lu avant la mise à jour du jour : ce sont bien les valeurs de la veille.
    const tsb = ctl - atl;

    ctl += (load - ctl) * ctlFactor;
    atl += (load - atl) * atlFactor;

    points.push({
      date,
      load,
      ctl,
      atl,
      tsb,
      settled: dayMs >= settledFromMs,
    });
  }

  return points;
}
