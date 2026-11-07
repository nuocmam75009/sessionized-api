import { ServiceUnavailableException } from '@nestjs/common';

export const STRAVA_RATE_LIMITED = 'STRAVA_RATE_LIMITED';

const QUARTER_HOUR_MS = 15 * 60 * 1000;

// Quota de requêtes de l'application Sessionized chez Strava épuisé : rien à
// voir avec l'athlète ni avec sa connexion. 503 et non 429, que le front lirait
// comme « vous envoyez trop de requêtes » (c'est aussi le code du
// ThrottlerGuard de l'API) ; et non 502, réservé à une réponse Strava
// inexploitable. `retryAfterSec` indique quand le quota se réinitialise.
export class StravaRateLimitedException extends ServiceUnavailableException {
  readonly retryAfterSec: number;

  constructor(resetAt: Date) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((resetAt.getTime() - Date.now()) / 1000),
    );
    super({
      statusCode: 503,
      error: 'Service Unavailable',
      code: STRAVA_RATE_LIMITED,
      message: `Limite de requêtes Strava atteinte, réessayez dans ${Math.ceil(retryAfterSec / 60)} min`,
      retryAfterSec,
    });
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Date de réinitialisation du quota Strava dépassé.
 *
 * Strava compte sur deux fenêtres fixes : 15 minutes, réinitialisées à 0, 15,
 * 30 et 45 min de chaque heure, et une journée, réinitialisée à minuit UTC.
 * Les en-têtes X-RateLimit-* (global) et X-ReadRateLimit-* (lecture) valent
 * « 15 min,jour » : si l'usage du jour a atteint sa limite, le prochain quart
 * d'heure ne suffit pas. Sans en-têtes exploitables, on suppose la fenêtre de
 * 15 minutes, la plus courte.
 */
export function nextRateLimitReset(headers: Headers, now: Date): Date {
  const daily = (name: string): number => {
    const value = headers.get(name)?.split(',')[1]?.trim();
    return value ? Number(value) : NaN;
  };
  const dailyExhausted = [
    ['x-ratelimit-usage', 'x-ratelimit-limit'],
    ['x-readratelimit-usage', 'x-readratelimit-limit'],
  ].some(([usage, limit]) => daily(usage) >= daily(limit));

  if (dailyExhausted) {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
  }
  return new Date(
    Math.floor(now.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS +
      QUARTER_HOUR_MS,
  );
}
