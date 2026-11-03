import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { RedisService } from '../src/redis/redis.service';
import {
  LOGIN_ATTEMPTS_WINDOW_SECONDS,
  LoginAttemptsService,
  MAX_LOGIN_ATTEMPTS,
} from '../src/auth/login-attempts.service';

// Test d'intégration contre un vrai serveur Redis (`docker compose up -d redis`
// en local). Chaque test utilise un email unique : aucune autre clé n'est lue
// ni supprimée.
describe('LoginAttemptsService (Redis réel)', () => {
  let redis: RedisService;
  let service: LoginAttemptsService;
  let email: string;

  beforeAll(async () => {
    redis = new RedisService(
      new ConfigService({
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      }),
    );
    await new Promise<void>((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
    });
    service = new LoginAttemptsService(redis);
  });

  beforeEach(() => {
    email = `e2e-${randomUUID()}@example.com`;
  });

  afterEach(async () => {
    await service.reset(email);
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  it('verrouille le compte après la dernière tentative autorisée', async () => {
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      await expect(service.consumeAttempt(email)).resolves.toBe(0);
    }

    const retryAfter = await service.consumeAttempt(email);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_ATTEMPTS_WINDOW_SECONDS);
  });

  it('pose un TTL sur le compteur dès la première tentative', async () => {
    await service.consumeAttempt(email);

    const key =
      'login-attempts:' + createHash('sha256').update(email).digest('hex');
    await expect(redis.get(key)).resolves.toBe('1');
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LOGIN_ATTEMPTS_WINDOW_SECONDS);
  });

  it('remet le compteur à zéro après une connexion réussie', async () => {
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      await service.consumeAttempt(email);
    }

    await service.reset(email);

    await expect(service.consumeAttempt(email)).resolves.toBe(0);
  });

  it("n'autorise que la limite exacte face à des tentatives simultanées", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.consumeAttempt(email)),
    );

    expect(results.filter((retryAfter) => retryAfter === 0)).toHaveLength(
      MAX_LOGIN_ATTEMPTS,
    );
  });
});
