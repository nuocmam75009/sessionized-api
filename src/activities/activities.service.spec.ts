import { BadRequestException, ConflictException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  ActivitySource,
  LapIntensity,
  LapIntensitySource,
} from '../../generated/prisma/enums';

type InsertedRow = Record<string, unknown>;

// Les mocks Jest ne sont pas typés : on décrit ici la forme réellement attendue
// des arguments de `createMany` / `update` pour pouvoir les inspecter sans `any`.
function insertedRows(mock: jest.Mock): InsertedRow[] {
  const calls = mock.mock.calls as Array<[{ data: InsertedRow[] }]>;
  return calls[0][0].data;
}

function updatedFields(mock: jest.Mock): InsertedRow {
  const calls = mock.mock.calls as Array<[{ data: InsertedRow }]>;
  return calls[0][0].data;
}

const STARTED_AT = new Date('2026-08-28T16:22:26.000Z');

const FIT_FILE = {
  buffer: Buffer.from('contenu-fit'),
  originalname: 'seance.fit',
} as Express.Multer.File;

// Séance piste vue par la montre : le .fit porte l'intensité des laps et les
// métriques de foulée, que l'API Strava ne renvoie pas.
function buildParsedFit(overrides: Record<string, unknown> = {}) {
  return {
    sessions: [
      {
        start_time: STARTED_AT.toISOString(),
        sub_sport: 'track',
        total_ascent: 12,
        total_descent: 14,
        avg_power: 333,
        total_calories: 999,
      },
    ],
    laps: [
      {
        start_time: STARTED_AT.toISOString(),
        intensity: 'active',
        total_distance: 400,
        total_elapsed_time: 78,
        avg_speed: 5.13,
        avg_heart_rate: 164,
        avg_stance_time: 210,
        avg_step_length: 1420,
      },
      {
        start_time: STARTED_AT.toISOString(),
        intensity: 'recovery',
        total_distance: 32.5,
        total_elapsed_time: 120,
        avg_speed: 0.27,
        avg_heart_rate: 143,
      },
    ],
    records: [],
    ...overrides,
  };
}

function buildStravaActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    athleteId: 'ath-1',
    source: ActivitySource.STRAVA,
    startedAt: STARTED_AT,
    fitFileData: null,
    subSport: null,
    elevationGainM: 0,
    elevationLossM: null,
    avgPower: null,
    totalCalories: 507,
    ...overrides,
  };
}

function buildHarness(
  activityOverrides: Record<string, unknown> = {},
  parsedOverrides: Record<string, unknown> = {},
) {
  const prisma = {
    activity: {
      findUnique: jest
        .fn()
        .mockResolvedValue(buildStravaActivity(activityOverrides)),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockReturnValue('update-op'),
    },
    lap: {
      deleteMany: jest.fn().mockReturnValue('lap-delete-op'),
      createMany: jest.fn().mockReturnValue('lap-create-op'),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const usersService = {
    getAthleteProfile: jest.fn().mockResolvedValue({ id: 'ath-1' }),
  };

  const service = new ActivitiesService(
    prisma as unknown as PrismaService,
    usersService as unknown as UsersService,
  );
  Object.defineProperty(service, 'fitParser', {
    value: {
      parseAsync: jest.fn().mockResolvedValue(buildParsedFit(parsedOverrides)),
    },
  });

  return { service, prisma };
}

describe('ActivitiesService.attachFitFile', () => {
  it('remplace les laps par ceux du .fit, intensité native comprise', async () => {
    const { service, prisma } = buildHarness();

    const result = await service.attachFitFile('user-1', 'act-1', FIT_FILE);

    expect(prisma.lap.deleteMany).toHaveBeenCalledWith({
      where: { activityId: 'act-1' },
    });
    const laps = insertedRows(prisma.lap.createMany);
    expect(laps).toHaveLength(2);
    expect(laps[0]).toMatchObject({
      activityId: 'act-1',
      index: 0,
      intensity: LapIntensity.ACTIVE,
      // Ce .fit de test déclare l'intensité : elle vient de la montre.
      intensitySource: LapIntensitySource.DEVICE,
      distanceM: 400,
      avgStanceTimeMs: 210,
      avgStepLengthMm: 1420,
    });
    expect(laps[1]).toMatchObject({
      index: 1,
      intensity: LapIntensity.RECOVERY,
      intensitySource: LapIntensitySource.DEVICE,
    });
    expect(result.lapsCount).toBe(2);
  });

  it("estime l'intensité quand le .fit ne la déclare pas", async () => {
    // Cas des montres Coros : aucun lap ne porte le champ `intensity`.
    const { service, prisma } = buildHarness(
      {},
      {
        laps: [
          { total_distance: 400, total_elapsed_time: 78, avg_speed: 5.13 },
          { total_distance: 33, total_elapsed_time: 120, avg_speed: 0.27 },
          { total_distance: 400, total_elapsed_time: 79, avg_speed: 5.07 },
          { total_distance: 34, total_elapsed_time: 101, avg_speed: 0.38 },
        ],
      },
    );

    await service.attachFitFile('user-1', 'act-1', FIT_FILE);

    expect(insertedRows(prisma.lap.createMany)).toMatchObject([
      {
        intensity: LapIntensity.INTERVAL,
        intensitySource: LapIntensitySource.DERIVED,
      },
      {
        intensity: LapIntensity.RECOVERY,
        intensitySource: LapIntensitySource.DERIVED,
      },
      {
        intensity: LapIntensity.INTERVAL,
        intensitySource: LapIntensitySource.DERIVED,
      },
      {
        intensity: LapIntensity.RECOVERY,
        intensitySource: LapIntensitySource.DERIVED,
      },
    ]);
  });

  it("ne touche à aucune autre donnée de l'activité", async () => {
    const { service, prisma } = buildHarness();

    await service.attachFitFile('user-1', 'act-1', FIT_FILE);

    // Strava reste la source de tout le reste : le .fit ne doit écrire que
    // lui-même, jamais le dénivelé, les calories ou le sous-sport qu'il porte
    // pourtant aussi.
    expect(Object.keys(updatedFields(prisma.activity.update)).sort()).toEqual([
      'fitFileData',
      'fitFileHash',
    ]);
  });

  it('refuse un .fit qui correspond à une autre séance', async () => {
    const { service } = buildHarness(
      {},
      {
        sessions: [
          { start_time: new Date('2026-08-28T18:00:00.000Z').toISOString() },
        ],
      },
    );

    await expect(
      service.attachFitFile('user-1', 'act-1', FIT_FILE),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tolère le décalage de quelques secondes introduit par Strava', async () => {
    const { service, prisma } = buildHarness(
      {},
      {
        sessions: [
          { start_time: new Date(STARTED_AT.getTime() - 8_000).toISOString() },
        ],
      },
    );

    await service.attachFitFile('user-1', 'act-1', FIT_FILE);

    expect(prisma.lap.createMany).toHaveBeenCalled();
  });

  it('refuse un .fit qui ne contient aucun tour', async () => {
    const { service, prisma } = buildHarness({}, { laps: [] });

    await expect(
      service.attachFitFile('user-1', 'act-1', FIT_FILE),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse une activité qui a déjà un .fit', async () => {
    const { service } = buildHarness({ fitFileData: new Uint8Array([1, 2]) });

    await expect(
      service.attachFitFile('user-1', 'act-1', FIT_FILE),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse un .fit déjà importé comme activité à part entière', async () => {
    const { service, prisma } = buildHarness();
    prisma.activity.findFirst.mockResolvedValue({ id: 'act-doublon' });

    await expect(
      service.attachFitFile('user-1', 'act-1', FIT_FILE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse une requête sans fichier', async () => {
    const { service } = buildHarness();

    await expect(
      service.attachFitFile('user-1', 'act-1', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
