import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

function makeController(deps: {
  database: () => Promise<unknown>;
  redis: () => Promise<unknown>;
}) {
  return new HealthController(
    { $queryRaw: jest.fn(deps.database) } as unknown as PrismaService,
    { ping: jest.fn(deps.redis) } as unknown as RedisService,
  );
}

const ok = () => Promise.resolve(1);
const fail = () => Promise.reject(new Error('ECONNREFUSED'));

describe('HealthController', () => {
  it('base et Redis joignables : ok', async () => {
    await expect(
      makeController({ database: ok, redis: ok }).check(),
    ).resolves.toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });

  it('Redis en panne : 200 dégradé, l’API fonctionne sans lui', async () => {
    await expect(
      makeController({ database: ok, redis: fail }).check(),
    ).resolves.toEqual({ status: 'degraded', database: 'up', redis: 'down' });
  });

  it('base en panne : 503', async () => {
    const result = makeController({ database: fail, redis: ok }).check();

    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toMatchObject({
      response: { status: 'error', database: 'down', redis: 'up' },
    });
  });

  it('base qui ne répond pas : 503 après le délai, pas de sonde bloquée', async () => {
    jest.useFakeTimers();
    try {
      const result = makeController({
        database: () => new Promise(() => undefined),
        redis: ok,
      }).check();
      const assertion = expect(result).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(2000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
