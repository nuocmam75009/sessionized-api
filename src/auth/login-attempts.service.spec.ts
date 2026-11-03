import { createHash } from 'crypto';
import {
  LOGIN_ATTEMPTS_WINDOW_SECONDS,
  LoginAttemptsService,
  MAX_LOGIN_ATTEMPTS,
} from './login-attempts.service';
import { RedisService } from '../redis/redis.service';

const EMAIL = 'athlete@example.com';
const EXPECTED_KEY =
  'login-attempts:' + createHash('sha256').update(EMAIL).digest('hex');

type ExecReplies = [Error | null, unknown][] | null;

// Simule `redis.multi()` : chaque commande est enregistrée puis `exec()`
// renvoie les réponses fournies par le test.
function buildRedis(exec: () => Promise<ExecReplies>) {
  const transaction = {
    set: jest.fn().mockReturnThis(),
    incr: jest.fn().mockReturnThis(),
    ttl: jest.fn().mockReturnThis(),
    exec: jest.fn(exec),
  };
  const redis = {
    multi: jest.fn(() => transaction),
    del: jest.fn().mockResolvedValue(1),
  };
  return { redis, transaction };
}

function replies(attempts: number, ttl: number): ExecReplies {
  return [
    [null, attempts === 1 ? 'OK' : null],
    [null, attempts],
    [null, ttl],
  ];
}

function buildService(redis: ReturnType<typeof buildRedis>['redis']) {
  return new LoginAttemptsService(redis as unknown as RedisService);
}

describe('LoginAttemptsService', () => {
  describe('consumeAttempt', () => {
    it("crée le compteur avec son TTL et l'incrémente dans une seule transaction", async () => {
      const { redis, transaction } = buildRedis(() =>
        Promise.resolve(replies(1, LOGIN_ATTEMPTS_WINDOW_SECONDS)),
      );

      await expect(buildService(redis).consumeAttempt(EMAIL)).resolves.toBe(0);

      expect(redis.multi).toHaveBeenCalledTimes(1);
      expect(transaction.set).toHaveBeenCalledWith(
        EXPECTED_KEY,
        0,
        'EX',
        LOGIN_ATTEMPTS_WINDOW_SECONDS,
        'NX',
      );
      expect(transaction.incr).toHaveBeenCalledWith(EXPECTED_KEY);
      expect(transaction.ttl).toHaveBeenCalledWith(EXPECTED_KEY);
    });

    it("ne stocke pas l'email en clair et ignore la casse et les espaces", async () => {
      const { redis, transaction } = buildRedis(() =>
        Promise.resolve(replies(1, LOGIN_ATTEMPTS_WINDOW_SECONDS)),
      );

      await buildService(redis).consumeAttempt('  Athlete@Example.COM ');

      const [key] = transaction.incr.mock.calls[0] as [string];
      expect(key).toBe(EXPECTED_KEY);
      expect(key).not.toContain('athlete');
    });

    it('autorise la dernière tentative de la fenêtre', async () => {
      const { redis } = buildRedis(() =>
        Promise.resolve(replies(MAX_LOGIN_ATTEMPTS, 600)),
      );

      await expect(buildService(redis).consumeAttempt(EMAIL)).resolves.toBe(0);
    });

    it('refuse au-delà de la limite et renvoie le temps restant avant déverrouillage', async () => {
      const { redis } = buildRedis(() =>
        Promise.resolve(replies(MAX_LOGIN_ATTEMPTS + 1, 600)),
      );

      await expect(buildService(redis).consumeAttempt(EMAIL)).resolves.toBe(
        600,
      );
    });

    it('laisse passer la connexion si Redis est injoignable (fail-open)', async () => {
      const { redis } = buildRedis(() =>
        Promise.reject(new Error('Connection is closed.')),
      );

      await expect(buildService(redis).consumeAttempt(EMAIL)).resolves.toBe(0);
    });

    it('laisse passer la connexion si une commande de la transaction échoue', async () => {
      const { redis } = buildRedis(() =>
        Promise.resolve([
          [null, 'OK'],
          [new Error('WRONGTYPE'), null],
          [null, 900],
        ]),
      );

      await expect(buildService(redis).consumeAttempt(EMAIL)).resolves.toBe(0);
    });

    it('laisse passer la connexion si la transaction est annulée', async () => {
      const { redis } = buildRedis(() => Promise.resolve(null));

      await expect(buildService(redis).consumeAttempt(EMAIL)).resolves.toBe(0);
    });
  });

  describe('reset', () => {
    it('supprime le compteur du compte', async () => {
      const { redis } = buildRedis(() => Promise.resolve(null));

      await buildService(redis).reset(EMAIL);

      expect(redis.del).toHaveBeenCalledWith(EXPECTED_KEY);
    });

    it("n'échoue pas si Redis est injoignable", async () => {
      const { redis } = buildRedis(() => Promise.resolve(null));
      redis.del.mockRejectedValue(new Error('Connection is closed.'));

      await expect(buildService(redis).reset(EMAIL)).resolves.toBeUndefined();
    });
  });
});
