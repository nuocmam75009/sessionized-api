import { randomBytes } from 'node:crypto';
import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsersService } from '../users/users.service';
import type { ActivitiesService } from '../activities/activities.service';
import { StravaTokenCipher } from './strava-token-cipher';
import { STRAVA_RECONNECT_REQUIRED } from './strava-reconnect-required.exception';
import { STRAVA_RATE_LIMITED } from './strava-rate-limit';
import { StravaService } from './strava.service';

const newKey = () => randomBytes(32).toString('base64');
const cipherWithKey = (key: string) =>
  new StravaTokenCipher(
    new ConfigService({ STRAVA_TOKEN_ENCRYPTION_KEY: key }),
  );
const currentCipher = cipherWithKey(newKey());
const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);

// Service réel, dépendances réduites à ce que syncActivities touche jusqu'aux
// appels Strava d'un import : profil athlète, token enregistré, activités déjà
// importées (aucune), et l'écriture de l'activité importée.
function makeHarness(storedToken: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}) {
  const activity = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'act-1', laps: [] }),
  };
  const prisma = {
    stravaToken: { findUnique: jest.fn().mockResolvedValue(storedToken) },
    activity,
  } as unknown as PrismaService;
  const activitiesService = {
    findUnlinkedWorkoutIdForDate: jest.fn().mockResolvedValue(undefined),
    assertWorkoutIsAssignable: jest
      .fn()
      .mockResolvedValue({ id: 'workout-1', training: false }),
  };
  const usersService = {
    getAthleteProfile: jest.fn().mockResolvedValue({ id: 'athlete-1' }),
    updateAthleteZones: jest.fn(),
  } as unknown as UsersService;
  const config = new ConfigService({
    STRAVA_CLIENT_ID: 'client',
    STRAVA_CLIENT_SECRET: 'secret',
  });

  const service = new StravaService(
    prisma,
    usersService,
    activitiesService as unknown as ActivitiesService,
    config,
    new JwtService(),
    currentCipher,
  );
  return { service, activityCreate: activity.create, activitiesService };
}

function makeService(storedToken: Parameters<typeof makeHarness>[0]) {
  return makeHarness(storedToken).service;
}

function syncError(service: StravaService): Promise<unknown> {
  return service.syncActivities('user-1').then(
    () => null,
    (err: unknown) => err,
  );
}

function expectReconnectRequired(err: unknown) {
  expect(err).toMatchObject({ status: 409 });
  expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({
    code: STRAVA_RECONNECT_REQUIRED,
  });
}

describe('StravaService.syncActivities — connexion Strava inutilisable', () => {
  let fetchSpy: jest.SpyInstance;

  // Les échecs attendus sont journalisés : on les tait pour garder la sortie
  // des tests lisible.
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('token chiffré avec une autre clé : 409 à reconnecter, sans appeler Strava', async () => {
    const otherCipher = cipherWithKey(newKey());
    const service = makeService({
      accessToken: otherCipher.encrypt('access'),
      refreshToken: otherCipher.encrypt('refresh'),
      expiresAt: inOneHour(),
    });

    expectReconnectRequired(await syncError(service));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accès retiré depuis Strava (401) : 409 à reconnecter', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));
    const service = makeService({
      accessToken: currentCipher.encrypt('access'),
      refreshToken: currentCipher.encrypt('refresh'),
      expiresAt: inOneHour(),
    });

    expectReconnectRequired(await syncError(service));
  });

  it('refresh token refusé par Strava (400) : 409 à reconnecter', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 400 }));
    const service = makeService({
      accessToken: currentCipher.encrypt('access'),
      refreshToken: currentCipher.encrypt('refresh'),
      expiresAt: new Date(Date.now() - 1000),
    });

    expectReconnectRequired(await syncError(service));
  });

  it('Strava en panne (503) : 502, une reconnexion ne servirait à rien', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 503 }));
    const service = makeService({
      accessToken: currentCipher.encrypt('access'),
      refreshToken: currentCipher.encrypt('refresh'),
      expiresAt: inOneHour(),
    });

    expect(await syncError(service)).toBeInstanceOf(BadGatewayException);
  });
});

// Réponse réelle de Strava quand le quota de lecture de l'application est
// dépassé (cf. logs du 07/11/2026).
const rateLimitedResponse = () =>
  new Response(
    JSON.stringify({
      message: 'Rate Limit Exceeded',
      errors: [
        {
          resource: 'Application',
          field: 'read rate limit',
          code: 'exceeded',
        },
      ],
    }),
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': '200,2000',
        'X-RateLimit-Usage': '101,640',
        'X-ReadRateLimit-Limit': '100,1000',
        'X-ReadRateLimit-Usage': '101,640',
      },
    },
  );
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const summaryActivity = (id: number) => ({
  id,
  name: `Run ${id}`,
  sport_type: 'Run',
  start_date: '2026-11-07T08:00:00Z',
  distance: 10000,
  moving_time: 3000,
  elapsed_time: 3100,
  total_elevation_gain: 50,
});

function expectRateLimited(err: unknown) {
  expect(err).toMatchObject({ status: 503 });
  expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({
    code: STRAVA_RATE_LIMITED,
    retryAfterSec: expect.any(Number) as number,
  });
}

describe('StravaService.syncActivities — quota Strava épuisé (429)', () => {
  let fetchSpy: jest.SpyInstance;
  const validToken = () => ({
    accessToken: currentCipher.encrypt('access'),
    refreshToken: currentCipher.encrypt('refresh'),
    expiresAt: inOneHour(),
  });

  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('429 de Strava : 503 STRAVA_RATE_LIMITED, ni 502 ni reconnexion', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(rateLimitedResponse()));
    const service = makeService(validToken());

    expectRateLimited(await syncError(service));
  });

  it('après un 429, les syncs suivants n’appellent plus Strava avant la réinitialisation', async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(rateLimitedResponse()));
    const service = makeService(validToken());
    await syncError(service);
    fetchSpy.mockClear();

    expectRateLimited(await syncError(service));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('429 pendant les imports : le sync échoue au lieu d’annoncer 0 activité importée', async () => {
    fetchSpy.mockImplementation((input: string) => {
      if (input.includes('/athlete/activities')) {
        return Promise.resolve(
          jsonResponse([summaryActivity(1), summaryActivity(2)]),
        );
      }
      if (input.endsWith('/athlete/zones')) {
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(rateLimitedResponse());
    });
    const service = makeService(validToken());

    expectRateLimited(await syncError(service));
    // Imports interrompus dès la première activité : la seconde n'est pas
    // demandée à Strava.
    const calledUrls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.includes('/activities/2'))).toBe(false);
  });
});

describe('StravaService.importActivity — laps situés sur la trace', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  afterEach(() => jest.restoreAllMocks());

  it('prend le départ de chaque lap dans le stream `time`, arrêts compris', async () => {
    // Deux laps de 3 s en mouvement, séparés par un arrêt de 40 s : la somme
    // des `moving_time` placerait le second à 3 s, la trace le place à 43 s.
    const laps = [
      { lap_index: 1, distance: 15, moving_time: 3, start_index: 0 },
      { lap_index: 2, distance: 15, moving_time: 3, start_index: 3 },
    ];
    const streams = { time: { data: [0, 1, 2, 43, 44, 45] } };
    const fetchSpy: jest.SpyInstance = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith('/laps')) return Promise.resolve(jsonResponse(laps));
      if (url.includes('/streams')) {
        return Promise.resolve(jsonResponse(streams));
      }
      return Promise.resolve(jsonResponse(summaryActivity(1)));
    });
    const { service, activityCreate } = makeHarness({
      accessToken: currentCipher.encrypt('access'),
      refreshToken: currentCipher.encrypt('refresh'),
      expiresAt: inOneHour(),
    });

    await service.importActivity('user-1', '1', {});

    const calls = activityCreate.mock.calls as Array<
      [{ data: { laps: { create: Array<Record<string, unknown>> } } }]
    >;
    expect(calls[0][0].data.laps.create).toMatchObject([
      { durationSec: 3, startElapsedSec: 0 },
      { durationSec: 3, startElapsedSec: 43 },
    ]);
  });
});

describe('StravaService.importActivity — flag training', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  afterEach(() => jest.restoreAllMocks());

  // Import d'une activité sans laps ni trace, dont Strava renvoie `detail`.
  async function importedTraining(
    detail: Record<string, unknown>,
    dto: { workoutId?: string; training?: boolean } = {},
    workoutTraining = false,
  ) {
    const fetchSpy: jest.SpyInstance = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith('/laps')) return Promise.resolve(jsonResponse([]));
      if (url.includes('/streams')) return Promise.resolve(jsonResponse({}));
      return Promise.resolve(jsonResponse(detail));
    });
    const { service, activityCreate, activitiesService } = makeHarness({
      accessToken: currentCipher.encrypt('access'),
      refreshToken: currentCipher.encrypt('refresh'),
      expiresAt: inOneHour(),
    });
    activitiesService.assertWorkoutIsAssignable.mockResolvedValue({
      id: 'workout-1',
      training: workoutTraining,
    });

    await service.importActivity('user-1', '1', dto);

    const calls = activityCreate.mock.calls as Array<
      [{ data: { training: boolean } }]
    >;
    return calls[0][0].data.training;
  }

  it('activité libellée « Workout » sur Strava : séance de qualité', async () => {
    await expect(
      importedTraining({ ...summaryActivity(1), workout_type: 3 }),
    ).resolves.toBe(true);
  });

  it('sans libellé ni workout : séance ordinaire', async () => {
    await expect(importedTraining(summaryActivity(1))).resolves.toBe(false);
  });

  it('hérite du workout prescrit, même sans libellé Strava', async () => {
    await expect(
      importedTraining(summaryActivity(1), { workoutId: 'workout-1' }, true),
    ).resolves.toBe(true);
  });

  it("le choix explicite de l'athlète l'emporte sur le libellé Strava", async () => {
    await expect(
      importedTraining(
        { ...summaryActivity(1), workout_type: 3 },
        { training: false },
      ),
    ).resolves.toBe(false);
  });
});
