import { Role } from '../../../generated/prisma/enums';
import { isAccessTokenPayload } from './jwt-payload.interface';

describe('isAccessTokenPayload', () => {
  it('accepte le payload d’un token d’accès', () => {
    expect(
      isAccessTokenPayload({
        sub: 'user-1',
        email: 'athlete@example.com',
        role: Role.ATHLETE,
        iat: 1,
        exp: 2,
      }),
    ).toBe(true);
  });

  it('refuse le state OAuth Strava, signé avec le même secret', () => {
    expect(
      isAccessTokenPayload({ athleteId: 'ath-1', aud: 'strava-oauth-state' }),
    ).toBe(false);
  });

  it('refuse un rôle inconnu', () => {
    expect(
      isAccessTokenPayload({
        sub: 'user-1',
        email: 'x@example.com',
        role: 'ADMIN',
      }),
    ).toBe(false);
  });

  it('refuse les valeurs non objet', () => {
    expect(isAccessTokenPayload(null)).toBe(false);
    expect(isAccessTokenPayload('token')).toBe(false);
  });
});
