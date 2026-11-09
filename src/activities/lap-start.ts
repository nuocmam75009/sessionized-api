/**
 * Départ d'un lap, en secondes depuis le début de l'activité : le repère de
 * TrackPoint.elapsedSec, qui permet de situer le lap sur la trace.
 *
 * La somme des durées des laps précédents ne le donne pas toujours : un lap
 * Strava compte le temps en mouvement (`moving_time`), et chaque arrêt — feu
 * rouge, récupération à l'arrêt — décalerait tous les laps suivants.
 */

/**
 * Secondes écoulées entre `start` et `at`, ou undefined si `at` est absent ou
 * illisible.
 *
 * Un écart négatif est ramené à zéro : un lap ne commence pas avant
 * l'activité, l'écart vient d'un arrondi de la montre ou de Strava.
 */
export function secondsSince(
  start: Date,
  at: string | Date | undefined,
): number | undefined {
  if (at == null) return undefined;
  const ms = new Date(at).getTime() - start.getTime();
  if (!Number.isFinite(ms)) return undefined;
  return Math.max(0, ms / 1000);
}

/**
 * Lap Strava. `start_index` désigne un échantillon des streams, demandés en
 * pleine résolution : `time[start_index]` est exactement le repère des points
 * de mesure. À défaut (stream absent, index hors limites), l'heure de départ
 * du lap, à la seconde près.
 */
export function stravaLapStartSec(
  lap: { start_index?: number; start_date?: string },
  timeStream: number[] | undefined,
  activityStart: Date,
): number | undefined {
  const fromStream =
    lap.start_index != null ? timeStream?.[lap.start_index] : undefined;
  return fromStream ?? secondsSince(activityStart, lap.start_date);
}
