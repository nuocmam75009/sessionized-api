import {
  ATL_TIME_CONSTANT_DAYS,
  CTL_TIME_CONSTANT_DAYS,
  buildTrainingLoadSeries,
  heartRateLoad,
  perceivedLoad,
  sessionLoad,
  zoneLoadCoefficients,
} from './training-load';

const HOUR_SEC = 3600;

describe('zoneLoadCoefficients', () => {
  it('rend la courbe canonique telle quelle pour cinq zones', () => {
    expect(zoneLoadCoefficients(5)).toEqual([30, 55, 75, 100, 120]);
  });

  it('reste monotone quel que soit le nombre de zones', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 10]) {
      const coefficients = zoneLoadCoefficients(count);
      expect(coefficients).toHaveLength(count);
      for (let i = 1; i < coefficients.length; i++) {
        expect(coefficients[i]).toBeGreaterThan(coefficients[i - 1]);
      }
    }
  });

  it('borne la courbe aux extrémités canoniques', () => {
    const coefficients = zoneLoadCoefficients(8);
    expect(coefficients[0]).toBe(30);
    expect(coefficients[coefficients.length - 1]).toBe(120);
  });

  it('place une zone unique au milieu plutôt que de l’extrapoler', () => {
    expect(zoneLoadCoefficients(1)).toEqual([75]);
    expect(zoneLoadCoefficients(0)).toEqual([]);
  });
});

describe('heartRateLoad', () => {
  it('étalonne une heure en Z4 à 100', () => {
    expect(heartRateLoad([0, 0, 0, HOUR_SEC, 0])).toBeCloseTo(100, 6);
  });

  it('additionne les zones au prorata du temps passé', () => {
    // 30 min Z2 + 30 min Z4 = 27,5 + 50.
    expect(heartRateLoad([0, 1800, 0, 1800, 0])).toBeCloseTo(77.5, 6);
  });

  it('coûte moins cher en endurance qu’au seuil, à durée égale', () => {
    expect(heartRateLoad([0, HOUR_SEC, 0, 0, 0])).toBeLessThan(
      heartRateLoad([0, 0, 0, HOUR_SEC, 0]),
    );
  });

  it('finit malgré tout par coûter plus cher si l’endurance dure', () => {
    // Deux heures en Z2 pèsent plus qu'une heure au seuil : le volume compte,
    // c'est toute la différence entre la charge et l'intensité.
    expect(heartRateLoad([0, 2 * HOUR_SEC, 0, 0, 0])).toBeGreaterThan(
      heartRateLoad([0, 0, 0, HOUR_SEC, 0]),
    );
  });
});

describe('perceivedLoad', () => {
  it('étalonne une heure à RPE 8 sur la même échelle que le seuil', () => {
    expect(perceivedLoad(8, HOUR_SEC)).toBeCloseTo(100, 6);
  });

  it('est proportionnelle au ressenti comme à la durée', () => {
    expect(perceivedLoad(4, HOUR_SEC)).toBeCloseTo(50, 6);
    expect(perceivedLoad(8, HOUR_SEC / 2)).toBeCloseTo(50, 6);
  });
});

describe('sessionLoad', () => {
  it('préfère la FC quand la trace est exploitable', () => {
    const result = sessionLoad({
      durationSec: HOUR_SEC,
      secondsByZone: [0, 0, 0, HOUR_SEC, 0],
      difficultyNote: 3,
    });

    expect(result.source).toBe('HEART_RATE');
    expect(result.load).toBeCloseTo(100, 6);
    // Le ressenti reste renvoyé : c'est son écart avec la charge FC qui
    // constituera plus tard un signal de surmenage.
    expect(result.perceivedLoad).toBeCloseTo(37.5, 6);
  });

  it('retombe sur le ressenti quand la trace FC est trop trouée', () => {
    // Ceinture décrochée au bout de dix minutes sur une heure de séance.
    const result = sessionLoad({
      durationSec: HOUR_SEC,
      secondsByZone: [0, 600, 0, 0, 0],
      difficultyNote: 8,
    });

    expect(result.source).toBe('PERCEIVED');
    expect(result.load).toBeCloseTo(100, 6);
    expect(result.heartRateLoad).toBeNull();
  });

  it('retombe sur la durée seule, sans jamais renvoyer zéro', () => {
    const result = sessionLoad({ durationSec: HOUR_SEC });

    expect(result.source).toBe('DURATION');
    expect(result.load).toBeCloseTo(55, 6);
    expect(result.heartRateLoad).toBeNull();
    expect(result.perceivedLoad).toBeNull();
  });

  it('ignore un ressenti absent ou nul plutôt que de le compter pour zéro', () => {
    expect(
      sessionLoad({ durationSec: HOUR_SEC, difficultyNote: null }).source,
    ).toBe('DURATION');
    expect(
      sessionLoad({ durationSec: HOUR_SEC, difficultyNote: 0 }).source,
    ).toBe('DURATION');
  });
});

describe('buildTrainingLoadSeries', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const dayAfter = (days: number) =>
    new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  it('couvre tous les jours civils, y compris ceux sans activité', () => {
    const series = buildTrainingLoadSeries(
      new Map([['2026-01-01', 100]]),
      start,
      dayAfter(6),
    );

    expect(series).toHaveLength(7);
    expect(series.map((p) => p.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ]);
    expect(series[1].load).toBe(0);
  });

  it('fait redescendre la fatigue plus vite que la condition au repos', () => {
    const loads = new Map<string, number>();
    for (let day = 0; day < 30; day++) {
      loads.set(dayAfter(day).toISOString().slice(0, 10), 100);
    }

    const series = buildTrainingLoadSeries(loads, start, dayAfter(59));
    const lastTrainingDay = series[29];
    const twoWeeksLater = series[43];

    // Après deux semaines sans rien, l'ATL a perdu beaucoup plus que la CTL.
    const atlDrop = 1 - twoWeeksLater.atl / lastTrainingDay.atl;
    const ctlDrop = 1 - twoWeeksLater.ctl / lastTrainingDay.ctl;
    expect(atlDrop).toBeGreaterThan(ctlDrop);
  });

  it('remonte la fraîcheur quand la charge s’arrête', () => {
    const loads = new Map<string, number>();
    for (let day = 0; day < 20; day++) {
      loads.set(dayAfter(day).toISOString().slice(0, 10), 120);
    }

    const series = buildTrainingLoadSeries(loads, start, dayAfter(40));
    // En pleine charge la fraîcheur est négative, elle repasse au-dessus une
    // fois l'entraînement arrêté : c'est l'affûtage.
    expect(series[19].tsb).toBeLessThan(0);
    expect(series[40].tsb).toBeGreaterThan(series[19].tsb);
  });

  it('lit la fraîcheur sur la veille, pas sur la séance du jour', () => {
    const series = buildTrainingLoadSeries(
      new Map([['2026-01-01', 300]]),
      start,
      dayAfter(1),
    );

    // Premier jour : rien n'a encore été accumulé, la grosse séance du jour ne
    // doit pas déjà peser sur la fraîcheur.
    expect(series[0].tsb).toBe(0);
    expect(series[1].tsb).toBeLessThan(0);
  });

  it('signale les jours où la CTL n’a pas encore assez d’historique', () => {
    const series = buildTrainingLoadSeries(new Map(), start, dayAfter(60));

    expect(series[0].settled).toBe(false);
    expect(series[CTL_TIME_CONSTANT_DAYS - 1].settled).toBe(false);
    expect(series[CTL_TIME_CONSTANT_DAYS].settled).toBe(true);
  });

  it('converge vers la charge quotidienne à l’équilibre', () => {
    const loads = new Map<string, number>();
    for (let day = 0; day < 400; day++) {
      loads.set(dayAfter(day).toISOString().slice(0, 10), 80);
    }

    const series = buildTrainingLoadSeries(loads, start, dayAfter(399));
    const last = series[series.length - 1];

    // Charge constante maintenue très longtemps : CTL et ATL tendent vers
    // elle, et la fraîcheur vers zéro.
    expect(last.ctl).toBeCloseTo(80, 1);
    expect(last.atl).toBeCloseTo(80, 1);
    expect(last.tsb).toBeCloseTo(0, 1);
    // La constante courte se remplit bien plus vite que la longue.
    expect(series[ATL_TIME_CONSTANT_DAYS].atl).toBeGreaterThan(
      series[ATL_TIME_CONSTANT_DAYS].ctl,
    );
  });
});
