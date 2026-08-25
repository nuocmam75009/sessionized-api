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
import type { UploadActivityDto } from './dto/upload-activity.dto';
import type { UpdateActivityDto } from './dto/update-activity.dto';

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
        `Upload refusé : aucune session dans ${file.originalname} (athlète=${athlete.id})`,
      );
      throw new BadRequestException(
        'Fichier .fit invalide : aucune session trouvée',
      );
    }

    const activity = await this.prisma.activity.create({
      data: {
        athleteId: athlete.id,
        source: ActivitySource.FIT,
        fileHash,
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
        laps: {
          create: (parsed.laps ?? []).map((lap, index) => ({
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
          })),
        },
      },
      include: { laps: true },
    });

    // `timestamp`/`elapsed_time` are present at runtime on parsed records but
    // missing from fit-file-parser's ParsedRecord type declarations.
    const trackPoints = (parsed.records ?? []) as Array<
      NonNullable<typeof parsed.records>[number] & {
        timestamp: string;
        elapsed_time?: number;
      }
    >;
    if (trackPoints.length > 0) {
      const startedAtMs = activity.startedAt.getTime();
      await this.prisma.trackPoint.createMany({
        data: trackPoints.map((record) => ({
          activityId: activity.id,
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

    const updated = await this.prisma.activity.update({
      where: { id: activity.id },
      data: {
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

  private async assertWorkoutIsAssignable(athleteId: string, workoutId: string) {
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
}

function roundOrUndefined(value: number | undefined): number | undefined {
  return value != null ? Math.round(value) : undefined;
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
