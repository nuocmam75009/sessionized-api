import { nextRateLimitReset } from './strava-rate-limit';

const at = (iso: string) => new Date(iso);

describe('nextRateLimitReset', () => {
  it('quota 15 min dépassé : prochain quart d’heure', () => {
    const headers = new Headers({
      'X-ReadRateLimit-Limit': '100,1000',
      'X-ReadRateLimit-Usage': '101,640',
    });

    expect(
      nextRateLimitReset(headers, at('2026-11-07T17:11:28Z')).toISOString(),
    ).toBe('2026-11-07T17:15:00.000Z');
  });

  it('pile sur un quart d’heure : le suivant, pas l’instant présent', () => {
    expect(
      nextRateLimitReset(
        new Headers(),
        at('2026-11-07T17:15:00Z'),
      ).toISOString(),
    ).toBe('2026-11-07T17:30:00.000Z');
  });

  it('quota journalier de lecture épuisé : minuit UTC', () => {
    const headers = new Headers({
      'X-RateLimit-Limit': '200,2000',
      'X-RateLimit-Usage': '150,1200',
      'X-ReadRateLimit-Limit': '100,1000',
      'X-ReadRateLimit-Usage': '101,1000',
    });

    expect(
      nextRateLimitReset(headers, at('2026-11-07T17:11:28Z')).toISOString(),
    ).toBe('2026-11-08T00:00:00.000Z');
  });

  it('quota journalier global épuisé : minuit UTC', () => {
    const headers = new Headers({
      'X-Ratelimit-Limit': '600,30000',
      'X-Ratelimit-Usage': '692,30000',
    });

    expect(
      nextRateLimitReset(headers, at('2026-11-07T23:50:00Z')).toISOString(),
    ).toBe('2026-11-08T00:00:00.000Z');
  });

  it('en-têtes absents ou incomplets : fenêtre de 15 minutes', () => {
    const headers = new Headers({
      'X-ReadRateLimit-Limit': '100,',
      'X-ReadRateLimit-Usage': '101,',
    });

    expect(
      nextRateLimitReset(headers, at('2026-11-07T17:44:59Z')).toISOString(),
    ).toBe('2026-11-07T17:45:00.000Z');
  });
});
