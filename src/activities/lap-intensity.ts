import { LapIntensity, LapIntensitySource } from '../../generated/prisma/enums';

// Correspondance entre le champ `intensity` du message lap d'un fichier .fit et
// l'énumération stockée en base. Quand la montre l'écrit, c'est une donnée
// mesurée — mais beaucoup ne l'écrivent pas : les .fit Coros observés jusqu'ici
// laissent le champ absent sur tous leurs laps, d'où le repli de
// resolveFitLapIntensities sur l'estimation par les allures.
const FIT_INTENSITIES: Record<string, LapIntensity> = {
  active: LapIntensity.ACTIVE,
  rest: LapIntensity.REST,
  warmup: LapIntensity.WARMUP,
  cooldown: LapIntensity.COOLDOWN,
  recovery: LapIntensity.RECOVERY,
  interval: LapIntensity.INTERVAL,
  other: LapIntensity.OTHER,
};

export function mapFitLapIntensity(
  intensity: string | undefined,
): LapIntensity | undefined {
  return intensity ? FIT_INTENSITIES[intensity] : undefined;
}

export interface LapSpeedInput {
  distanceM: number;
  durationSec: number;
  avgSpeedMPerSec?: number;
}

export interface FitLapInput extends LapSpeedInput {
  intensity?: string;
}

// Intensité d'un lap et provenance de celle-ci. Les deux champs vont toujours
// ensemble : un lap non classé n'a ni l'une ni l'autre.
export interface LapIntensityResult {
  intensity?: LapIntensity;
  intensitySource?: LapIntensitySource;
}

/**
 * Intensité des laps d'un fichier .fit.
 *
 * Le champ `intensity` du message lap est optionnel dans le format et beaucoup
 * de montres ne l'écrivent jamais. On le prend dès qu'au moins un lap le porte —
 * c'est alors la montre qui parle — et on retombe sinon sur l'estimation par les
 * allures, la même que pour les activités Strava.
 */
export function resolveFitLapIntensities(
  laps: readonly FitLapInput[],
): LapIntensityResult[] {
  const declared = laps.map((lap) => mapFitLapIntensity(lap.intensity));
  if (declared.some((intensity) => intensity != null)) {
    return declared.map((intensity) =>
      intensity
        ? { intensity, intensitySource: LapIntensitySource.DEVICE }
        : {},
    );
  }

  return deriveLapIntensities(laps);
}

// En dessous de ce nombre de laps, une alternance effort/récup ne peut pas être
// distinguée d'un simple découpage kilométrique : on ne classe rien.
const MIN_LAPS = 4;

// Écart relatif minimal entre les deux groupes d'allures pour considérer qu'il
// s'agit bien d'une séance fractionnée. Une sortie régulière (variations de
// quelques pourcents d'un kilomètre à l'autre) reste ainsi non classée, alors
// qu'une récup trottinée à 6:00/km face à des efforts à 4:00/km sépare de 33 %.
const MIN_SEPARATION = 0.25;

// Part minimale de changements de groupe entre laps consécutifs. Une série
// franche alterne à chaque tour (≈ 1), une sortie dont les kilomètres lents sont
// groupés au début tombe sous 0,5.
const MIN_ALTERNATION = 0.7;

const KMEANS_ITERATIONS = 20;

/**
 * Estime l'intensité de chaque lap à partir des seules allures.
 *
 * L'API Strava n'expose aucun équivalent du champ `intensity` des fichiers .fit :
 * les laps sont classés en deux groupes d'allures (k-means à deux centroïdes sur
 * la vitesse moyenne), le groupe lent étant considéré comme de la récupération.
 * Renvoie un résultat vide pour tous les laps dès que la séparation entre les deux
 * groupes est trop faible pour être significative — mieux vaut aucune donnée
 * qu'une fausse récupération affichée à l'athlète.
 */
export function deriveLapIntensities(
  laps: readonly LapSpeedInput[],
): LapIntensityResult[] {
  const unclassified = (): LapIntensityResult[] => laps.map(() => ({}));
  if (laps.length < MIN_LAPS) {
    return unclassified();
  }

  const speeds = laps.map((lap) => {
    if (lap.avgSpeedMPerSec != null && lap.avgSpeedMPerSec > 0) {
      return lap.avgSpeedMPerSec;
    }
    return lap.durationSec > 0 ? lap.distanceM / lap.durationSec : 0;
  });

  let low = Math.min(...speeds);
  let high = Math.max(...speeds);
  if (high <= 0) {
    return unclassified();
  }

  // Lloyd sur une dimension : chaque vitesse rejoint le centroïde le plus proche,
  // puis les centroïdes se recalent sur la moyenne de leur groupe.
  for (let i = 0; i < KMEANS_ITERATIONS; i++) {
    const lowGroup: number[] = [];
    const highGroup: number[] = [];
    for (const speed of speeds) {
      if (Math.abs(speed - low) <= Math.abs(speed - high)) {
        lowGroup.push(speed);
      } else {
        highGroup.push(speed);
      }
    }
    if (lowGroup.length === 0 || highGroup.length === 0) {
      return unclassified();
    }

    const nextLow = average(lowGroup);
    const nextHigh = average(highGroup);
    if (nextLow === low && nextHigh === high) {
      break;
    }
    low = nextLow;
    high = nextHigh;
  }

  if ((high - low) / high < MIN_SEPARATION) {
    return unclassified();
  }

  const boundary = (low + high) / 2;
  const intensities = speeds.map((speed) =>
    speed < boundary ? LapIntensity.RECOVERY : LapIntensity.INTERVAL,
  );

  // Un groupe réduit à un seul lap traduit un aléa (un unique lap très lent après
  // un arrêt, par exemple) plutôt qu'une alternance : on préfère ne rien affirmer.
  const recoveryCount = intensities.filter(
    (intensity) => intensity === LapIntensity.RECOVERY,
  ).length;
  if (recoveryCount < 2 || intensities.length - recoveryCount < 2) {
    return unclassified();
  }

  // Deux groupes d'allures ne font pas une séance : encore faut-il qu'ils
  // alternent. Sur une sortie progressive ou un long échauffement, les laps
  // lents sont groupés en tête et le découpage décrit une évolution d'allure,
  // pas des répétitions — appeler « récupération » les premiers kilomètres
  // serait faux.
  const transitions = intensities.filter(
    (intensity, index) => index > 0 && intensity !== intensities[index - 1],
  ).length;
  if (transitions / (intensities.length - 1) < MIN_ALTERNATION) {
    return unclassified();
  }

  return intensities.map((intensity) => ({
    intensity,
    intensitySource: LapIntensitySource.DERIVED,
  }));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
