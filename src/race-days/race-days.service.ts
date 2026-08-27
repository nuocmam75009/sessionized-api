import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateRaceDayDto } from './dto/create-race-day.dto';
import { UpdateRaceDayDto } from './dto/update-race-day.dto';
import { PlanStatus } from '../../generated/prisma/enums';

@Injectable()
export class RaceDaysService {
  private readonly logger = new Logger(RaceDaysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(coachUserId: string, dto: CreateRaceDayDto) {
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
        "Impossible d'ajouter une course à un plan qui n'est plus actif",
      );
    }

    const created = await this.prisma.raceDay.create({
      data: {
        planId: plan.id,
        title: dto.title,
        date: new Date(dto.date),
      },
    });
    this.logger.log(
      `RaceDay créée : id=${created.id}, titre="${created.title}" (plan=${plan.id})`,
    );

    return created;
  }

  async update(coachUserId: string, id: string, dto: UpdateRaceDayDto) {
    const raceDay = await this.getOwnedRaceDay(coachUserId, id);

    return this.prisma.raceDay.update({
      where: { id: raceDay.id },
      data: {
        title: dto.title,
        date: dto.date ? new Date(dto.date) : undefined,
      },
    });
  }

  async remove(coachUserId: string, id: string) {
    const raceDay = await this.getOwnedRaceDay(coachUserId, id);
    await this.prisma.raceDay.delete({ where: { id: raceDay.id } });
    this.logger.log(`RaceDay supprimée : id=${id}`);
  }

  private async getOwnedRaceDay(coachUserId: string, id: string) {
    const coach = await this.usersService.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const raceDay = await this.prisma.raceDay.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!raceDay) {
      throw new NotFoundException('RaceDay introuvable');
    }
    if (raceDay.plan.coachId !== coach.id) {
      throw new ForbiddenException('Vous ne gérez pas cette course');
    }

    return raceDay;
  }
}
