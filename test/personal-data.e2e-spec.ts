import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { EXPORT_FORMAT } from '../src/users/personal-data.service';
import { ActivitySource, Role } from '../generated/prisma/enums';
import { E2E_JWT_SECRET } from './e2e-env';

// Droits RGPD de bout en bout, sur la vraie application et une vraie base
// PostgreSQL : consentement aux données de santé daté (art. 7 et 9), export
// (art. 15 et 20), effacement (art. 17). Les comptes portent un préfixe propre
// à l'exécution, supprimés à la fin.

const PASSWORD = 'Correct-horse-battery-7';
const FIT_BYTES = Buffer.from([0x0e, 0x10, 0x2e, 0x46, 0x49, 0x54, 0x00, 0x01]);

interface Account {
  email: string;
  token: string;
  userId: string;
}

describe('Droits RGPD (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;
  let prisma: PrismaService;
  let passwordHash: string;
  const emailPrefix = `e2e-rgpd-${randomUUID().slice(0, 8)}-`;

  const emailFor = (label: string) => `${emailPrefix}${label}@example.test`;

  // Comptes de fixture écrits en base, jeton signé avec le secret des tests :
  // /auth/register est plafonné à 10 requêtes par minute, et seuls les tests
  // du consentement portent sur l'inscription elle-même.
  async function createAccount(
    label: string,
    role: Role = Role.ATHLETE,
  ): Promise<Account> {
    const email = emailFor(label);
    const user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        role,
        healthDataConsentAt: role === Role.ATHLETE ? new Date() : null,
        athleteProfile: role === Role.ATHLETE ? { create: {} } : undefined,
        coachProfile: role === Role.COACH ? { create: {} } : undefined,
      },
    });
    const token = new JwtService().sign(
      { sub: user.id, email, role },
      { secret: E2E_JWT_SECRET, expiresIn: '1h', jwtid: randomUUID() },
    );
    return { email, token, userId: user.id };
  }

  // Une activité complète : laps, points GPS et .fit d'origine, pour vérifier
  // que l'export les rend et que l'effacement les emporte.
  async function seedActivity(userId: string, fileHash: string) {
    const profile = await prisma.athleteProfile.findUniqueOrThrow({
      where: { userId },
    });
    return prisma.activity.create({
      data: {
        athleteId: profile.id,
        source: ActivitySource.FIT,
        fileHash,
        fitFileData: FIT_BYTES,
        startedAt: new Date('2026-11-01T08:00:00Z'),
        totalDistanceM: 10000,
        totalDurationSec: 3000,
        avgHeartRate: 152,
        athleteNote: 'jambes lourdes',
        laps: { create: [{ index: 0, distanceM: 1000, durationSec: 300 }] },
        trackPoints: {
          create: [
            {
              timestamp: new Date('2026-11-01T08:00:00Z'),
              elapsedSec: 0,
              latitude: 48.8566,
              longitude: 2.3522,
              heartRate: 120,
            },
          ],
        },
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    passwordHash = await bcrypt.hash(PASSWORD, 4);
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
    await app?.close();
  });

  describe('Consentement aux données de santé', () => {
    it('inscription d’un athlète sans consentement : 400, aucun compte créé', async () => {
      await request(server)
        .post('/auth/register')
        .send({
          email: emailFor('no-consent'),
          password: PASSWORD,
          role: Role.ATHLETE,
        })
        .expect(400);

      expect(
        await prisma.user.findUnique({
          where: { email: emailFor('no-consent') },
        }),
      ).toBeNull();
    });

    it('inscription avec consentement : date enregistrée et renvoyée par /users/me', async () => {
      const before = new Date();
      const registered = await request(server)
        .post('/auth/register')
        .send({
          email: emailFor('consent'),
          password: PASSWORD,
          role: Role.ATHLETE,
          healthDataConsent: true,
        })
        .expect(201);
      const { accessToken } = registered.body as { accessToken: string };

      const res = await request(server)
        .get('/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const consentAt = new Date(
        (res.body as { healthDataConsentAt: string }).healthDataConsentAt,
      );
      expect(consentAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
    });

    it('compte créé avant la case : consentement daté à la demande, date d’origine conservée ensuite', async () => {
      const athlete = await createAccount('legacy');
      await prisma.user.update({
        where: { id: athlete.userId },
        data: { healthDataConsentAt: null },
      });

      await request(server)
        .post('/users/me/health-consent')
        .set('Authorization', `Bearer ${athlete.token}`)
        .send({ healthDataConsent: false })
        .expect(400);

      const first = await request(server)
        .post('/users/me/health-consent')
        .set('Authorization', `Bearer ${athlete.token}`)
        .send({ healthDataConsent: true })
        .expect(200);
      const second = await request(server)
        .post('/users/me/health-consent')
        .set('Authorization', `Bearer ${athlete.token}`)
        .send({ healthDataConsent: true })
        .expect(200);

      const firstAt = (first.body as { healthDataConsentAt: string })
        .healthDataConsentAt;
      expect(firstAt).toEqual(expect.any(String));
      expect(
        (second.body as { healthDataConsentAt: string }).healthDataConsentAt,
      ).toBe(firstAt);
    });
  });

  describe('Export des données', () => {
    it('rend compte, activités, points GPS et .fit d’origine, sans aucun secret', async () => {
      const athlete = await createAccount('export');
      const activity = await seedActivity(
        athlete.userId,
        `${emailPrefix}export`,
      );
      await prisma.stravaToken.create({
        data: {
          athlete: { connect: { userId: athlete.userId } },
          accessToken: 'secret-access-token',
          refreshToken: 'secret-refresh-token',
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        },
      });

      const res = await request(server)
        .get('/users/me/export')
        .set('Authorization', `Bearer ${athlete.token}`)
        .expect(200)
        .expect('Content-Type', /application\/json/)
        .expect(
          'Content-Disposition',
          /attachment; filename="sessionized-export-\d{4}-\d{2}-\d{2}\.json"/,
        )
        .expect('Cache-Control', 'no-store');

      const body = res.body as {
        format: string;
        account: { email: string; healthDataConsentAt: string };
        strava: { connected: boolean };
        activities: {
          id: string;
          athleteNote: string;
          laps: unknown[];
          trackPoints: { latitude: number }[];
          fitFile: { encoding: string; data: string };
        }[];
      };
      expect(body.format).toBe(EXPORT_FORMAT);
      expect(body.account.email).toBe(athlete.email);
      expect(body.account.healthDataConsentAt).toEqual(expect.any(String));
      expect(body.strava.connected).toBe(true);
      expect(body.activities).toHaveLength(1);
      expect(body.activities[0]).toMatchObject({
        id: activity.id,
        athleteNote: 'jambes lourdes',
      });
      expect(body.activities[0].laps).toHaveLength(1);
      expect(body.activities[0].trackPoints[0].latitude).toBe(48.8566);
      expect(
        Buffer.from(body.activities[0].fitFile.data, 'base64').equals(
          FIT_BYTES,
        ),
      ).toBe(true);

      const raw = JSON.stringify(body);
      expect(raw).not.toContain('secret-access-token');
      expect(raw).not.toContain('secret-refresh-token');
      expect(raw).not.toContain('$2b$'); // préfixe d'un hash bcrypt
    });

    it('ne contient rien d’un autre athlète', async () => {
      const owner = await createAccount('export-owner');
      const stranger = await createAccount('export-stranger');
      await seedActivity(stranger.userId, `${emailPrefix}stranger`);

      const res = await request(server)
        .get('/users/me/export')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect((res.body as { activities: unknown[] }).activities).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain(stranger.email);
    });

    it('réservé aux athlètes : un coach reçoit 403', async () => {
      const coach = await createAccount('export-coach', Role.COACH);

      await request(server)
        .get('/users/me/export')
        .set('Authorization', `Bearer ${coach.token}`)
        .expect(403);
    });
  });

  describe('Suppression du compte', () => {
    it('mauvais mot de passe : 403 (la session reste valide), rien n’est supprimé', async () => {
      const athlete = await createAccount('delete-wrong');

      await request(server)
        .delete('/users/me')
        .set('Authorization', `Bearer ${athlete.token}`)
        .send({ password: 'pas-le-bon-mot-de-passe' })
        .expect(403);

      expect(
        await prisma.user.findUnique({ where: { id: athlete.userId } }),
      ).not.toBeNull();
    });

    it('sans mot de passe : 400', async () => {
      const athlete = await createAccount('delete-empty');

      await request(server)
        .delete('/users/me')
        .set('Authorization', `Bearer ${athlete.token}`)
        .send({})
        .expect(400);
    });

    it('bon mot de passe : 204, compte et données effacés en cascade, connexion impossible', async () => {
      const athlete = await createAccount('delete-ok');
      const activity = await seedActivity(
        athlete.userId,
        `${emailPrefix}delete`,
      );

      await request(server)
        .delete('/users/me')
        .set('Authorization', `Bearer ${athlete.token}`)
        .send({ password: PASSWORD })
        .expect(204);

      expect(
        await prisma.user.findUnique({ where: { id: athlete.userId } }),
      ).toBeNull();
      expect(
        await prisma.athleteProfile.findUnique({
          where: { userId: athlete.userId },
        }),
      ).toBeNull();
      expect(
        await prisma.activity.findUnique({ where: { id: activity.id } }),
      ).toBeNull();
      expect(
        await prisma.trackPoint.count({ where: { activityId: activity.id } }),
      ).toBe(0);

      await request(server)
        .post('/auth/login')
        .send({ email: athlete.email, password: PASSWORD })
        .expect(401);
    });

    it('réservé aux athlètes : un coach reçoit 403 et garde son compte', async () => {
      const coach = await createAccount('delete-coach', Role.COACH);

      await request(server)
        .delete('/users/me')
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ password: PASSWORD })
        .expect(403);

      expect(
        await prisma.user.findUnique({ where: { id: coach.userId } }),
      ).not.toBeNull();
    });
  });
});
