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
// importées (aucune).
function makeService(storedToken: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}) {
  const prisma = {
    stravaToken: { findUnique: jest.fn().mockResolvedValue(storedToken) },
    activity: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;
  const activitiesService = {
    findUnlinkedWorkoutIdForDate: jest.fn().mockResolvedValue(undefined),
  } as unknown as ActivitiesService;
  const usersService = {
    getAthleteProfile: jest.fn().mockResolvedValue({ id: 'athlete-1' }),
    updateAthleteZones: jest.fn(),
  } as unknown as UsersService;
  const config = new ConfigService({
    STRAVA_CLIENT_ID: 'client',
    STRAVA_CLIENT_SECRET: 'secret',
  });

  return new StravaService(
    prisma,
    usersService,
    activitiesService,
    config,
    new JwtService(),
    currentCipher,
  );
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
