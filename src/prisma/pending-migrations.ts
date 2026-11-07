import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migrations livrées avec le code (un dossier par migration contenant un
 * `migration.sql`), dans l'ordre d'application. `null` si le dossier est
 * absent : impossible alors de vérifier quoi que ce soit.
 */
export function listShippedMigrations(migrationsDir: string): string[] | null {
  if (!existsSync(migrationsDir)) {
    return null;
  }
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(migrationsDir, entry.name, 'migration.sql')),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Migrations du code absentes de la base, ou dont l'application a échoué
 * (elles n'apparaissent pas parmi les migrations terminées).
 *
 * Les migrations présentes en base mais inconnues du code sont tolérées :
 * c'est le cas normal d'un retour à l'image précédente, tant que les
 * migrations restent rétrocompatibles (cf. README, « Retour arrière »).
 */
export function findPendingMigrations(
  shipped: readonly string[],
  applied: readonly string[],
): string[] {
  const appliedSet = new Set(applied);
  return shipped.filter((name) => !appliedSet.has(name));
}

export class PendingMigrationsError extends Error {
  constructor(readonly pending: readonly string[]) {
    super(
      `${pending.length} migration(s) non appliquée(s) en base : ${pending.join(', ')}. ` +
        "Appliquez-les avant de démarrer cette version de l'API : " +
        '`npm run migrate:deploy`, ou `node scripts/migrate.js deploy` depuis l’image Docker.',
    );
    this.name = 'PendingMigrationsError';
  }
}
