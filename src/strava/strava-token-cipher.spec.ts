import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { StravaTokenCipher } from './strava-token-cipher';

const newKey = () => randomBytes(32).toString('base64');
const cipherWithKey = (key: string) =>
  new StravaTokenCipher(
    new ConfigService({ STRAVA_TOKEN_ENCRYPTION_KEY: key }),
  );

describe('StravaTokenCipher', () => {
  const cipher = cipherWithKey(newKey());

  it('déchiffre ce qu’il a chiffré', () => {
    const encrypted = cipher.encrypt('strava-access-token');

    expect(encrypted).not.toContain('strava-access-token');
    expect(cipher.decrypt(encrypted)).toBe('strava-access-token');
  });

  it('produit un chiffré différent à chaque appel (IV aléatoire)', () => {
    expect(cipher.encrypt('token')).not.toBe(cipher.encrypt('token'));
  });

  it('lit tels quels les tokens enregistrés avant le chiffrement', () => {
    expect(cipher.decrypt('legacy-plaintext-token')).toBe(
      'legacy-plaintext-token',
    );
  });

  it('refuse un token chiffré avec une autre clé', () => {
    const encrypted = cipherWithKey(newKey()).encrypt('token');

    expect(() => cipher.decrypt(encrypted)).toThrow(
      /STRAVA_TOKEN_ENCRYPTION_KEY/,
    );
  });

  it('refuse un token altéré (tag d’authentification GCM)', () => {
    const encrypted = cipher.encrypt('token');
    const tampered = encrypted.slice(0, -4) + 'AAAA';

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    const shortKey = cipherWithKey(randomBytes(16).toString('base64'));

    expect(() => shortKey.encrypt('token')).toThrow(/32 octets/);
  });
});
