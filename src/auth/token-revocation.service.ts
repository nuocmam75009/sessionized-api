import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const KEY_PREFIX = 'revoked-jwt:';

// Liste des jetons révoqués (déconnexion), dans Redis :
//   clé    revoked-jwt:<jti>   identifiant unique du jeton, pas le jeton lui-même
//   TTL    durée de vie restante du jeton
// Un JWT reste valide jusqu'à son expiration : sans cette liste, un jeton
// volé avant la déconnexion resterait utilisable jusqu'à 7 jours. La clé
// disparaît d'elle-même quand le jeton aurait de toute façon expiré, la liste
// ne contient donc jamais que des jetons encore valides.
//
// Si Redis est indisponible, la vérification laisse passer (fail-open, comme
// la limitation des tentatives de connexion) : une panne du cache ne doit pas
// déconnecter tous les utilisateurs. En contrepartie, un jeton révoqué reste
// utilisable le temps de la panne, qui est journalisée et remontée par
// GET /health.
@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Révoque un jeton jusqu'à son expiration (`exp`, en secondes depuis
   * l'époque Unix). Échoue en 503 si Redis est injoignable : l'appelant doit
   * savoir que la révocation n'a pas eu lieu.
   */
  async revoke(jti: string, exp: number): Promise<void> {
    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) {
      return; // déjà expiré : plus rien à révoquer
    }
    try {
      await this.redis.set(KEY_PREFIX + jti, '1', 'EX', ttl);
    } catch (error) {
      this.warnUnavailable('révocation impossible', error);
      throw new ServiceUnavailableException(
        'Déconnexion côté serveur indisponible, réessayez dans un instant',
      );
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    try {
      return (await this.redis.exists(KEY_PREFIX + jti)) === 1;
    } catch (error) {
      this.warnUnavailable('vérification désactivée', error);
      return false;
    }
  }

  private warnUnavailable(context: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Révocation des jetons : ${context}, Redis indisponible : ${message}`,
    );
  }
}
