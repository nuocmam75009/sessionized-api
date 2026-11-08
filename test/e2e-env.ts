// Environnement des tests e2e, appliqué avant le chargement de l'application
// (setupFiles) et avant les migrations (globalSetup).
//
// Les tests écrivent en base : ils ne doivent jamais viser la base Neon
// partagée du `.env`. L'URL vient donc de E2E_DATABASE_URL (par défaut, le
// service postgres-test de docker-compose), et toute base non locale est
// refusée. Les variables posées ici priment sur le `.env`, que ConfigModule
// et Prisma ne lisent que pour les variables absentes du process.
//
// Deux rôles, comme en production : le propriétaire (E2E_DATABASE_URL)
// applique les migrations et crée le rôle applicatif ; l'application et les
// tests se connectent avec ce rôle applicatif, sans droit sur le schéma
// (scripts/grant-app-role.js).

const DEFAULT_E2E_DATABASE_URL =
  'postgresql://sessionized:sessionized@localhost:5433/sessionized_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const E2E_JWT_SECRET = 'e2e-only-secret-never-used-outside-tests';
export const E2E_APP_ROLE = 'sessionized_app';
export const E2E_APP_PASSWORD = 'e2e-only-app-role-password';

/** Connexion du propriétaire de la base : migrations et droits. */
export function e2eOwnerDatabaseUrl(): string {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
  const { hostname } = new URL(databaseUrl);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Tests e2e refusés : E2E_DATABASE_URL vise "${hostname}", pas une base locale. ` +
        'Ces tests créent et suppriment des données.',
    );
  }
  return databaseUrl;
}

/** Même base, rôle applicatif : celle qu'utilise l'API pendant les tests. */
export function e2eAppDatabaseUrl(): string {
  const url = new URL(e2eOwnerDatabaseUrl());
  url.username = E2E_APP_ROLE;
  url.password = E2E_APP_PASSWORD;
  return url.toString();
}

export function applyE2eEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: e2eAppDatabaseUrl(),
    JWT_SECRET: E2E_JWT_SECRET,
    JWT_EXPIRES_IN: '1h',
    REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379',
    CORS_ORIGINS: 'http://localhost:3000',
    // Strava désactivé : aucun appel externe pendant les tests.
    STRAVA_CLIENT_ID: '',
  });
  // scripts/migrate.js basculerait sinon sur la connexion directe Neon.
  delete process.env.DATABASE_URL_UNPOOLED;
}
