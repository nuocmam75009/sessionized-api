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
        startedAt: new Date(session.start_time),
        totalDistanceM: session.total_distance ?? 0,
        totalDurationSec: Math.round(session.total_elapsed_time ?? 0),
        plannedSessionId: plannedSessionId ?? undefined,
        laps: {
          create: (parsed.laps ?? []).map((lap, index) => ({
            index,
            distanceM: lap.total_distance ?? 0,
            durationSec: lap.total_elapsed_time ?? 0,
            avgPaceSecPerKm: lap.avg_speed ? 1000 / lap.avg_speed : undefined,
            avgHeartRate:
              lap.avg_heart_rate != null
                ? Math.round(lap.avg_heart_rate)
                : undefined,
            avgCadence:
              lap.avg_cadence != null ? Math.round(lap.avg_cadence) : undefined,
            avgPower:
              lap.avg_power != null ? Math.round(lap.avg_power) : undefined,
          })),
        },
      },
      include: { laps: true },
    });

    this.logger.log(
      `Activité créée : id=${activity.id}, ${activity.laps.length} lap(s), ${activity.totalDistanceM}m, ${activity.totalDurationSec}s (athlète=${athlete.id})`,
    );

    return activity;
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
    } else {
      const athlete = await this.usersService.getAthleteProfile(userId);
      if (!athlete || activity.athleteId !== athlete.id) {
        throw new ForbiddenException('Cette activité ne vous appartient pas');
      }
    }

    return activity;
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
