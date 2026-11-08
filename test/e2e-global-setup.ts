import { execSync } from 'node:child_process';
import {
  E2E_APP_PASSWORD,
  E2E_APP_ROLE,
  applyE2eEnv,
  e2eOwnerDatabaseUrl,
} from './e2e-env';
// Script JavaScript partagé avec la production : les tests vérifient les
// droits réellement accordés, pas une copie.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { grantAppRole } = require('../scripts/grant-app-role') as {
  grantAppRole: (options: {
    ownerUrl: string;
    role: string;
    password: string;
  }) => Promise<string>;
};

// Une fois par exécution, avec le rôle propriétaire : applique les migrations
// sur la base de test, pour que les tests tournent sur le schéma de
// production et non sur un schéma recréé à part, puis crée le rôle
// applicatif avec lequel l'API se connecte.
export default async function globalSetup(): Promise<void> {
  applyE2eEnv();
  const ownerUrl = e2eOwnerDatabaseUrl();
  try {
    execSync('npx --no prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: ownerUrl },
    });
  } catch {
    throw new Error(
      'Migrations e2e impossibles. Base de test démarrée ? ' +
        '`docker compose up -d redis postgres-test`',
    );
  }
  await grantAppRole({
    ownerUrl,
    role: E2E_APP_ROLE,
    password: E2E_APP_PASSWORD,
  });
}
