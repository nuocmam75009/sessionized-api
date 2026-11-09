import { secondsSince, stravaLapStartSec } from './lap-start';

const START = new Date('2026-11-07T08:00:00.000Z');

describe('secondsSince', () => {
  it('compte les secondes depuis le départ, chaîne ISO ou Date', () => {
    expect(secondsSince(START, '2026-11-07T08:01:18.000Z')).toBe(78);
    expect(secondsSince(START, new Date('2026-11-07T08:00:00.500Z'))).toBe(0.5);
  });

  it('ramène à zéro un lap qui semble partir avant l’activité', () => {
    // Arrondi de la montre : le premier lap est daté une seconde trop tôt.
    expect(secondsSince(START, '2026-11-07T07:59:59.000Z')).toBe(0);
  });

  it('rend undefined sans date, ou sur une date illisible', () => {
    expect(secondsSince(START, undefined)).toBeUndefined();
    expect(secondsSince(START, 'pas une date')).toBeUndefined();
  });
});

describe('stravaLapStartSec', () => {
  // Trace avec un arrêt de 40 s entre les échantillons 2 et 3 : la somme des
  // `moving_time` placerait le lap suivant 40 s trop tôt.
  const time = [0, 1, 2, 42, 43, 44];

  it('prend le temps de l’échantillon désigné par start_index', () => {
    expect(
      stravaLapStartSec(
        { start_index: 3, start_date: '2026-11-07T08:00:30Z' },
        time,
        START,
      ),
    ).toBe(42);
  });

  it('se rabat sur start_date sans stream ou hors limites', () => {
    const lap = { start_index: 99, start_date: '2026-11-07T08:00:42Z' };
    expect(stravaLapStartSec(lap, time, START)).toBe(42);
    expect(stravaLapStartSec(lap, undefined, START)).toBe(42);
  });

  it('rend undefined quand Strava ne fournit ni l’un ni l’autre', () => {
    expect(stravaLapStartSec({}, time, START)).toBeUndefined();
  });
});
