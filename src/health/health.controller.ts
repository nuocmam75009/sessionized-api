import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type DependencyState = 'up' | 'down';

// Au-delà, la dépendance est considérée en panne : une sonde qui reste
// bloquée ne renseigne pas mieux qu'une sonde en échec.
const CHECK_TIMEOUT_MS = 2000;

// Sonde de santé interrogée par l'hébergeur, le HEALTHCHECK Docker et le
// pipeline après déploiement. Publique (elle ne révèle que up/down) et hors
// limitation de débit, puisqu'elle est appelée en boucle.
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @ApiOperation({ summary: "État de l'API et de ses dépendances" })
  @ApiOkResponse({
    description:
      'Base joignable. `status` vaut `degraded` si Redis est en panne : la limitation des tentatives de connexion est alors désactivée, le reste fonctionne',
  })
  @ApiServiceUnavailableResponse({
    description: "Base injoignable : l'API ne peut rien servir d'utile",
  })
  @Get()
  async check() {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
    ]);

    if (database === 'down') {
      // 503 : l'hébergeur retire l'instance du trafic, ou annule le
      // déploiement en cours.
      throw new ServiceUnavailableException({
        status: 'error',
        database,
        redis,
      });
    }
    return { status: redis === 'up' ? 'ok' : 'degraded', database, redis };
  }
}

async function probe(check: () => Promise<unknown>): Promise<DependencyState> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('délai dépassé')),
      CHECK_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
