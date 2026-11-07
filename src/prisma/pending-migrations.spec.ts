import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PendingMigrationsError,
  findPendingMigrations,
  listShippedMigrations,
} from './pending-migrations';

describe('listShippedMigrations', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function migration(name: string) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'migration.sql'), 'SELECT 1;');
  }

  it('liste les dossiers de migration dans l’ordre, sans les autres fichiers', () => {
    migration('20260902_b');
    migration('20260901_a');
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
    mkdirSync(join(dir, 'dossier_sans_sql'));

    expect(listShippedMigrations(dir)).toEqual(['20260901_a', '20260902_b']);
  });

  it('dossier absent : null, la vérification est impossible', () => {
    expect(listShippedMigrations(join(dir, 'absent'))).toBeNull();
  });
});

describe('findPendingMigrations', () => {
  it('base à jour : rien en attente', () => {
    expect(findPendingMigrations(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('migration oubliée au déploiement : signalée', () => {
    expect(findPendingMigrations(['a', 'b', 'c'], ['a'])).toEqual(['b', 'c']);
  });

  it('base vierge : tout est en attente', () => {
    expect(findPendingMigrations(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('retour à l’image précédente : une migration plus récente en base est tolérée', () => {
    expect(findPendingMigrations(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('le message nomme les migrations et la commande à lancer', () => {
    const error = new PendingMigrationsError(['b', 'c']);

    expect(error.message).toContain('2 migration(s) non appliquée(s)');
    expect(error.message).toContain('b, c');
    expect(error.message).toContain('npm run migrate:deploy');
  });
});
