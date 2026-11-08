import { ConflictException } from '@nestjs/common';

export const STRAVA_RECONNECT_REQUIRED = 'STRAVA_RECONNECT_REQUIRED';

// La connexion Strava enregistrée ne peut plus servir : tokens illisibles
// (clé de chiffrement changée) ou refusés par Strava (accès révoqué depuis
// Strava). Seule une reconnexion de l'athlète la répare, d'où un 409 et un
// code dédié : le front doit le distinguer d'une panne passagère de Strava
// (502), où il suffit de réessayer, et d'un 401, qui fermerait sa session.
export class StravaReconnectRequiredException extends ConflictException {
  constructor(reason: string) {
    super({
      statusCode: 409,
      error: 'Conflict',
      code: STRAVA_RECONNECT_REQUIRED,
      message: `Connexion Strava à renouveler : ${reason}`,
    });
  }
}
