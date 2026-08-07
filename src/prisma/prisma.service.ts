import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

// `prisma dev` exposes a local proxy URL (`prisma+postgres://...?api_key=...`)
// for the Prisma CLI, but the `pg` driver speaks raw Postgres wire protocol.
// The proxy's api_key is a base64 JSON payload carrying the real connection
// string, so we unwrap it here for the adapter. Regular `postgresql://` URLs
// (staging/prod) pass through unchanged.
function resolveConnectionString(url: string): string {
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

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
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
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
