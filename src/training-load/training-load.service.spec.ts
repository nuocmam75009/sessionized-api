import { TrainingLoadService } from './training-load.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { Role } from '../../generated/prisma/enums';

// Athlète à cinq zones : quatre bornes hautes plus la valeur inexploitable de
// la zone ouverte Strava, telle qu'elle est stockée sur le profil.
const ATHLETE = {
  id: 'ath-1',
  heartRateZonesBpm: [130, 148, 165, 180, 180],
};

interface ZoneRow {
  activityId: string;
  zoneIndex: number;
  seconds: number;
}

interface ActivityRow {
  id: string;
  startedAt: Date;
  totalDurationSec: number;
  difficultyNote: number | null;
}

interface AthleteRow {
  id: string;
  heartRateZonesBpm: number[];
}

function buildService({
  activities = [],
  zoneRows = [],
  athlete = ATHLETE,
}: {
  activities?: ActivityRow[];
  zoneRows?: ZoneRow[];
  athlete?: AthleteRow | null;
} = {}) {
  const prisma = {
    activity: { findMany: jest.fn().mockResolvedValue(activities) },
    trainingLoad: {
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn().mockReturnValue('delete-op'),
      createMany: jest.fn().mockReturnValue('create-op'),
    },
    athleteProfile: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue(zoneRows),
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const usersService = {
    getAthleteProfile: jest.fn().mockResolvedValue(athlete),
    getCoachProfile: jest.fn().mockResolvedValue(null),
  };

  return {
    prisma,
    service: new TrainingLoadService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    ),
  };
}

const QUERY = {
  from: '2026-01-01T00:00:00+00:00',
  to: '2026-01-10T23:59:59+00:00',
};

function activity(
  id: string,
  startedAt: string,
  totalDurationSec: number,
  difficultyNote: number | null = null,
): ActivityRow {
  return {
    id,
    startedAt: new Date(startedAt),
    totalDurationSec,
    difficultyNote,
  };
}

describe('TrainingLoadService', () => {
  it('renvoie une série vide, et non une erreur, pour un athlète sans activité', async () => {
    const { service, prisma } = buildService();

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(result.points).toEqual([]);
    expect(result.activityCount).toBe(0);
    expect(result.current.ctl).toBe(0);
    // Rien à agréger : ni requête de zones, ni écriture de cache.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('classe le temps de chaque activité dans les bonnes zones', async () => {
    const { service } = buildService({
      activities: [activity('act-1', '2026-01-05T08:00:00Z', 3600)],
      // Une heure pleine en Z4 : l'étalonnage veut 100.
      zoneRows: [{ activityId: 'act-1', zoneIndex: 4, seconds: 3600 }],
    });

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);
    const day = result.points.find((point) => point.date === '2026-01-05');

    expect(day?.load).toBeCloseTo(100, 1);
    expect(result.sourceCounts).toEqual({
      HEART_RATE: 1,
      PERCEIVED: 0,
      DURATION: 0,
    });
  });

  it('additionne les séances d’une même journée', async () => {
    const { service } = buildService({
      activities: [
        activity('act-1', '2026-01-05T07:00:00Z', 3600),
        activity('act-2', '2026-01-05T18:00:00Z', 3600),
      ],
      zoneRows: [
        { activityId: 'act-1', zoneIndex: 4, seconds: 3600 },
        { activityId: 'act-2', zoneIndex: 4, seconds: 3600 },
      ],
    });

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(
      result.points.find((point) => point.date === '2026-01-05')?.load,
    ).toBeCloseTo(200, 1);
  });

  it('retombe sur le ressenti puis sur la durée selon ce que porte la séance', async () => {
    const { service } = buildService({
      activities: [
        activity('act-hr', '2026-01-02T08:00:00Z', 3600),
        activity('act-rpe', '2026-01-03T08:00:00Z', 3600, 8),
        activity('act-rien', '2026-01-04T08:00:00Z', 3600),
      ],
      zoneRows: [{ activityId: 'act-hr', zoneIndex: 4, seconds: 3600 }],
    });

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);
    const loadOn = (date: string) =>
      result.points.find((point) => point.date === date)?.load;

    expect(loadOn('2026-01-02')).toBeCloseTo(100, 1);
    expect(loadOn('2026-01-03')).toBeCloseTo(100, 1);
    expect(loadOn('2026-01-04')).toBeCloseTo(55, 1);
    expect(result.sourceCounts).toEqual({
      HEART_RATE: 1,
      PERCEIVED: 1,
      DURATION: 1,
    });
  });

  it('n’interroge pas les zones quand l’athlète n’en a pas de synchronisées', async () => {
    const { service, prisma } = buildService({
      athlete: { id: 'ath-1', heartRateZonesBpm: [] },
      activities: [activity('act-1', '2026-01-05T08:00:00Z', 3600, 5)],
    });

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(result.sourceCounts.PERCEIVED).toBe(1);
  });

  it('calcule depuis la première activité mais ne renvoie que la fenêtre demandée', async () => {
    const { service } = buildService({
      activities: [
        // Six mois d'entraînement régulier avant la fenêtre affichée : la CTL
        // du 1er janvier doit en avoir gardé la trace.
        ...Array.from({ length: 180 }, (_, day) =>
          activity(
            `act-${day}`,
            new Date(Date.UTC(2025, 6, 1) + day * 86400000).toISOString(),
            3600,
          ),
        ),
      ],
      zoneRows: Array.from({ length: 180 }, (_, day) => ({
        activityId: `act-${day}`,
        zoneIndex: 2,
        seconds: 3600,
      })),
    });

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(result.points[0].date).toBe('2026-01-01');
    expect(result.points).toHaveLength(10);
    // Une heure en Z2 par jour = 55 de charge quotidienne ; à l'équilibre la
    // CTL y tend, et elle serait repartie de zéro si la série avait démarré au
    // 1er janvier.
    expect(result.points[0].ctl).toBeGreaterThan(40);
    expect(result.points[0].settled).toBe(true);
  });

  it('écrit le cache TrainingLoad en une transaction', async () => {
    const { service, prisma } = buildService({
      activities: [activity('act-1', '2026-01-05T08:00:00Z', 3600)],
      zoneRows: [{ activityId: 'act-1', zoneIndex: 4, seconds: 3600 }],
    });

    await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(prisma.$transaction).toHaveBeenCalledWith([
      'delete-op',
      'create-op',
    ]);
    const rows = (
      prisma.trainingLoad.createMany.mock.calls as Array<
        [{ data: Array<{ athleteId: string; date: Date }> }]
      >
    )[0][0].data;
    expect(rows[0]).toMatchObject({ athleteId: 'ath-1' });
    expect(rows[0].date.toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('ne réécrit pas le cache quand rien n’a bougé', async () => {
    const { service, prisma } = buildService({
      activities: [activity('act-1', '2026-01-05T08:00:00Z', 3600)],
      zoneRows: [{ activityId: 'act-1', zoneIndex: 4, seconds: 3600 }],
    });

    // Premier calcul pour connaître la valeur que le cache est censé contenir.
    const first = await service.getSeries('user-1', Role.ATHLETE, QUERY);
    prisma.trainingLoad.findFirst.mockResolvedValue({
      date: new Date(`${first.current.date}T00:00:00.000Z`),
      ctl: first.current.ctl,
      atl: first.current.atl,
    });
    prisma.$transaction.mockClear();

    await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rend quand même la série si le cache ne s’écrit pas', async () => {
    const { service, prisma } = buildService({
      activities: [activity('act-1', '2026-01-05T08:00:00Z', 3600)],
      zoneRows: [{ activityId: 'act-1', zoneIndex: 4, seconds: 3600 }],
    });
    prisma.$transaction.mockRejectedValue(new Error('base indisponible'));

    const result = await service.getSeries('user-1', Role.ATHLETE, QUERY);

    expect(result.activityCount).toBe(1);
  });

  it('refuse une fenêtre à l’envers', async () => {
    const { service } = buildService();

    await expect(
      service.getSeries('user-1', Role.ATHLETE, {
        from: QUERY.to,
        to: QUERY.from,
      }),
    ).rejects.toThrow('`from` doit précéder `to`');
  });

  it('exige un athleteId côté coach', async () => {
    const { service } = buildService();

    await expect(
      service.getSeries('user-coach', Role.COACH, QUERY),
    ).rejects.toThrow('Profil coach introuvable');
  });
});
