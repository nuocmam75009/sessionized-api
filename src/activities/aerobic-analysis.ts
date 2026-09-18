import { MAX_SAMPLE_GAP_SEC } from './heart-rate-samples';

/**
 * Réponse aérobie d'une séance : facteur d'efficacité et découplage
 * allure/fréquence cardiaque.
 *
 * Deux indicateurs qui ne veulent rien dire hors d'un effort régulier — d'où
 * les conditions d'éligibilité vérifiées ici plutôt que côté interface. Une
 * séance de fractionné, une sortie de vingt minutes ou une trace sans ceinture
 * ne donnent pas un mauvais chiffre : elles ne donnent pas de chiffre du tout.
 *
 * Module pur, sans dépendance Nest ni Prisma.
 */

// En dessous, l'athlète est à l'arrêt (feu rouge, ravito, photo) : ces points
// écraseraient l'allure moyenne sans rien dire de sa réponse cardiaque.
const MIN_MOVING_SPEED_M_PER_SEC = 0.5;

// L'échauffement fausse les deux moitiés : la FC met plusieurs minutes à
// rejoindre l'allure, ce qui fabrique un découplage qui n'existe pas. On coupe
// donc le début — un dixième de la séance, plafonné à dix minutes pour ne pas
// amputer une sortie de trois heures.
const WARMUP_TRIM_RATIO = 0.1;
const WARMUP_TRIM_MAX_SEC = 600;

// En dessous, les deux moitiés sont trop courtes pour que leur écart se
// distingue du bruit.
const MIN_ANALYZED_SEC = 20 * 60;

// Part de la portion analysée devant porter une mesure de FC.
const MIN_HEART_RATE_COVERAGE = 0.8;

// Coefficient de variation de l'allure au-delà duquel l'effort n'est plus
// régulier. Filet de sécurité quand l'intensité des laps ne permet pas déjà de
// reconnaître un fractionné.
const MAX_SPEED_VARIATION = 0.2;

// Au-delà de ce dénivelé positif au kilomètre, l'allure brute ne reflète plus
// l'effort et le découplage devient ininterprétable. Tant que l'allure
// corrigée de la pente (GAP) n'est pas calculée, on renvoie le résultat en le
// signalant comme peu fiable plutôt que de le taire ou de le laisser croire.
const HILLY_GAIN_M_PER_KM = 15;

// Lissage puis hystérésis sur l'altitude : le GPS oscille de quelques mètres à
// plat, et sommer toutes les variations positives fabriquerait des centaines
// de mètres de dénivelé à partir de rien. La moyenne glissante écrase ces
// oscillations rapides, l'hystérésis absorbe ce qu'il en reste.
const ELEVATION_SMOOTHING_SAMPLES = 15;
const ELEVATION_HYSTERESIS_M = 3;

// Seuils usuels (Friel) de lecture du découplage sur un effort en endurance.
const GOOD_DECOUPLING_PCT = 5;
const MODERATE_DECOUPLING_PCT = 10;

export interface AerobicSample {
  elapsedSec: number;
  heartRate: number | null;
  speedMPerSec: number | null;
  distanceM: number | null;
  altitudeM: number | null;
}

export type AerobicRejection =
  'NO_HEART_RATE' | 'NO_SPEED' | 'TOO_SHORT' | 'VARIABLE_EFFORT';

export type DecouplingRating = 'GOOD' | 'MODERATE' | 'HIGH';

export interface AerobicHalf {
  durationSec: number;
  avgSpeedMPerSec: number;
  avgPaceSecPerKm: number;
  avgHeartRate: number;
  efficiencyFactor: number;
}

export interface AerobicAnalysisResult {
  eligible: true;
  // Mètres parcourus par minute et par battement. Monte quand l'athlète va
  // plus vite à FC égale — c'est la progression aérobie.
  efficiencyFactor: number;
  // Perte d'efficacité de la seconde moitié par rapport à la première, en %.
  // Positif = dérive.
  decouplingPct: number;
  rating: DecouplingRating;
  first: AerobicHalf;
  second: AerobicHalf;
  // Portion réellement analysée, une fois l'échauffement et les arrêts retirés.
  analyzedFromSec: number;
  analyzedDurationSec: number;
  elevationGainMPerKm: number | null;
  // false en terrain vallonné : le chiffre est renvoyé, mais l'interface doit
  // dire qu'il ne veut pas dire grand-chose.
  terrainReliable: boolean;
}

export type AerobicAnalysis =
  { eligible: false; reason: AerobicRejection } | AerobicAnalysisResult;

interface WeightedSample {
  dt: number;
  speedMPerSec: number;
  heartRate: number;
  distanceM: number | null;
  altitudeM: number | null;
}

/**
 * Durée attribuée à chaque point : l'écart au point suivant, plafonné comme
 * dans les agrégations de zones FC pour qu'une pause ne compte pas, et 1 s
 * pour le dernier point qui n'a pas de suivant.
 */
function withSampleDurations(
  samples: readonly AerobicSample[],
): Array<AerobicSample & { dt: number }> {
  const sorted = [...samples].sort((a, b) => a.elapsedSec - b.elapsedSec);
  return sorted.map((sample, index) => {
    const next = sorted[index + 1];
    const gap = next ? next.elapsedSec - sample.elapsedSec : 1;
    return { ...sample, dt: Math.min(Math.max(gap, 0), MAX_SAMPLE_GAP_SEC) };
  });
}

function totalDuration(samples: readonly WeightedSample[]): number {
  return samples.reduce((sum, s) => sum + s.dt, 0);
}

function halfStats(samples: readonly WeightedSample[]): AerobicHalf {
  const durationSec = totalDuration(samples);
  const avgSpeedMPerSec =
    samples.reduce((sum, s) => sum + s.speedMPerSec * s.dt, 0) / durationSec;
  const avgHeartRate =
    samples.reduce((sum, s) => sum + s.heartRate * s.dt, 0) / durationSec;

  return {
    durationSec,
    avgSpeedMPerSec,
    avgPaceSecPerKm: 1000 / avgSpeedMPerSec,
    avgHeartRate,
    // Mètres par minute et par battement : une allure de 12 km/h à 160 bpm
    // donne 1,25.
    efficiencyFactor: (avgSpeedMPerSec * 60) / avgHeartRate,
  };
}

/** Coefficient de variation de l'allure, pondéré par la durée des points. */
function speedVariation(samples: readonly WeightedSample[]): number {
  const duration = totalDuration(samples);
  const mean =
    samples.reduce((sum, s) => sum + s.speedMPerSec * s.dt, 0) / duration;
  if (mean <= 0) return Number.POSITIVE_INFINITY;

  const variance =
    samples.reduce((sum, s) => sum + (s.speedMPerSec - mean) ** 2 * s.dt, 0) /
    duration;

  return Math.sqrt(variance) / mean;
}

/** Moyenne glissante centrée, pour lisser le bruit d'altitude du GPS. */
function smooth(values: readonly number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(values.length, index + half + 1);
    let sum = 0;
    for (let i = from; i < to; i++) sum += values[i];
    return sum / (to - from);
  });
}

/** Dénivelé positif cumulé, lissé puis filtré par hystérésis. */
function elevationGain(samples: readonly WeightedSample[]): number | null {
  const altitudes = samples
    .map((s) => s.altitudeM)
    .filter((a): a is number => a != null);
  if (altitudes.length < 2) return null;

  const smoothed = smooth(altitudes, ELEVATION_SMOOTHING_SAMPLES);

  let gain = 0;
  let reference = smoothed[0];
  for (const altitude of smoothed) {
    const delta = altitude - reference;
    if (Math.abs(delta) < ELEVATION_HYSTERESIS_M) continue;
    if (delta > 0) gain += delta;
    reference = altitude;
  }

  return gain;
}

/** Distance de la portion analysée, mesurée si possible, intégrée sinon. */
function analyzedDistanceM(samples: readonly WeightedSample[]): number {
  const measured = samples
    .map((s) => s.distanceM)
    .filter((d): d is number => d != null);
  if (measured.length >= 2) {
    const span = measured[measured.length - 1] - measured[0];
    if (span > 0) return span;
  }

  return samples.reduce((sum, s) => sum + s.speedMPerSec * s.dt, 0);
}

function rate(decouplingPct: number): DecouplingRating {
  if (decouplingPct < GOOD_DECOUPLING_PCT) return 'GOOD';
  if (decouplingPct < MODERATE_DECOUPLING_PCT) return 'MODERATE';
  return 'HIGH';
}

/**
 * Analyse la réponse aérobie d'une séance.
 *
 * `intervalSession` court-circuite la détection de variabilité quand
 * l'intensité des laps a déjà reconnu un fractionné : le découplage d'une
 * séance de 10x400 n'a aucun sens, même si l'allure moyenne y paraît stable.
 */
export function analyzeAerobicResponse(
  samples: readonly AerobicSample[],
  options: { intervalSession?: boolean } = {},
): AerobicAnalysis {
  if (options.intervalSession) {
    return { eligible: false, reason: 'VARIABLE_EFFORT' };
  }

  const timed = withSampleDurations(samples);
  const moving = timed.filter(
    (s) =>
      s.speedMPerSec != null && s.speedMPerSec >= MIN_MOVING_SPEED_M_PER_SEC,
  );
  const movingDuration = moving.reduce((sum, s) => sum + s.dt, 0);
  if (movingDuration <= 0) {
    return { eligible: false, reason: 'NO_SPEED' };
  }

  const withHeartRate = moving.filter((s) => s.heartRate != null);
  const coveredDuration = withHeartRate.reduce((sum, s) => sum + s.dt, 0);
  if (coveredDuration / movingDuration < MIN_HEART_RATE_COVERAGE) {
    return { eligible: false, reason: 'NO_HEART_RATE' };
  }

  const usable: WeightedSample[] = withHeartRate.map((s) => ({
    dt: s.dt,
    speedMPerSec: s.speedMPerSec as number,
    heartRate: s.heartRate as number,
    distanceM: s.distanceM,
    altitudeM: s.altitudeM,
  }));

  // Découpe de l'échauffement, sur le temps en mouvement et non sur le temps
  // écoulé : une longue pause au départ ne doit pas manger la portion utile.
  const trimSec = Math.min(
    coveredDuration * WARMUP_TRIM_RATIO,
    WARMUP_TRIM_MAX_SEC,
  );
  let skipped = 0;
  let firstIndex = 0;
  while (firstIndex < usable.length && skipped < trimSec) {
    skipped += usable[firstIndex].dt;
    firstIndex++;
  }

  const analyzed = usable.slice(firstIndex);
  const analyzedDuration = totalDuration(analyzed);
  if (analyzedDuration < MIN_ANALYZED_SEC) {
    return { eligible: false, reason: 'TOO_SHORT' };
  }

  if (speedVariation(analyzed) > MAX_SPEED_VARIATION) {
    return { eligible: false, reason: 'VARIABLE_EFFORT' };
  }

  // Découpe en deux moitiés de durée égale, pas en deux moitiés de points :
  // les enregistrements ne sont pas toujours à la seconde.
  const halfDuration = analyzedDuration / 2;
  let accumulated = 0;
  let splitIndex = 0;
  while (splitIndex < analyzed.length && accumulated < halfDuration) {
    accumulated += analyzed[splitIndex].dt;
    splitIndex++;
  }

  const first = halfStats(analyzed.slice(0, splitIndex));
  const second = halfStats(analyzed.slice(splitIndex));
  const whole = halfStats(analyzed);

  const gainM = elevationGain(analyzed);
  const distanceKm = analyzedDistanceM(analyzed) / 1000;
  const elevationGainMPerKm =
    gainM != null && distanceKm > 0 ? gainM / distanceKm : null;

  const decouplingPct =
    ((first.efficiencyFactor - second.efficiencyFactor) /
      first.efficiencyFactor) *
    100;

  return {
    eligible: true,
    efficiencyFactor: whole.efficiencyFactor,
    decouplingPct,
    rating: rate(decouplingPct),
    first,
    second,
    analyzedFromSec: skipped,
    analyzedDurationSec: analyzedDuration,
    elevationGainMPerKm,
    terrainReliable:
      elevationGainMPerKm == null || elevationGainMPerKm < HILLY_GAIN_M_PER_KM,
  };
}
