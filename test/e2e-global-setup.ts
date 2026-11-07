import { execSync } from 'node:child_process';
import { applyE2eEnv } from './e2e-env';

// Une fois par exécution : applique les migrations sur la base de test, pour
// que les tests tournent sur le schéma de production et non sur un schéma
// recréé à part.
export default function globalSetup(): void {
  applyE2eEnv();
  try {
    execSync('npx --no prisma migrate deploy', {
      stdio: 'inherit',
      env: process.env,
    });
  } catch {
    throw new Error(
      'Migrations e2e impossibles. Base de test démarrée ? ' +
        '`docker compose up -d redis postgres-test`',
    );
  }
}
