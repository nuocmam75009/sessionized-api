import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanStatus, Role } from '../../generated/prisma/enums';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(coachUserId: string, dto: CreatePlanDto) {
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

    const [, created] = await this.prisma.$transaction([
      // Un seul plan ACTIVE à la fois par athlète : le précédent (s'il existe)
      // passe en ARCHIVED dès qu'un nouveau démarre.
      this.prisma.plan.updateMany({
        where: { athleteId: athlete.id, status: PlanStatus.ACTIVE },
        data: { status: PlanStatus.ARCHIVED },
      }),
      this.prisma.plan.create({
        data: {
          coachId: coach.id,
          athleteId: athlete.id,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          objective1: dto.objective1,
          objective2: dto.objective2,
        },
      }),
    ]);
    this.logger.log(
      `Plan créé : id=${created.id} (coach=${coach.id}, athlète=${athlete.id})`,
    );

    return created;
  }

  async findAll(userId: string, role: Role, athleteId?: string) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }

      return this.prisma.plan.findMany({
        where: { coachId: coach.id, ...(athleteId ? { athleteId } : {}) },
        orderBy: { startDate: 'desc' },
      });
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    return this.prisma.plan.findMany({
      where: { athleteId: athlete.id },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(userId: string, role: Role, id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        workouts: {
          include: { laps: true },
          orderBy: { scheduledDate: 'asc' },
        },
      },
    });
    if (!plan) {
      throw new NotFoundException('Plan introuvable');
    }

    await this.assertAccess(userId, role, plan);
    return plan;
  }

  async update(coachUserId: string, id: string, dto: UpdatePlanDto) {
    const plan = await this.getOwnedPlan(coachUserId, id);

    return this.prisma.plan.update({
      where: { id: plan.id },
      data: {
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        objective1: dto.objective1,
        objective2: dto.objective2,
        status: dto.status,
      },
    });
  }

  private async getOwnedPlan(coachUserId: string, id: string) {
    const coach = await this.usersService.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException('Plan introuvable');
    }
    if (plan.coachId !== coach.id) {
      throw new ForbiddenException('Vous ne gérez pas ce plan');
    }

    return plan;
  }

  private async assertAccess(
    userId: string,
    role: Role,
    plan: { coachId: string; athleteId: string },
  ) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach || plan.coachId !== coach.id) {
        throw new ForbiddenException('Vous ne gérez pas ce plan');
      }
      return;
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete || plan.athleteId !== athlete.id) {
      throw new ForbiddenException('Ce plan ne vous appartient pas');
    }
  }
}
