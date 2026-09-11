import { randomBytes } from 'node:crypto';
import { parseCorsOrigins, validateEnv } from './env.validation';

const DEV_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/sessionized',
  JWT_SECRET: 'dev-secret',
};

const PROD_ENV = {
  ...DEV_ENV,
  NODE_ENV: 'production',
  JWT_SECRET: randomBytes(48).toString('hex'),
  CORS_ORIGINS: 'https://app.sessionized.fr,https://coach.sessionized.fr',
};

describe('validateEnv', () => {
  it('accepte une config de dev minimale', () => {
    expect(() => validateEnv(DEV_ENV)).not.toThrow();
  });

  it('accepte une config de production complète', () => {
    expect(() => validateEnv(PROD_ENV)).not.toThrow();
  });

  it('exige DATABASE_URL et JWT_SECRET', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET/);
  });

  it('refuse un JWT_SECRET trop court en production', () => {
    expect(() => validateEnv({ ...PROD_ENV, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET doit faire au moins 32 caractères/,
    );
  });

  it('exige CORS_ORIGINS en production', () => {
    expect(() => validateEnv({ ...PROD_ENV, CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS est obligatoire/,
    );
  });

  it('refuse une origine CORS invalide', () => {
    expect(() =>
      validateEnv({ ...DEV_ENV, CORS_ORIGINS: 'app.sessionized.fr' }),
    ).toThrow(/URL invalide/);
  });

  it('exige toute la config Strava en production si STRAVA_CLIENT_ID est défini', () => {
    expect(() =>
      validateEnv({ ...PROD_ENV, STRAVA_CLIENT_ID: '12345' }),
    ).toThrow(
      /STRAVA_CLIENT_SECRET[\s\S]*STRAVA_REDIRECT_URI[\s\S]*STRAVA_TOKEN_ENCRYPTION_KEY[\s\S]*ATHLETE_APP_URL/,
    );
  });

  it('refuse une clé de chiffrement qui ne fait pas 32 octets', () => {
    expect(() =>
      validateEnv({
        ...DEV_ENV,
        STRAVA_TOKEN_ENCRYPTION_KEY: randomBytes(16).toString('base64'),
      }),
    ).toThrow(/STRAVA_TOKEN_ENCRYPTION_KEY/);
  });

  it('refuse un TRUST_PROXY non numérique', () => {
    expect(() => validateEnv({ ...DEV_ENV, TRUST_PROXY: 'true' })).toThrow(
      /TRUST_PROXY/,
    );
  });
});

describe('parseCorsOrigins', () => {
  it('retombe sur les frontends locaux si la variable est absente', () => {
    expect(parseCorsOrigins(undefined)).toEqual([
      'http://localhost:3000',
      'http://localhost:3002',
    ]);
  });

  it('découpe, nettoie les espaces et retire le slash final', () => {
    expect(
      parseCorsOrigins(
        ' https://app.sessionized.fr/ , https://coach.sessionized.fr',
      ),
    ).toEqual(['https://app.sessionized.fr', 'https://coach.sessionized.fr']);
  });
});
