import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActivitySource, Role } from '../generated/prisma/enums';
import { E2E_JWT_SECRET } from './e2e-env';

// Tests de sécurité de l'API, de bout en bout : vraie application (mêmes
// guards, pipes, en-têtes que main.ts), vraie base PostgreSQL et vrai Redis.
// Chaque refus est accompagné d'un témoin qui réussit : un 403 ne prouve rien
// si la route renvoie 403 à tout le monde.
//
// Les comptes portent un préfixe propre à l'exécution : pas de collision avec
// une exécution précédente (en base, ni dans les compteurs Redis de tentatives
// de connexion), et suppression ciblée à la fin.

const PASSWORD = 'correct-horse-battery';

interface Account {
  email: string;
  token: string;
  userId: string;
}

const b64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

describe('Sécurité de l’API (e2e)', () => {
  let app: NestExpressApplication;
  let server: App;
  let prisma: PrismaService;
  const runId = randomUUID().slice(0, 8);
  const emailPrefix = `e2e-${runId}-`;

  // A et B : athlètes ; coachA : coach de A ; otherCoach : coach sans lien.
  let athleteA: Account;
  let athleteB: Account;
  let coachA: Account;
  let otherCoach: Account;
  let activityId: string;

  const bearer = (account: Account | string) =>
    `Bearer ${typeof account === 'string' ? account : account.token}`;

  async function register(label: string, role: Role): Promise<Account> {
    const email = `${emailPrefix}${label}@example.test`;
    const res = await request(server)
      .post('/auth/register')
      .send({ email, password: PASSWORD, role })
      .expect(201);
    const body = res.body as { accessToken: string; user: { sub: string } };
    return { email, token: body.accessToken, userId: body.user.sub };
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

    athleteA = await register('athlete-a', Role.ATHLETE);
    athleteB = await register('athlete-b', Role.ATHLETE);
    coachA = await register('coach-a', Role.COACH);
    otherCoach = await register('other-coach', Role.COACH);

    // Fixtures écrites directement en base : un import .fit n'apporterait rien
    // à ce que ces tests vérifient (le contrôle d'accès).
    const coachProfile = await prisma.coachProfile.findUniqueOrThrow({
      where: { userId: coachA.userId },
    });
    const athleteProfile = await prisma.athleteProfile.update({
      where: { userId: athleteA.userId },
      data: { coachId: coachProfile.id },
    });
    const activity = await prisma.activity.create({
      data: {
        athleteId: athleteProfile.id,
        source: ActivitySource.FIT,
        fileHash: `e2e-${runId}`,
        startedAt: new Date('2026-11-01T08:00:00Z'),
        totalDistanceM: 10000,
        totalDurationSec: 3000,
        athleteNote: 'note originale',
      },
    });
    activityId = activity.id;
  });

  afterAll(async () => {
    // Profils, activités et rattachements suivent par cascade.
    await prisma?.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
    await app?.close();
  });

  describe('A01 — Contrôle d’accès (IDOR, rôles)', () => {
    it('témoin : l’athlète lit sa propre activité', async () => {
      const res = await request(server)
        .get(`/activities/${activityId}`)
        .set('Authorization', bearer(athleteA))
        .expect(200);
      expect(res.body).toMatchObject({ id: activityId });
    });

    it('témoin : le coach rattaché lit l’activité de son athlète', async () => {
      await request(server)
        .get(`/activities/${activityId}`)
        .set('Authorization', bearer(coachA))
        .expect(200);
    });

    it('IDOR : un autre athlète ne lit ni l’activité ni sa trace GPS', async () => {
      for (const path of [
        `/activities/${activityId}`,
        `/activities/${activityId}/track`,
      ]) {
        const res = await request(server)
          .get(path)
          .set('Authorization', bearer(athleteB))
          .expect(403);
        expect(res.body).not.toHaveProperty('totalDistanceM');
      }
    });

    it('IDOR : la liste d’un autre athlète ne contient pas l’activité', async () => {
      const res = await request(server)
        .get('/activities')
        .set('Authorization', bearer(athleteB))
        .expect(200);
      const ids = (res.body as { id: string }[]).map((a) => a.id);
      expect(ids).not.toContain(activityId);
    });

    it('un coach non rattaché ne lit pas l’activité', async () => {
      await request(server)
        .get(`/activities/${activityId}`)
        .set('Authorization', bearer(otherCoach))
        .expect(403);
    });

    it('IDOR : un autre athlète ne modifie ni ne supprime l’activité', async () => {
      await request(server)
        .patch(`/activities/${activityId}`)
        .set('Authorization', bearer(athleteB))
        .send({ athleteNote: 'modifiée par B' })
        .expect(404);
      await request(server)
        .delete(`/activities/${activityId}`)
        .set('Authorization', bearer(athleteB))
        .expect(404);

      const activity = await prisma.activity.findUnique({
        where: { id: activityId },
      });
      expect(activity?.athleteNote).toBe('note originale');
    });

    it('rôle interdit : un athlète n’accède pas à une route coach', async () => {
      await request(server)
        .post('/workouts')
        .set('Authorization', bearer(athleteA))
        .send({})
        .expect(403);
    });

    it('rôle interdit : un coach ne supprime pas une activité', async () => {
      await request(server)
        .delete(`/activities/${activityId}`)
        .set('Authorization', bearer(coachA))
        .expect(403);
      expect(
        await prisma.activity.findUnique({ where: { id: activityId } }),
      ).not.toBeNull();
    });

    it('élévation de privilège : le rôle ne se change pas via PATCH /users/me', async () => {
      await request(server)
        .patch('/users/me')
        .set('Authorization', bearer(athleteA))
        .send({ role: Role.COACH, firstName: 'Alex' })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: athleteA.userId },
      });
      expect(user.role).toBe(Role.ATHLETE);
      expect(user.firstName).toBe('Alex');
    });
  });

  describe('A07 — Authentification et jetons JWT', () => {
    const jwt = new JwtService();
    const payloadOf = (account: Account) => ({
      sub: account.userId,
      email: account.email,
      role: Role.ATHLETE,
    });

    it('témoin : le jeton d’inscription donne accès au profil', async () => {
      await request(server)
        .get('/users/me')
        .set('Authorization', bearer(athleteA))
        .expect(200);
    });

    it('sans jeton : 401', async () => {
      await request(server).get('/users/me').expect(401);
    });

    it('jeton expiré : 401', async () => {
      const expired = jwt.sign(
        { ...payloadOf(athleteA), exp: Math.floor(Date.now() / 1000) - 60 },
        { secret: E2E_JWT_SECRET },
      );
      await request(server)
        .get('/users/me')
        .set('Authorization', bearer(expired))
        .expect(401);
    });

    it('jeton modifié (rôle passé à COACH sans nouvelle signature) : 401', async () => {
      const [header, payload, signature] = athleteA.token.split('.');
      const claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as Record<string, unknown>;
      const forged = [
        header,
        b64url({ ...claims, role: Role.COACH }),
        signature,
      ].join('.');

      await request(server)
        .get('/users/me/athletes')
        .set('Authorization', bearer(forged))
        .expect(401);
    });

    it('jeton signé avec un autre secret : 401', async () => {
      const foreign = jwt.sign(payloadOf(athleteA), {
        secret: 'un-autre-secret-que-celui-du-serveur',
      });
      await request(server)
        .get('/users/me')
        .set('Authorization', bearer(foreign))
        .expect(401);
    });

    it('jeton non signé (alg: none) : 401', async () => {
      const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payloadOf(athleteA))}.`;
      await request(server)
        .get('/users/me')
        .set('Authorization', bearer(unsigned))
        .expect(401);
    });

    it('state OAuth Strava (même secret) refusé comme jeton d’accès : 401', async () => {
      const state = jwt.sign(
        { athleteId: athleteA.userId },
        {
          secret: E2E_JWT_SECRET,
          audience: 'strava-oauth-state',
          expiresIn: '10m',
        },
      );
      await request(server)
        .get('/users/me')
        .set('Authorization', bearer(state))
        .expect(401);
    });

    it('connexion : même réponse pour un email inconnu et un mauvais mot de passe', async () => {
      const unknown = await request(server)
        .post('/auth/login')
        .send({
          email: `${emailPrefix}nobody@example.test`,
          password: PASSWORD,
        })
        .expect(401);
      const wrongPassword = await request(server)
        .post('/auth/login')
        .send({ email: athleteA.email, password: 'wrong-password' })
        .expect(401);

      expect(wrongPassword.body).toEqual(unknown.body);
    });

    it('force brute : après 5 échecs, le compte est verrouillé même avec le bon mot de passe', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await request(server)
          .post('/auth/login')
          .send({ email: athleteB.email, password: 'wrong-password' })
          .expect(401);
      }

      await request(server)
        .post('/auth/login')
        .send({ email: athleteB.email, password: PASSWORD })
        .expect(429);
    });
  });

  describe('A03 / A04 — Validation des entrées', () => {
    it('inscription avec un rôle inexistant : 400', async () => {
      await request(server)
        .post('/auth/register')
        .send({
          email: `${emailPrefix}admin@example.test`,
          password: PASSWORD,
          role: 'ADMIN',
        })
        .expect(400);
      expect(
        await prisma.user.findUnique({
          where: { email: `${emailPrefix}admin@example.test` },
        }),
      ).toBeNull();
    });

    it('identifiant forgé (injection) : 404, sans erreur serveur', async () => {
      await request(server)
        .get(`/activities/${encodeURIComponent("' OR '1'='1")}`)
        .set('Authorization', bearer(athleteA))
        .expect(404);
    });

    it('upload : un fichier qui n’est pas un .fit est refusé (400)', async () => {
      await request(server)
        .post('/activities/upload')
        .set('Authorization', bearer(athleteA))
        .attach('file', Buffer.from('MZ fake executable'), 'payload.exe')
        .expect(400);
    });

    it('upload : un fichier de plus de 20 Mo est refusé (413)', async () => {
      await request(server)
        .post('/activities/upload')
        .set('Authorization', bearer(athleteA))
        .attach('file', Buffer.alloc(20 * 1024 * 1024 + 1), 'huge.fit')
        .expect(413);
    });
  });

  describe('A05 — Configuration de sécurité', () => {
    it('en-têtes de sécurité présents (helmet), X-Powered-By absent', async () => {
      const res = await request(server).get('/health').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy']).toContain(
        "frame-ancestors 'self'",
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('CORS : seule une origine autorisée reçoit Access-Control-Allow-Origin', async () => {
      const allowed = await request(server)
        .get('/health')
        .set('Origin', 'http://localhost:3000');
      expect(allowed.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );

      const foreign = await request(server)
        .get('/health')
        .set('Origin', 'https://evil.example');
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // Cas du jeu d'essai de l'upload (rncp/09-plans-de-tests.md) qui ne
  // demandent pas de vrai fichier .fit ; le cas 4 (plus de 20 Mo) est couvert
  // plus haut.
  describe('Jeu d’essai — upload d’un fichier .fit', () => {
    const upload = () => request(server).post('/activities/upload');

    it('cas 3 : un .gpx sur /activities/upload est refusé (400)', async () => {
      const res = await upload()
        .set('Authorization', bearer(athleteA))
        .attach('file', Buffer.from('<gpx></gpx>'), 'trace.gpx')
        .expect(400);
      expect(res.body).toMatchObject({
        message: 'Seuls les fichiers .fit sont acceptés',
      });
    });

    it('cas 5 : aucun fichier (400)', async () => {
      const res = await upload()
        .set('Authorization', bearer(athleteA))
        .field('athleteNote', 'sans fichier')
        .expect(400);
      expect(res.body).toMatchObject({ message: 'Aucun fichier fourni' });
    });

    it('cas 6 : .fit corrompu, octets aléatoires (400)', async () => {
      const res = await upload()
        .set('Authorization', bearer(athleteA))
        .attach('file', randomBytes(4096), 'corrupted.fit')
        .expect(400);
      expect(res.body).toMatchObject({
        message: 'Fichier .fit invalide ou corrompu',
      });
    });

    it('cas 7 : un coach ne peut pas importer (403)', async () => {
      await upload()
        .set('Authorization', bearer(coachA))
        .attach('file', Buffer.from('x'), 'session.fit')
        .expect(403);
    });

    it('cas 8 : sans jeton (401)', async () => {
      await upload()
        .attach('file', Buffer.from('x'), 'session.fit')
        .expect(401);
    });

    it('cas 10 : difficultyNote hors bornes 1–10 (400)', async () => {
      await upload()
        .set('Authorization', bearer(athleteA))
        .field('difficultyNote', '42')
        .attach('file', Buffer.from('x'), 'session.fit')
        .expect(400);
    });
  });
});
