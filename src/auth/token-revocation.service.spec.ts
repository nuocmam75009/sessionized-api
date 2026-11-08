import { ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { TokenRevocationService } from './token-revocation.service';

function buildService() {
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    exists: jest.fn().mockResolvedValue(0),
  };
  const service = new TokenRevocationService(redis as unknown as RedisService);
  return { service, redis };
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('TokenRevocationService', () => {
  it('garde le jti révoqué exactement le temps de vie restant du jeton', async () => {
    const { service, redis } = buildService();

    await service.revoke('jti-1', nowSec() + 3600);

    const [key, value, mode, ttl] = redis.set.mock.calls[0] as [
      string,
      string,
      string,
      number,
    ];
    expect([key, value, mode]).toEqual(['revoked-jwt:jti-1', '1', 'EX']);
    expect(ttl).toBeGreaterThan(3590);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('jeton déjà expiré : rien à stocker', async () => {
    const { service, redis } = buildService();
    await service.revoke('jti-1', nowSec() - 10);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('Redis injoignable à la déconnexion : 503, la révocation n’a pas eu lieu', async () => {
    const { service, redis } = buildService();
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.revoke('jti-1', nowSec() + 60)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('jeton révoqué reconnu', async () => {
    const { service, redis } = buildService();
    redis.exists.mockResolvedValue(1);
    await expect(service.isRevoked('jti-1')).resolves.toBe(true);
    expect(redis.exists).toHaveBeenCalledWith('revoked-jwt:jti-1');
  });

  it('Redis injoignable à la vérification : le jeton passe (fail-open)', async () => {
    const { service, redis } = buildService();
    redis.exists.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.isRevoked('jti-1')).resolves.toBe(false);
  });
});
