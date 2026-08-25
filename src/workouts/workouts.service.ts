import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { Role } from '../../generated/prisma/enums';

@Injectable()
export class WorkoutsService {
  private readonly logger = new Logger(WorkoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(coachUserId: string, dto: CreateWorkoutDto) {
    const coach = await this.usersService.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const athlete = await this.prisma.athleteProfile.findUnique({
      where: { id: dto.athleteId },
    });
    if (!athlete) {
      throw new NotFoundException('Athlète introuvable');
    }
    if (athlete.coachId !== coach.id) {
      throw new ForbiddenException("Cet athlète n'est pas coaché par vous");
    }

    const plan = await this.prisma.plan.upsert({
      where: { athleteId: athlete.id },
      create: { coachId: coach.id, athleteId: athlete.id },
      update: {},
    });

    const created = await this.prisma.workout.create({
      data: {
        planId: plan.id,
        title: dto.title,
        scheduledDate: new Date(dto.scheduledDate),
        coachNote: dto.coachNote,
        targetDistanceM: dto.targetDistanceM,
        targetDurationSec: dto.targetDurationSec,
        targetHeartRateZone: dto.targetHeartRateZone,
        laps: { create: dto.laps },
      },
      include: { laps: true },
    });
    this.logger.log(
      `Workout créé : id=${created.id}, ${created.laps.length} lap(s) (coach=${coach.id}, athlète=${athlete.id})`,
    );

    return created;
  }

  async findAll(userId: string, role: Role, athleteId?: string) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }

      return this.prisma.workout.findMany({
        where: {
          plan: { coachId: coach.id, ...(athleteId ? { athleteId } : {}) },
        },
        include: { laps: true },
        orderBy: { scheduledDate: 'asc' },
      });
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    return this.prisma.workout.findMany({
      where: { plan: { athleteId: athlete.id } },
      include: { laps: true },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async findOne(userId: string, role: Role, id: string) {
    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: { laps: true, plan: true },
    });
    if (!workout) {
      throw new NotFoundException('Workout introuvable');
    }

    await this.assertAccess(userId, role, workout);
    const { plan: _plan, ...rest } = workout;
    return rest;
  }

  async update(coachUserId: string, id: string, dto: UpdateWorkoutDto) {
    await this.getOwnedWorkout(coachUserId, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.laps) {
        await tx.workoutLap.deleteMany({ where: { workoutId: id } });
      }

      return tx.workout.update({
        where: { id },
        data: {
          title: dto.title,
          scheduledDate: dto.scheduledDate
            ? new Date(dto.scheduledDate)
            : undefined,
          coachNote: dto.coachNote,
          targetDistanceM: dto.targetDistanceM,
          targetDurationSec: dto.targetDurationSec,
          targetHeartRateZone: dto.targetHeartRateZone,
          laps: dto.laps ? { create: dto.laps } : undefined,
        },
        include: { laps: true },
      });
    });
  }

  async remove(coachUserId: string, id: string) {
    await this.getOwnedWorkout(coachUserId, id);
    await this.prisma.workout.delete({ where: { id } });
    this.logger.log(`Workout supprimé : id=${id}`);
  }

  private async getOwnedWorkout(coachUserId: string, id: string) {
    const coach = await this.usersService.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const workout = await this.prisma.workout.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!workout) {
      throw new NotFoundException('Workout introuvable');
    }
    if (workout.plan.coachId !== coach.id) {
      throw new ForbiddenException('Vous ne gérez pas ce workout');
    }

    return workout;
  }

  private async assertAccess(
    userId: string,
    role: Role,
    workout: { plan: { coachId: string; athleteId: string } },
  ) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach || workout.plan.coachId !== coach.id) {
        throw new ForbiddenException('Vous ne gérez pas ce workout');
      }
      return;
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete || workout.plan.athleteId !== athlete.id) {
      throw new ForbiddenException('Ce workout ne vous appartient pas');
    }
  }
}
