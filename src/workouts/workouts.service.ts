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
import type { ListWorkoutsQueryDto } from './dto/list-workouts-query.dto';
import { PlanStatus, Role } from '../../generated/prisma/enums';

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

    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan) {
      throw new NotFoundException('Plan introuvable');
    }
    if (plan.coachId !== coach.id) {
      throw new ForbiddenException('Vous ne gérez pas ce plan');
    }
    if (plan.status !== PlanStatus.ACTIVE) {
      throw new ForbiddenException(
        "Impossible d'ajouter un workout à un plan qui n'est plus actif",
      );
    }

    const created = await this.prisma.workout.create({
      data: {
        planId: plan.id,
        title: dto.title,
        scheduledDate: new Date(dto.scheduledDate),
        coachNote: dto.coachNote,
        targetDistanceM: dto.targetDistanceM,
        targetDurationSec: dto.targetDurationSec,
        targetHeartRateZone: dto.targetHeartRateZone,
        training: dto.training,
        laps: { create: dto.laps },
      },
      include: { laps: true },
    });
    this.logger.log(
      `Workout créé : id=${created.id}, ${created.laps.length} lap(s) (coach=${coach.id}, plan=${plan.id})`,
    );

    return created;
  }

  async findAll(userId: string, role: Role, query: ListWorkoutsQueryDto) {
    // `training` absent vaut `undefined`, que Prisma ignore : pas de filtre.
    const { athleteId, training } = query;

    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }

      return this.prisma.workout.findMany({
        where: {
          plan: { coachId: coach.id, ...(athleteId ? { athleteId } : {}) },
          training,
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
      where: { plan: { athleteId: athlete.id }, training },
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
    const workout = await this.getOwnedWorkout(coachUserId, id);
    const trainingChanged =
      dto.training !== undefined && dto.training !== workout.training;

    return this.prisma.$transaction(async (tx) => {
      if (dto.laps) {
        await tx.workoutLap.deleteMany({ where: { workoutId: id } });
      }

      // Le coach requalifie la séance : l'activité qui la réalise suit, dans
      // un sens comme dans l'autre. Seul un changement effectif est répercuté,
      // pour qu'un PATCH qui renvoie la même valeur n'écrase pas le choix que
      // l'athlète a pu faire depuis.
      if (trainingChanged) {
        const { count } = await tx.activity.updateMany({
          where: { workoutId: id },
          data: { training: dto.training },
        });
        if (count > 0) {
          this.logger.log(
            `Flag training (${String(dto.training)}) répercuté sur l'activité liée au workout ${id}`,
          );
        }
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
          training: dto.training,
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
