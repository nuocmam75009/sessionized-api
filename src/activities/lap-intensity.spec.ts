import { LapIntensity, LapIntensitySource } from '../../generated/prisma/enums';
import {
  deriveLapIntensities,
  mapFitLapIntensity,
  resolveFitLapIntensities,
} from './lap-intensity';

const { RECOVERY, INTERVAL, ACTIVE } = LapIntensity;

const derived = (intensity: LapIntensity) => ({
  intensity,
  intensitySource: LapIntensitySource.DERIVED,
});
const declared = (intensity: LapIntensity) => ({
  intensity,
  intensitySource: LapIntensitySource.DEVICE,
});
const unclassified = (count: number) =>
  Array.from({ length: count }, () => ({}));

// Laps réels d'une séance piste « 1600 / 4x400 / 4x200 / 1600 » importée depuis
// Strava, récup statique entre les répétitions (d'où les distances quasi nulles).
const TRACK_SESSION = [
  [1600, 365],
  [32.5, 120],
  [400, 78],
  [34.04, 90],
  [400, 78],
  [27.63, 90],
  [400, 77],
  [22.82, 90],
  [400, 78],
  [31.08, 90],
  [200, 41],
  [13.7, 30],
  [200, 31],
  [16.27, 30],
  [200, 38],
  [7.86, 30],
  [200, 35],
  [11.23, 30],
  [8.92, 120],
  [1600, 366],
].map(([distanceM, durationSec]) => ({ distanceM, durationSec }));

describe('deriveLapIntensities', () => {
  it('sépare efforts et récupérations sur une séance piste', () => {
    const intensities = deriveLapIntensities(TRACK_SESSION);

    // Un lap sur deux est une récup, sauf les deux 1600 qui s'enchaînent avec
    // une récup avant/après.
    expect(intensities).toEqual(
      [
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        INTERVAL,
        RECOVERY,
        RECOVERY,
        INTERVAL,
      ].map(derived),
    );
  });

  it("reconnaît une récupération trottinée, pas seulement à l'arrêt", () => {
    const laps = [
      { distanceM: 400, durationSec: 78 },
      { distanceM: 200, durationSec: 80 },
      { distanceM: 400, durationSec: 79 },
      { distanceM: 200, durationSec: 82 },
      { distanceM: 400, durationSec: 77 },
      { distanceM: 200, durationSec: 81 },
    ];

    expect(deriveLapIntensities(laps)).toEqual(
      [INTERVAL, RECOVERY, INTERVAL, RECOVERY, INTERVAL, RECOVERY].map(derived),
    );
  });

  it('ne classe rien sur une sortie à allure régulière', () => {
    const laps = [
      { distanceM: 1000, durationSec: 300 },
      { distanceM: 1000, durationSec: 305 },
      { distanceM: 1000, durationSec: 298 },
      { distanceM: 1000, durationSec: 310 },
      { distanceM: 1000, durationSec: 302 },
    ];

    expect(deriveLapIntensities(laps)).toEqual(unclassified(5));
  });

  it('ne classe rien quand un seul lap se détache (arrêt isolé)', () => {
    const laps = [
      { distanceM: 1000, durationSec: 300 },
      { distanceM: 1000, durationSec: 298 },
      { distanceM: 50, durationSec: 120 },
      { distanceM: 1000, durationSec: 305 },
      { distanceM: 1000, durationSec: 302 },
    ];

    expect(deriveLapIntensities(laps)).toEqual(unclassified(5));
  });

  it('ne classe rien quand les laps lents sont groupés au lieu d’alterner', () => {
    // Sortie du 20/08 : quatre kilomètres d'échauffement puis une accélération.
    // Les deux groupes d'allures existent, mais ce ne sont pas des répétitions.
    const laps = [
      { distanceM: 1000, durationSec: 360 },
      { distanceM: 1000, durationSec: 355 },
      { distanceM: 1000, durationSec: 358 },
      { distanceM: 1000, durationSec: 350 },
      { distanceM: 1000, durationSec: 240 },
      { distanceM: 1000, durationSec: 238 },
      { distanceM: 1000, durationSec: 242 },
      { distanceM: 1000, durationSec: 236 },
    ];

    expect(deriveLapIntensities(laps)).toEqual(unclassified(8));
  });

  it('ne classe rien en dessous de quatre laps', () => {
    const laps = [
      { distanceM: 400, durationSec: 78 },
      { distanceM: 200, durationSec: 120 },
      { distanceM: 400, durationSec: 79 },
    ];

    expect(deriveLapIntensities(laps)).toEqual(unclassified(3));
  });

  it('privilégie la vitesse moyenne fournie par Strava au calcul distance/durée', () => {
    const laps = [
      { distanceM: 0, durationSec: 78, avgSpeedMPerSec: 5.13 },
      { distanceM: 0, durationSec: 90, avgSpeedMPerSec: 0.3 },
      { distanceM: 0, durationSec: 78, avgSpeedMPerSec: 5.1 },
      { distanceM: 0, durationSec: 90, avgSpeedMPerSec: 0.35 },
    ];

    expect(deriveLapIntensities(laps)).toEqual(
      [INTERVAL, RECOVERY, INTERVAL, RECOVERY].map(derived),
    );
  });
});

describe('resolveFitLapIntensities', () => {
  // `avg_speed` des 20 laps du fichier Piste20260828162226.fit (Coros), séance
  // « 1600 / 4x400 / 4x200 / 1600 ». Aucun de ces laps ne porte de champ
  // `intensity` : la montre ne l'écrit pas.
  const COROS_TRACK_SPEEDS = [
    4.38, 0.27, 5.1, 0.38, 5.07, 0.31, 5.18, 0.25, 5.11, 0.34, 4.86, 0.46, 6.44,
    0.54, 5.23, 0.26, 5.71, 0.37, 0.07, 4.36,
  ];

  it("estime l'intensité quand la montre n'écrit pas le champ", () => {
    const laps = COROS_TRACK_SPEEDS.map((avgSpeedMPerSec) => ({
      distanceM: 0,
      durationSec: 0,
      avgSpeedMPerSec,
    }));

    const intensities = resolveFitLapIntensities(laps);

    expect(intensities).toEqual(
      COROS_TRACK_SPEEDS.map((speed) =>
        derived(speed > 1 ? INTERVAL : RECOVERY),
      ),
    );
    // Toutes estimées : rien ne vient de la montre sur ce fichier.
    expect(
      intensities.every(
        (lap) => lap.intensitySource === LapIntensitySource.DERIVED,
      ),
    ).toBe(true);
  });

  it('préfère le champ de la montre dès qu’un seul lap le porte', () => {
    const laps = [
      { distanceM: 400, durationSec: 78, intensity: 'warmup' },
      { distanceM: 200, durationSec: 120 },
      { distanceM: 400, durationSec: 79 },
      { distanceM: 200, durationSec: 122 },
    ];

    // Le lap déclaré est repris tel quel et marqué DEVICE, les autres restent
    // vides plutôt que d'être estimés : mélanger les deux sources produirait un
    // découpage incohérent.
    expect(resolveFitLapIntensities(laps)).toEqual([
      declared(LapIntensity.WARMUP),
      {},
      {},
      {},
    ]);
  });
});

describe('mapFitLapIntensity', () => {
  it('traduit les intensités écrites par la montre', () => {
    expect(mapFitLapIntensity('active')).toBe(ACTIVE);
    expect(mapFitLapIntensity('recovery')).toBe(RECOVERY);
    expect(mapFitLapIntensity('rest')).toBe(LapIntensity.REST);
  });

  it('ignore une valeur absente ou inconnue', () => {
    expect(mapFitLapIntensity(undefined)).toBeUndefined();
    expect(mapFitLapIntensity('unknown_value')).toBeUndefined();
  });
});
