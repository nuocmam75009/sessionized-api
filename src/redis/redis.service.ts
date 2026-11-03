import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

// Redis ne stocke que des données éphémères (compteurs de tentatives de
// connexion). Si le serveur est injoignable, les commandes échouent tout de
// suite au lieu d'attendre dans la file d'ioredis : l'appelant choisit comment
// se dégrader, sans bloquer la requête HTTP.
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    super(configService.getOrThrow<string>('REDIS_URL'), {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
    });

    // ioredis retente la connexion en boucle et émet une erreur à chaque
    // essai : on ne la journalise qu'une fois par coupure.
    let outageReported = false;
    this.on('ready', () => {
      outageReported = false;
      this.logger.log('Connecté à Redis');
    });
    this.on('error', (error: NodeJS.ErrnoException) => {
      if (!outageReported) {
        outageReported = true;
        // Sur `localhost`, Node tente IPv6 puis IPv4 et renvoie une
        // AggregateError sans message : le code (ECONNREFUSED…) suffit.
        this.logger.error(
          `Redis injoignable : ${error.message || error.code || error.name}`,
        );
      }
    });
  }

  async onModuleDestroy() {
    if (this.status === 'ready') {
      await this.quit();
    } else {
      this.disconnect();
    }
  }
}
