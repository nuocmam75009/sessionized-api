import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { ChainableCommander } from 'ioredis';
import { RedisService } from '../redis/redis.service';

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPTS_WINDOW_SECONDS = 15 * 60;
const KEY_PREFIX = 'login-attempts:';

// Limite les tentatives de connexion par compte (protection contre la force
// brute), avec un compteur Redis par email :
//   clé    login-attempts:<sha256(email)>   l'email n'est pas stocké en clair
//   valeur nombre de tentatives dans la fenêtre
//   TTL    fenêtre de 15 minutes, ouverte à la première tentative
// Au-delà de 5 tentatives dans la fenêtre, le compte est verrouillé jusqu'à
// l'expiration de la clé ; une connexion réussie supprime le compteur.
//
// Si Redis est indisponible, la limitation est désactivée (fail-open) et
// l'incident est journalisé : une panne du cache ne doit pas empêcher tous
// les utilisateurs de se connecter.
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Comptabilise une tentative avant la vérification du mot de passe.
   * Renvoie 0 si elle est autorisée, sinon le nombre de secondes avant le
   * déverrouillage du compte.
   */
  async consumeAttempt(email: string): Promise<number> {
    const key = this.keyFor(email);

    try {
      // Les trois commandes s'exécutent dans une transaction (MULTI/EXEC) :
      // - SET ... NX EX crée le compteur avec son TTL seulement s'il n'existe
      //   pas, donc un compteur n'est jamais créé sans expiration ;
      // - INCR conserve le TTL et, étant atomique, deux requêtes simultanées
      //   ne peuvent pas lire la même valeur et dépasser la limite ensemble.
      const [, attempts, ttl] = await this.exec(
        this.redis
          .multi()
          .set(key, 0, 'EX', LOGIN_ATTEMPTS_WINDOW_SECONDS, 'NX')
          .incr(key)
          .ttl(key),
      );

      if (Number(attempts) <= MAX_LOGIN_ATTEMPTS) {
        return 0;
      }
      return Math.max(Number(ttl), 1);
    } catch (error) {
      this.warnUnavailable(error);
      return 0;
    }
  }

  /** Remet le compteur à zéro après une connexion réussie. */
  async reset(email: string): Promise<void> {
    try {
      await this.redis.del(this.keyFor(email));
    } catch (error) {
      this.warnUnavailable(error);
    }
  }

  private keyFor(email: string): string {
    const normalized = email.trim().toLowerCase();
    return KEY_PREFIX + createHash('sha256').update(normalized).digest('hex');
  }

  // EXEC renvoie un couple [erreur, résultat] par commande, ou null si la
  // transaction a été annulée.
  private async exec(transaction: ChainableCommander): Promise<unknown[]> {
    const replies = await transaction.exec();
    if (!replies) {
      throw new Error('Transaction Redis annulée');
    }
    return replies.map(([error, result]) => {
      if (error) {
        throw error;
      }
      return result;
    });
  }

  private warnUnavailable(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Limitation des tentatives de connexion désactivée, Redis indisponible : ${message}`,
    );
  }
}
