import { analyzeAerobicResponse, type AerobicSample } from './aerobic-analysis';

interface RunShape {
  durationSec: number;
  speedAt: (elapsedSec: number) => number;
  heartRateAt: (elapsedSec: number) => number | null;
  altitudeAt?: (elapsedSec: number) => number;
}

// Trace enregistrée à 1 Hz, comme celle d'une montre.
function buildRun({
  durationSec,
  speedAt,
  heartRateAt,
  altitudeAt,
}: RunShape): AerobicSample[] {
  const samples: AerobicSample[] = [];
  let distanceM = 0;

  for (let elapsedSec = 0; elapsedSec < durationSec; elapsedSec++) {
    const speedMPerSec = speedAt(elapsedSec);
    distanceM += speedMPerSec;
    samples.push({
      elapsedSec,
      speedMPerSec,
      heartRate: heartRateAt(elapsedSec),
      distanceM,
      altitudeM: altitudeAt ? altitudeAt(elapsedSec) : null,
    });
  }

  return samples;
}

const ONE_HOUR = 3600;

// Une heure à 3 m/s (5'33"/km) à 150 bpm, du début à la fin.
const steadyRun = buildRun({
  durationSec: ONE_HOUR,
  speedAt: () => 3,
  heartRateAt: () => 150,
});

function expectEligible(analysis: ReturnType<typeof analyzeAerobicResponse>) {
  if (!analysis.eligible) {
    throw new Error(`analyse refusée : ${analysis.reason}`);
  }
  return analysis;
}

describe('analyzeAerobicResponse — éligibilité', () => {
  it('refuse une séance sans trace de fréquence cardiaque', () => {
    const analysis = analyzeAerobicResponse(
      buildRun({
        durationSec: ONE_HOUR,
        speedAt: () => 3,
        heartRateAt: () => null,
      }),
    );

    expect(analysis).toEqual({ eligible: false, reason: 'NO_HEART_RATE' });
  });

  it('refuse une trace FC trop trouée pour être moyennée', () => {
    // Ceinture qui décroche sur la moitié de la séance.
    const analysis = analyzeAerobicResponse(
      buildRun({
        durationSec: ONE_HOUR,
        speedAt: () => 3,
        heartRateAt: (t) => (t % 2 === 0 ? 150 : null),
      }),
    );

    expect(analysis).toEqual({ eligible: false, reason: 'NO_HEART_RATE' });
  });

  it('refuse une séance trop courte une fois l’échauffement retiré', () => {
    const analysis = analyzeAerobicResponse(
      buildRun({
        durationSec: 21 * 60,
        speedAt: () => 3,
        heartRateAt: () => 150,
      }),
    );

    expect(analysis).toEqual({ eligible: false, reason: 'TOO_SHORT' });
  });

  it('refuse un fractionné reconnu par l’intensité de ses laps', () => {
    const analysis = analyzeAerobicResponse(steadyRun, {
      intervalSession: true,
    });

    expect(analysis).toEqual({ eligible: false, reason: 'VARIABLE_EFFORT' });
  });

  it('refuse un effort trop irrégulier même sans intensité de lap', () => {
    // Fartlek : une minute vite, une minute lente, pendant une heure. Les laps
    // d'une activité Strava ne portent aucune intensité, c'est la variabilité
    // de l'allure qui doit le reconnaître.
    const analysis = analyzeAerobicResponse(
      buildRun({
        durationSec: ONE_HOUR,
        speedAt: (t) => (Math.floor(t / 60) % 2 === 0 ? 4.5 : 2.5),
        heartRateAt: () => 160,
      }),
    );

    expect(analysis).toEqual({ eligible: false, reason: 'VARIABLE_EFFORT' });
  });

  it('accepte une sortie régulière', () => {
    expect(analyzeAerobicResponse(steadyRun).eligible).toBe(true);
  });
});

describe('analyzeAerobicResponse — facteur d’efficacité', () => {
  it('rend les mètres par minute et par battement', () => {
    const analysis = expectEligible(analyzeAerobicResponse(steadyRun));

    // 3 m/s = 180 m/min, à 150 bpm.
    expect(analysis.efficiencyFactor).toBeCloseTo(1.2, 3);
  });

  it('monte quand l’athlète va plus vite à FC égale', () => {
    const faster = expectEligible(
      analyzeAerobicResponse(
        buildRun({
          durationSec: ONE_HOUR,
          speedAt: () => 3.3,
          heartRateAt: () => 150,
        }),
      ),
    );

    expect(faster.efficiencyFactor).toBeGreaterThan(
      expectEligible(analyzeAerobicResponse(steadyRun)).efficiencyFactor,
    );
  });

  it('ignore les arrêts plutôt que de les compter comme une allure nulle', () => {
    // Dix minutes d'arrêt au ravito, au milieu de la sortie.
    const withStop = buildRun({
      durationSec: ONE_HOUR,
      speedAt: (t) => (t >= 1800 && t < 2400 ? 0 : 3),
      heartRateAt: (t) => (t >= 1800 && t < 2400 ? 110 : 150),
    });

    const analysis = expectEligible(analyzeAerobicResponse(withStop));

    expect(analysis.efficiencyFactor).toBeCloseTo(1.2, 2);
    // Les dix minutes à l'arrêt ne sont pas dans la portion analysée.
    expect(analysis.analyzedDurationSec).toBeLessThanOrEqual(ONE_HOUR - 600);
  });
});

describe('analyzeAerobicResponse — découplage', () => {
  it('est nul sur un effort qui ne dérive pas', () => {
    const analysis = expectEligible(analyzeAerobicResponse(steadyRun));

    expect(Math.abs(analysis.decouplingPct)).toBeLessThan(1);
    expect(analysis.rating).toBe('GOOD');
  });

  it('détecte une FC qui monte à allure constante', () => {
    const drifting = buildRun({
      durationSec: ONE_HOUR,
      speedAt: () => 3,
      heartRateAt: (t) => (t < ONE_HOUR / 2 ? 145 : 170),
    });

    const analysis = expectEligible(analyzeAerobicResponse(drifting));

    expect(analysis.decouplingPct).toBeGreaterThan(10);
    expect(analysis.rating).toBe('HIGH');
    expect(analysis.second.avgHeartRate).toBeGreaterThan(
      analysis.first.avgHeartRate,
    );
  });

  it('détecte une allure qui s’effondre à FC constante', () => {
    const fading = buildRun({
      durationSec: ONE_HOUR,
      speedAt: (t) => (t < ONE_HOUR / 2 ? 3.2 : 2.9),
      heartRateAt: () => 155,
    });

    const analysis = expectEligible(analyzeAerobicResponse(fading));

    expect(analysis.decouplingPct).toBeGreaterThan(0);
    expect(analysis.second.avgPaceSecPerKm).toBeGreaterThan(
      analysis.first.avgPaceSecPerKm,
    );
  });

  it('classe la dérive selon les seuils usuels', () => {
    const moderate = buildRun({
      durationSec: ONE_HOUR,
      speedAt: () => 3,
      heartRateAt: (t) => (t < ONE_HOUR / 2 ? 150 : 159),
    });

    expect(expectEligible(analyzeAerobicResponse(moderate)).rating).toBe(
      'MODERATE',
    );
  });

  it('coupe l’échauffement, où la FC n’a pas encore rejoint l’allure', () => {
    // Cinq minutes de mise en route : la FC grimpe de 110 à 150. Comptée, elle
    // fabriquerait un découplage négatif sur une sortie parfaitement régulière.
    const withWarmup = buildRun({
      durationSec: ONE_HOUR,
      speedAt: () => 3,
      heartRateAt: (t) => (t < 300 ? 110 + (t / 300) * 40 : 150),
    });

    const analysis = expectEligible(analyzeAerobicResponse(withWarmup));

    expect(analysis.analyzedFromSec).toBeGreaterThanOrEqual(300);
    expect(Math.abs(analysis.decouplingPct)).toBeLessThan(1);
  });
});

describe('analyzeAerobicResponse — terrain', () => {
  it('considère le résultat fiable à plat', () => {
    const analysis = expectEligible(analyzeAerobicResponse(steadyRun));

    expect(analysis.terrainReliable).toBe(true);
    expect(analysis.elevationGainMPerKm).toBeNull();
  });

  it('ignore le bruit GPS d’une trace plate', () => {
    const noisy = buildRun({
      durationSec: ONE_HOUR,
      speedAt: () => 3,
      heartRateAt: () => 150,
      altitudeAt: (t) => 100 + Math.sin(t / 3) * 2,
    });

    const analysis = expectEligible(analyzeAerobicResponse(noisy));

    expect(analysis.elevationGainMPerKm).toBeLessThan(5);
    expect(analysis.terrainReliable).toBe(true);
  });

  it('signale un résultat ininterprétable en terrain vallonné', () => {
    // 400 m de D+ régulier sur une heure à 3 m/s, soit ~10,8 km : 37 m/km.
    const hilly = buildRun({
      durationSec: ONE_HOUR,
      speedAt: () => 3,
      heartRateAt: () => 150,
      altitudeAt: (t) => 100 + (t / ONE_HOUR) * 400,
    });

    const analysis = expectEligible(analyzeAerobicResponse(hilly));

    expect(analysis.elevationGainMPerKm).toBeGreaterThan(15);
    expect(analysis.terrainReliable).toBe(false);
  });
});
