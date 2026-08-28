import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import FitParser from 'fit-file-parser';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ActivitySource, Role } from '../../generated/prisma/enums';
import { Prisma } from '../../generated/prisma/client';
import type { UploadActivityDto } from './dto/upload-activity.dto';
import type { UpdateActivityDto } from './dto/update-activity.dto';
import type { HrZonesQueryDto } from './dto/hr-zones-query.dto';
import { resolveFitLapIntensities } from './lap-intensity';

// Une pause (arrêt Strava, feu rouge, ravito...) entre deux points ne doit
// pas gonfler artificiellement une zone : l'écart pris en compte entre deux
// TrackPoint consécutifs est plafonné à cette valeur (cf. getHeartRateZones).
const MAX_SAMPLE_GAP_SEC = 10;

// Écart maximal toléré entre l'heure de départ d'un .fit et celle de l'activité
// à laquelle on veut le rattacher. Strava arrondit parfois de quelques secondes ;
// au-delà, c'est une autre séance et le rattachement est refusé.
const MAX_FIT_ATTACH_DRIFT_SEC = 300;

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  private readonly fitParser = new FitParser({
    speedUnit: 'm/s',
    lengthUnit: 'm',
    mode: 'list',
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async upload(
    athleteUserId: string,
    file: Express.Multer.File | undefined,
    dto: UploadActivityDto,
  ) {
    const { workoutId, athleteNote, difficultyNote } = dto;
    if (!file) {
      this.logger.warn(
        `Upload refusé pour l'utilisateur ${athleteUserId} : aucun fichier fourni`,
      );
      throw new BadRequestException('Aucun fichier fourni');
    }

    this.logger.log(
      `Upload reçu : ${file.originalname} (${file.size} octets) — utilisateur ${athleteUserId}`,
    );

    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.activity.findUnique({
      where: { athleteId_fileHash: { athleteId: athlete.id, fileHash } },
    });
    if (existing) {
      this.logger.warn(
        `Upload refusé : activité déjà importée (hash=${fileHash.slice(0, 12)}…, athlète=${athlete.id})`,
      );
      throw new ConflictException('Cette activité a déjà été importée');
    }

    if (workoutId) {
      await this.assertWorkoutIsAssignable(athlete.id, workoutId);
    }

    const { parsed, session } = await this.parseFitFile(
      file,
      `athlète=${athlete.id}`,
    );

    const activity = await this.prisma.activity.create({
      data: {
        athleteId: athlete.id,
        source: ActivitySource.FIT,
        fileHash,
        fitFileHash: fileHash,
        fitFileData: new Uint8Array(file.buffer),
        sport: session.sport,
        subSport: session.sub_sport,
        startedAt: new Date(session.start_time),
        totalDistanceM: session.total_distance ?? 0,
        totalDurationSec: Math.round(session.total_elapsed_time ?? 0),
        avgHeartRate: roundOrUndefined(session.avg_heart_rate),
        maxHeartRate: roundOrUndefined(session.max_heart_rate),
        avgCadence: roundOrUndefined(session.avg_cadence),
        avgPower: roundOrUndefined(session.avg_power),
        totalCalories: roundOrUndefined(session.total_calories),
        elevationGainM: session.total_ascent,
        elevationLossM: session.total_descent,
        athleteNote,
        difficultyNote,
        workoutId: workoutId ?? undefined,
        laps: { create: buildFitLapRows(parsed.laps) },
      },
      include: { laps: true },
    });

    const trackPoints = buildFitTrackPointRows(
      parsed.records,
      activity.startedAt,
    );
    if (trackPoints.length > 0) {
      await this.prisma.trackPoint.createMany({
        data: trackPoints.map((point) => ({
          ...point,
          activityId: activity.id,
        })),
      });
    }

    this.logger.log(
      `Activité créée : id=${activity.id}, ${activity.laps.length} lap(s), ${trackPoints.length} point(s) GPS, ${activity.totalDistanceM}m, ${activity.totalDurationSec}s (athlète=${athlete.id})`,
    );

    return { ...toActivityDto(activity), trackPointsCount: trackPoints.length };
  }

  async findAll(userId: string, role: Role, athleteId?: string) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }

      const activities = await this.prisma.activity.findMany({
        where: {
          athlete: { coachId: coach.id },
          ...(athleteId ? { athleteId } : {}),
        },
        include: { laps: true },
        orderBy: { startedAt: 'desc' },
      });
      return activities.map(toActivityDto);
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const activities = await this.prisma.activity.findMany({
      where: { athleteId: athlete.id },
      include: { laps: true },
      orderBy: { startedAt: 'desc' },
    });
    return activities.map(toActivityDto);
  }

  async findOne(userId: string, role: Role, id: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
      include: { laps: true },
    });
    if (!activity) {
      throw new NotFoundException('Activité introuvable');
    }

    await this.assertActivityAccess(userId, role, activity);
    return toActivityDto(activity);
  }

  async getTrack(userId: string, role: Role, id: string) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) {
      throw new NotFoundException('Activité introuvable');
    }

    await this.assertActivityAccess(userId, role, activity);

    return this.prisma.trackPoint.findMany({
      where: { activityId: id },
      orderBy: { elapsedSec: 'asc' },
    });
  }

  async getHeartRateZones(userId: string, role: Role, query: HrZonesQueryDto) {
    const athlete = await this.resolveHeartRateZonesAthlete(
      userId,
      role,
      query.athleteId,
    );

    const from = new Date(query.from);
    const to = new Date(query.to);

    // Dernière valeur du tableau = borne haute inexploitable (zone ouverte
    // Strava, `-1` pour les profils synchronisés avant le correctif de
    // StravaService.syncZones) : jamais lue, elle sert seulement à connaître
    // le nombre de zones.
    const highBounds = athlete.heartRateZonesBpm.slice(0, -1);

    const aggregate =
      highBounds.length === 0
        ? await this.queryHeartRateCountsOnly(athlete.id, from, to)
        : await this.queryHeartRateZoneSeconds(
            athlete.id,
            from,
            to,
            highBounds,
          );

    const zones = buildHeartRateZoneDefs(highBounds).map((zone) => ({
      ...zone,
      seconds: Math.round(aggregate.secondsByZone.get(zone.index) ?? 0),
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      unit: 'bpm' as const,
      zones,
      totalSeconds: zones.reduce((sum, zone) => sum + zone.seconds, 0),
      secondsWithoutData: Math.round(aggregate.secondsWithoutData),
      activityCount: aggregate.activityCount,
      activitiesWithDataCount: aggregate.activitiesWithDataCount,
    };
  }

  private async resolveHeartRateZonesAthlete(
    userId: string,
    role: Role,
    athleteId: string | undefined,
  ) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }
      if (!athleteId) {
        throw new BadRequestException(
          'athleteId requis pour un coach : les zones FC sont propres à chaque athlète',
        );
      }

      const athlete = await this.prisma.athleteProfile.findUnique({
        where: { id: athleteId },
      });
      if (!athlete || athlete.coachId !== coach.id) {
        throw new ForbiddenException('Cet athlète ne vous est pas rattaché');
      }
      return athlete;
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }
    return athlete;
  }

  // CTE commune aux deux requêtes d'agrégation FC ci-dessous : les points de
  // la période triés par activité, avec l'écart au point suivant plafonné à
  // MAX_SAMPLE_GAP_SEC et le dernier point de chaque activité compté pour 1 s
  // (pas de point suivant à qui attribuer un écart).
  private buildHeartRateSamplesCte(
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

  // Athlète sans zones FC configurées (pas de Strava connecté, ou token sans
  // le scope profile:read_all) : aucune répartition possible, on ne calcule
  // que les compteurs. Évite aussi d'appeler width_bucket avec un tableau de
  // seuils vide, dont le comportement n'est pas garanti.
  private async queryHeartRateCountsOnly(
    athleteId: string,
    from: Date,
    to: Date,
  ): Promise<HeartRateAggregate> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        activityCount: number;
        activitiesWithDataCount: number;
        secondsWithoutData: number;
      }>
    >(Prisma.sql`
      WITH ${this.buildHeartRateSamplesCte(athleteId, from, to)}
      SELECT
        (SELECT COUNT(*)::int FROM period_activities) AS "activityCount",
        (SELECT COUNT(DISTINCT "activityId")::int FROM samples WHERE hr IS NOT NULL)
          AS "activitiesWithDataCount",
        COALESCE((SELECT SUM(dt) FROM samples WHERE hr IS NULL), 0)::float
          AS "secondsWithoutData"
    `);

    return { ...rows[0], secondsByZone: new Map() };
  }

  // Agrégation en une seule requête SQL plutôt qu'un chargement des
  // TrackPoint en mémoire : cet endpoint doit rester valable sur une saison
  // complète (des centaines de milliers de points), l'index
  // @@index([activityId, elapsedSec]) est là pour ça. width_bucket classe
  // chaque FC dans un bucket 0..n-1 à partir des bornes basses des zones
  // 2..n ; +1 pour retomber sur l'index de zone 1-based utilisé par l'API.
  private async queryHeartRateZoneSeconds(
    athleteId: string,
    from: Date,
    to: Date,
    highBounds: number[],
  ): Promise<HeartRateAggregate> {
    const lowerBounds = highBounds.map((max) => max + 1);

    const rows = await this.prisma.$queryRaw<
      Array<{
        activityCount: number;
        activitiesWithDataCount: number;
        secondsWithoutData: number;
        zoneIndex: number | null;
        seconds: number | null;
      }>
    >(Prisma.sql`
      WITH ${this.buildHeartRateSamplesCte(athleteId, from, to)},
      zone_seconds AS (
        SELECT
          width_bucket(hr::float, ${lowerBounds}::float[]) + 1 AS zone_index,
          SUM(dt)::float AS seconds
        FROM samples
        WHERE hr IS NOT NULL
        GROUP BY 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM period_activities) AS "activityCount",
        (SELECT COUNT(DISTINCT "activityId")::int FROM samples WHERE hr IS NOT NULL)
          AS "activitiesWithDataCount",
        COALESCE((SELECT SUM(dt) FROM samples WHERE hr IS NULL), 0)::float
          AS "secondsWithoutData",
        z.zone_index AS "zoneIndex",
        z.seconds
      FROM (SELECT 1) AS one
      LEFT JOIN zone_seconds z ON true
    `);

    const secondsByZone = new Map<number, number>();
    for (const row of rows) {
      if (row.zoneIndex != null && row.seconds != null) {
        secondsByZone.set(row.zoneIndex, row.seconds);
      }
    }

    return {
      activityCount: rows[0].activityCount,
      activitiesWithDataCount: rows[0].activitiesWithDataCount,
      secondsWithoutData: rows[0].secondsWithoutData,
      secondsByZone,
    };
  }

  /**
   * Remplace les laps d'une activité importée depuis Strava par ceux de son
   * fichier .fit d'origine.
   *
   * Strava reste la source de toutes les autres données de l'activité : le
   * fichier de la montre ne sert qu'aux tours. Il apporte les métriques de
   * foulée que l'API Strava ne renvoie pas sur ses laps (temps de contact au
   * sol, oscillation et ratio verticaux, longueur de foulée) ; l'intensité,
   * elle, reste estimée tant que la montre n'écrit pas le champ `intensity`.
   * Le .fit est conservé en base pour rester téléchargeable.
   */
  async attachFitFile(
    athleteUserId: string,
    activityId: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const activity = await this.getOwnedActivity(athleteUserId, activityId);
    if (activity.fitFileData) {
      throw new ConflictException(
        'Un fichier .fit est déjà rattaché à cette activité',
      );
    }

    const fitFileHash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.prisma.activity.findFirst({
      where: {
        athleteId: activity.athleteId,
        id: { not: activity.id },
        OR: [{ fileHash: fitFileHash }, { fitFileHash }],
      },
      select: { id: true },
    });
    if (duplicate) {
      this.logger.warn(
        `Rattachement .fit refusé : fichier déjà importé (activité=${duplicate.id}, athlète=${activity.athleteId})`,
      );
      throw new ConflictException(
        `Ce fichier .fit est déjà rattaché à l'activité ${duplicate.id}`,
      );
    }

    const { parsed, session } = await this.parseFitFile(
      file,
      `activité=${activity.id}`,
    );

    const fitStartedAt = new Date(session.start_time);
    const driftSec =
      Math.abs(fitStartedAt.getTime() - activity.startedAt.getTime()) / 1000;
    if (driftSec > MAX_FIT_ATTACH_DRIFT_SEC) {
      throw new BadRequestException(
        `Ce fichier .fit ne correspond pas à l'activité : départ à ` +
          `${fitStartedAt.toISOString()} contre ${activity.startedAt.toISOString()}`,
      );
    }

    const lapRows = buildFitLapRows(parsed.laps);
    if (lapRows.length === 0) {
      throw new BadRequestException(
        'Ce fichier .fit ne contient aucun tour : rien à compléter',
      );
    }

    await this.prisma.$transaction([
      this.prisma.lap.deleteMany({ where: { activityId: activity.id } }),
      this.prisma.lap.createMany({
        data: lapRows.map((lap) => ({ ...lap, activityId: activity.id })),
      }),
      this.prisma.activity.update({
        where: { id: activity.id },
        data: { fitFileData: new Uint8Array(file.buffer), fitFileHash },
      }),
    ]);

    this.logger.log(
      `Laps remplacés par ceux du .fit : activité id=${activity.id}, ` +
        `${lapRows.length} lap(s) (athlète=${activity.athleteId})`,
    );

    return { activityId: activity.id, lapsCount: lapRows.length };
  }

  async uploadGpx(
    athleteUserId: string,
    activityId: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const activity = await this.getOwnedActivity(athleteUserId, activityId);

    const points = parseGpxTrackPoints(file.buffer.toString('utf-8'));
    if (points.length === 0) {
      throw new BadRequestException(
        'Fichier .gpx invalide : aucun point de trace trouvé',
      );
    }

    await this.prisma.$transaction([
      this.prisma.routePoint.deleteMany({
        where: { activityId: activity.id },
      }),
      this.prisma.routePoint.createMany({
        data: points.map((point) => ({
          activityId: activity.id,
          timestamp: point.time ? new Date(point.time) : null,
          latitude: point.lat,
          longitude: point.lon,
          altitudeM: point.ele,
        })),
      }),
      this.prisma.activity.update({
        where: { id: activity.id },
        data: { gpxFileData: new Uint8Array(file.buffer) },
      }),
    ]);

    this.logger.log(
      `Trace GPX importée : activité id=${activity.id}, ${points.length} point(s) (athlète=${activity.athleteId})`,
    );

    return { activityId: activity.id, routePointsCount: points.length };
  }

  async getRoute(userId: string, role: Role, id: string) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) {
      throw new NotFoundException('Activité introuvable');
    }

    await this.assertActivityAccess(userId, role, activity);

    return this.prisma.routePoint.findMany({
      where: { activityId: id },
      orderBy: { timestamp: 'asc' },
    });
  }

  async getFitFile(userId: string, role: Role, id: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
      select: { athleteId: true, fitFileData: true },
    });
    if (!activity) {
      throw new NotFoundException('Activité introuvable');
    }
    await this.assertActivityAccess(userId, role, activity);
    if (!activity.fitFileData) {
      throw new NotFoundException('Aucun fichier .fit associé à cette activité');
    }

    return { buffer: Buffer.from(activity.fitFileData), filename: `${id}.fit` };
  }

  async getGpxFile(userId: string, role: Role, id: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id },
      select: { athleteId: true, gpxFileData: true },
    });
    if (!activity) {
      throw new NotFoundException('Activité introuvable');
    }
    await this.assertActivityAccess(userId, role, activity);
    if (!activity.gpxFileData) {
      throw new NotFoundException('Aucun fichier .gpx associé à cette activité');
    }

    return { buffer: Buffer.from(activity.gpxFileData), filename: `${id}.gpx` };
  }

  async update(athleteUserId: string, id: string, dto: UpdateActivityDto) {
    const activity = await this.getOwnedActivity(athleteUserId, id);

    if (dto.workoutId && dto.workoutId !== activity.workoutId) {
      await this.assertWorkoutIsAssignable(activity.athleteId, dto.workoutId);
    }

    const updated = await this.prisma.activity.update({
      where: { id: activity.id },
      data: {
        workoutId: dto.workoutId,
        athleteNote: dto.athleteNote,
        difficultyNote: dto.difficultyNote,
      },
      include: { laps: true },
    });
    this.logger.log(`Note athlète mise à jour : activité id=${id}`);

    return toActivityDto(updated);
  }

  async remove(athleteUserId: string, id: string) {
    const activity = await this.getOwnedActivity(athleteUserId, id);

    await this.prisma.activity.delete({ where: { id: activity.id } });
    this.logger.log(
      `Activité supprimée : id=${id} (athlète=${activity.athleteId})`,
    );
  }

  private async parseFitFile(file: Express.Multer.File, context: string) {
    const parsed = await this.fitParser
      .parseAsync(Buffer.from(file.buffer))
      .catch((err: unknown) => {
        this.logger.error(
          `Échec du parsing .fit pour ${file.originalname} : ${String(err)}`,
        );
        throw new BadRequestException('Fichier .fit invalide ou corrompu');
      });

    const session = parsed.sessions?.[0];
    if (!session) {
      this.logger.warn(
        `Fichier .fit refusé : aucune session dans ${file.originalname} (${context})`,
      );
      throw new BadRequestException(
        'Fichier .fit invalide : aucune session trouvée',
      );
    }

    return { parsed, session };
  }

  private async getOwnedActivity(athleteUserId: string, id: string) {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity || activity.athleteId !== athlete.id) {
      throw new NotFoundException('Activité introuvable');
    }

    return activity;
  }

  private async assertActivityAccess(
    userId: string,
    role: Role,
    activity: { athleteId: string },
  ) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      const athleteProfile = coach
        ? await this.prisma.athleteProfile.findUnique({
            where: { id: activity.athleteId },
          })
        : null;
      if (!coach || athleteProfile?.coachId !== coach.id) {
        throw new ForbiddenException('Cette activité ne vous appartient pas');
      }
      return;
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete || activity.athleteId !== athlete.id) {
      throw new ForbiddenException('Cette activité ne vous appartient pas');
    }
  }

  async assertWorkoutIsAssignable(athleteId: string, workoutId: string) {
    const workout = await this.prisma.workout.findUnique({
      where: { id: workoutId },
      include: { plan: true },
    });
    if (!workout) {
      throw new NotFoundException('Workout introuvable');
    }
    if (workout.plan.athleteId !== athleteId) {
      throw new ForbiddenException('Ce workout ne vous appartient pas');
    }

    const alreadyLinked = await this.prisma.activity.findUnique({
      where: { workoutId },
    });
    if (alreadyLinked) {
      throw new ConflictException(
        'Ce workout est déjà lié à une autre activité',
      );
    }
  }

  // Utilisé par la sync Strava automatique : trouve le workout du jour (s'il
  // existe et n'a pas déjà une activité liée) pour l'y attacher sans action
  // manuelle de l'athlète.
  async findUnlinkedWorkoutIdForDate(
    athleteId: string,
    date: Date,
  ): Promise<string | undefined> {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const workout = await this.prisma.workout.findFirst({
      where: {
        plan: { athleteId },
        scheduledDate: { gte: start, lt: end },
        activity: null,
      },
    });
    return workout?.id;
  }
}

function roundOrUndefined(value: number | undefined): number | undefined {
  return value != null ? Math.round(value) : undefined;
}

type ParsedFit = Awaited<
  ReturnType<InstanceType<typeof FitParser>['parseAsync']>
>;

// Laps d'un .fit, prêts à être insérés (sans `activityId`, fourni par l'appelant
// selon qu'il crée l'activité ou rattache le fichier après coup).
function buildFitLapRows(laps: ParsedFit['laps']) {
  const rows = (laps ?? []).map((lap, index) => ({
    index,
    distanceM: lap.total_distance ?? 0,
    durationSec: lap.total_elapsed_time ?? 0,
    avgPaceSecPerKm: lap.avg_speed ? 1000 / lap.avg_speed : undefined,
    avgHeartRate: roundOrUndefined(lap.avg_heart_rate),
    maxHeartRate: roundOrUndefined(lap.max_heart_rate),
    avgCadence: roundOrUndefined(lap.avg_cadence),
    avgPower: roundOrUndefined(lap.avg_power),
    avgStanceTimeMs: lap.avg_stance_time,
    avgVerticalOscillationMm: lap.avg_vertical_oscillation,
    avgVerticalRatio: lap.avg_vertical_ratio,
    avgStepLengthMm: lap.avg_step_length,
  }));

  // L'intensité vient de la montre quand elle l'écrit, de l'estimation sinon.
  const intensities = resolveFitLapIntensities(
    (laps ?? []).map((lap, index) => ({
      intensity: lap.intensity,
      distanceM: rows[index].distanceM,
      durationSec: rows[index].durationSec,
      avgSpeedMPerSec: lap.avg_speed,
    })),
  );

  // Spread : `intensity` et `intensitySource` sont toujours posés ensemble.
  return rows.map((row, index) => ({ ...row, ...intensities[index] }));
}

function buildFitTrackPointRows(
  records: ParsedFit['records'],
  startedAt: Date,
) {
  // `timestamp`/`elapsed_time` are present at runtime on parsed records but
  // missing from fit-file-parser's ParsedRecord type declarations.
  const typedRecords = (records ?? []) as Array<
    NonNullable<ParsedFit['records']>[number] & {
      timestamp: string;
      elapsed_time?: number;
    }
  >;
  const startedAtMs = startedAt.getTime();

  return typedRecords.map((record) => ({
    timestamp: new Date(record.timestamp),
    elapsedSec:
      record.elapsed_time ??
      (new Date(record.timestamp).getTime() - startedAtMs) / 1000,
    distanceM: record.distance,
    latitude: record.position_lat,
    longitude: record.position_long,
    altitudeM: record.altitude,
    heartRate: roundOrUndefined(record.heart_rate),
    cadence: roundOrUndefined(record.cadence),
    power: roundOrUndefined(record.power),
    speedMPerSec: record.speed,
  }));
}

interface HeartRateAggregate {
  activityCount: number;
  activitiesWithDataCount: number;
  secondsWithoutData: number;
  secondsByZone: Map<number, number>;
}

interface HeartRateZoneDef {
  index: number;
  label: string;
  min: number;
  max: number | null;
}

// `highBounds` = bornes hautes déjà nettoyées de la dernière valeur
// inexploitable de AthleteProfile.heartRateZonesBpm (cf. getHeartRateZones).
// n bornes hautes -> n zones : les n-1 premières fermées sur ces bornes, la
// dernière ouverte (max: null). Même forme générique que réutilisera un futur
// GET /activities/pace-zones (unit: "sec_per_km").
function buildHeartRateZoneDefs(highBounds: number[]): HeartRateZoneDef[] {
  if (highBounds.length === 0) {
    return [];
  }

  const zones: HeartRateZoneDef[] = highBounds.map((max, i) => ({
    index: i + 1,
    label: `Z${i + 1}`,
    min: i === 0 ? 0 : highBounds[i - 1] + 1,
    max,
  }));

  zones.push({
    index: highBounds.length + 1,
    label: `Z${highBounds.length + 1}`,
    min: highBounds[highBounds.length - 1] + 1,
    max: null,
  });

  return zones;
}

function toActivityDto<
  T extends { fitFileData?: Uint8Array | null; gpxFileData?: Uint8Array | null },
>(
  activity: T,
): Omit<T, 'fitFileData' | 'gpxFileData'> & {
  hasFitFile: boolean;
  hasGpxFile: boolean;
} {
  const { fitFileData, gpxFileData, ...rest } = activity;
  return {
    ...rest,
    hasFitFile: fitFileData != null,
    hasGpxFile: gpxFileData != null,
  };
}

interface GpxTrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

const gpxParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function parseGpxTrackPoints(xml: string): GpxTrackPoint[] {
  let doc: unknown;
  try {
    doc = gpxParser.parse(xml);
  } catch {
    throw new BadRequestException('Fichier .gpx invalide ou corrompu');
  }

  const gpx = (doc as { gpx?: unknown })?.gpx as
    | { trk?: unknown }
    | undefined;
  if (!gpx) {
    throw new BadRequestException(
      'Fichier .gpx invalide : balise <gpx> introuvable',
    );
  }

  const points: GpxTrackPoint[] = [];
  for (const trk of toArray<{ trkseg?: unknown }>(gpx.trk)) {
    for (const seg of toArray<{ trkpt?: unknown }>(trk?.trkseg)) {
      for (const pt of toArray<Record<string, unknown>>(seg?.trkpt)) {
        const lat = Number(pt?.['@_lat']);
        const lon = Number(pt?.['@_lon']);
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
          continue;
        }
        points.push({
          lat,
          lon,
          ele: pt?.ele != null ? Number(pt.ele) : undefined,
          time: typeof pt?.time === 'string' ? pt.time : undefined,
        });
      }
    }
  }

  return points;
}

function toArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}
