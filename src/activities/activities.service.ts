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
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ActivitySource, Role } from '../../generated/prisma/enums';

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
    plannedSessionId?: string,
  ) {
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

    if (plannedSessionId) {
      await this.assertPlannedSessionIsAssignable(athlete.id, plannedSessionId);
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
        plannedSessionId: plannedSessionId ?? undefined,
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

    return { ...activity, trackPointsCount: trackPoints.length };
  }

  async findAll(userId: string, role: Role, athleteId?: string) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }

      return this.prisma.activity.findMany({
        where: {
          athlete: { coachId: coach.id },
          ...(athleteId ? { athleteId } : {}),
        },
        include: { laps: true },
        orderBy: { startedAt: 'desc' },
      });
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    return this.prisma.activity.findMany({
      where: { athleteId: athlete.id },
      include: { laps: true },
      orderBy: { startedAt: 'desc' },
    });
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
    return activity;
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

  async remove(athleteUserId: string, id: string) {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity || activity.athleteId !== athlete.id) {
      throw new NotFoundException('Activité introuvable');
    }

    await this.prisma.activity.delete({ where: { id } });
    this.logger.log(`Activité supprimée : id=${id} (athlète=${athlete.id})`);
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

  private async assertPlannedSessionIsAssignable(
    athleteId: string,
    plannedSessionId: string,
  ) {
    const plannedSession = await this.prisma.plannedSession.findUnique({
      where: { id: plannedSessionId },
    });
    if (!plannedSession) {
      throw new NotFoundException('Séance planifiée introuvable');
    }
    if (plannedSession.athleteId !== athleteId) {
      throw new ForbiddenException(
        'Cette séance planifiée ne vous appartient pas',
      );
    }

    const alreadyLinked = await this.prisma.activity.findUnique({
      where: { plannedSessionId },
    });
    if (alreadyLinked) {
      throw new ConflictException(
        'Cette séance planifiée est déjà liée à une autre activité',
      );
    }
  }
}

function roundOrUndefined(value: number | undefined): number | undefined {
  return value != null ? Math.round(value) : undefined;
}
