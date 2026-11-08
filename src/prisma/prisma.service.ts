import { join } from 'node:path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  PendingMigrationsError,
  findPendingMigrations,
  listShippedMigrations,
} from './pending-migrations';

// `prisma dev` exposes a local proxy URL (`prisma+postgres://...?api_key=...`)
// for the Prisma CLI, but the `pg` driver speaks raw Postgres wire protocol.
// The proxy's api_key is a base64 JSON payload carrying the real connection
// string, so we unwrap it here for the adapter. Regular `postgresql://` URLs
// (staging/prod) pass through unchanged.
export function resolveConnectionString(url: string): string {
  if (!url.startsWith('prisma+postgres://')) {
    return url;
  }

  const apiKey = new URL(url).searchParams.get('api_key');
  if (!apiKey) {
    throw new Error(
      'DATABASE_URL is a prisma+postgres:// URL without an api_key',
    );
  }

  const { databaseUrl } = JSON.parse(
    Buffer.from(apiKey, 'base64').toString('utf-8'),
  ) as { databaseUrl: string };

  return databaseUrl;
}

// Résolu depuis le dossier de lancement : la racine du dépôt en local et en
// CI, /app dans l'image Docker (qui embarque prisma/migrations).
const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: resolveConnectionString(
          process.env.DATABASE_URL ?? '',
        ),
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.assertSchemaUpToDate();
  }

  // Les migrations ne s'appliquent plus au démarrage : c'est une étape de
  // déploiement distincte (cf. README). Si elle a été oubliée, l'API refuse
  // de démarrer plutôt que d'exécuter le nouveau code sur l'ancien schéma, où
  // il échouerait requête par requête. Le déploiement échoue alors de façon
  // visible, et l'instance précédente continue de servir.
  private async assertSchemaUpToDate() {
    const shipped = listShippedMigrations(MIGRATIONS_DIR);
    if (!shipped) {
      this.logger.warn(
        `Dossier ${MIGRATIONS_DIR} introuvable : état des migrations non vérifié`,
      );
      return;
    }

    const pending = findPendingMigrations(
      shipped,
      await this.fetchAppliedMigrations(),
    );
    if (pending.length > 0) {
      throw new PendingMigrationsError(pending);
    }
    this.logger.log(
      `Schéma à jour : ${shipped.length} migration(s) appliquée(s)`,
    );
  }

  // Migrations terminées et non annulées, d'après la table de suivi de
  // Prisma Migrate. Base jamais migrée : la table n'existe pas encore.
  private async fetchAppliedMigrations(): Promise<string[]> {
    const [{ tracked }] = await this.$queryRaw<{ tracked: boolean }[]>`
      SELECT to_regclass('_prisma_migrations') IS NOT NULL AS tracked`;
    if (!tracked) {
      return [];
    }

    const rows = await this.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    return rows.map((row) => row.migration_name);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
