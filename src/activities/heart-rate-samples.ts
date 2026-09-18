import { Prisma } from '../../generated/prisma/client';

// Une pause (arrêt Strava, feu rouge, ravito...) entre deux points ne doit pas
// gonfler artificiellement une zone : l'écart pris en compte entre deux
// TrackPoint consécutifs est plafonné à cette valeur.
export const MAX_SAMPLE_GAP_SEC = 10;

/**
 * CTE commune à toutes les agrégations de temps passé à une FC donnée : les
 * points de la période triés par activité, avec l'écart au point suivant
 * plafonné à MAX_SAMPLE_GAP_SEC et le dernier point de chaque activité compté
 * pour 1 s (pas de point suivant à qui attribuer un écart).
 *
 * Expose deux tables : `period_activities` (une ligne par activité de la
 * période) et `samples` (activityId, hr, dt). L'agrégation se fait en SQL
 * plutôt qu'en mémoire parce que ces requêtes doivent rester valables sur une
 * saison complète — des centaines de milliers de points, d'où
 * @@index([activityId, elapsedSec]).
 */
export function buildHeartRateSamplesCte(
  athleteId: string,
  from: Date,
  to: Date,
): Prisma.Sql {
  return Prisma.sql`
      period_activities AS (
        SELECT a.id
        FROM "Activity" a
        WHERE a."athleteId" = ${athleteId}
          AND a."startedAt" >= ${from}
          AND a."startedAt" <= ${to}
      ),
      samples AS (
        SELECT
          tp."activityId",
          tp."heartRate" AS hr,
          LEAST(
            COALESCE(
              LEAD(tp."elapsedSec") OVER (
                PARTITION BY tp."activityId" ORDER BY tp."elapsedSec"
              ) - tp."elapsedSec",
              1
            ),
            ${MAX_SAMPLE_GAP_SEC}
          ) AS dt
        FROM "TrackPoint" tp
        JOIN period_activities pa ON pa.id = tp."activityId"
      )
    `;
}

/**
 * Classement d'une FC dans les zones de l'athlète, en SQL.
 *
 * `width_bucket` classe chaque FC dans un bucket 0..n-1 à partir des bornes
 * basses des zones 2..n ; +1 pour retomber sur l'index de zone 1-based utilisé
 * par l'API. `highBounds` = bornes hautes déjà nettoyées de la dernière valeur
 * inexploitable de AthleteProfile.heartRateZonesBpm.
 */
export function zoneIndexExpression(highBounds: number[]): Prisma.Sql {
  const lowerBounds = highBounds.map((max) => max + 1);
  return Prisma.sql`width_bucket(hr::float, ${lowerBounds}::float[]) + 1`;
}
