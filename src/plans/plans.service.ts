import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreatePlannedSessionDto } from './dto/create-planned-session.dto';
import { UpdatePlannedSessionDto } from './dto/update-planned-session.dto';
import { Role } from '../../generated/prisma/enums';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(coachUserId: string, dto: CreatePlannedSessionDto) {
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

    const created = await this.prisma.plannedSession.create({
      data: {
        coachId: coach.id,
        athleteId: athlete.id,
        title: dto.title,
        scheduledDate: new Date(dto.scheduledDate),
        plannedLaps: { create: dto.plannedLaps },
      },
      include: { plannedLaps: true },
    });
    this.logger.log(
      `Séance planifiée créée : id=${created.id}, ${created.plannedLaps.length} lap(s) (coach=${coach.id}, athlète=${athlete.id})`,
    );

    return created;
  }

  async findAll(userId: string, role: Role, athleteId?: string) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach) {
        throw new ForbiddenException('Profil coach introuvable');
      }

      return this.prisma.plannedSession.findMany({
        where: { coachId: coach.id, ...(athleteId ? { athleteId } : {}) },
        include: { plannedLaps: true },
        orderBy: { scheduledDate: 'asc' },
      });
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    return this.prisma.plannedSession.findMany({
      where: { athleteId: athlete.id },
      include: { plannedLaps: true },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async findOne(userId: string, role: Role, id: string) {
    const session = await this.prisma.plannedSession.findUnique({
      where: { id },
      include: { plannedLaps: true },
    });
    if (!session) {
      throw new NotFoundException('Séance introuvable');
    }

    await this.assertAccess(userId, role, session);
    return session;
  }

  async update(coachUserId: string, id: string, dto: UpdatePlannedSessionDto) {
    await this.getOwnedSession(coachUserId, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.plannedLaps) {
        await tx.plannedLap.deleteMany({ where: { plannedSessionId: id } });
      }

      return tx.plannedSession.update({
        where: { id },
        data: {
          title: dto.title,
          scheduledDate: dto.scheduledDate
            ? new Date(dto.scheduledDate)
            : undefined,
          plannedLaps: dto.plannedLaps
            ? { create: dto.plannedLaps }
            : undefined,
        },
        include: { plannedLaps: true },
      });
    });
  }

  async remove(coachUserId: string, id: string) {
    await this.getOwnedSession(coachUserId, id);
    await this.prisma.plannedSession.delete({ where: { id } });
    this.logger.log(`Séance planifiée supprimée : id=${id}`);
  }

  private async getOwnedSession(coachUserId: string, id: string) {
    const coach = await this.usersService.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const session = await this.prisma.plannedSession.findUnique({
      where: { id },
    });
    if (!session) {
      throw new NotFoundException('Séance introuvable');
    }
    if (session.coachId !== coach.id) {
      throw new ForbiddenException('Vous ne gérez pas cette séance');
    }

    return session;
  }

  private async assertAccess(
    userId: string,
    role: Role,
    session: { coachId: string; athleteId: string },
  ) {
    if (role === Role.COACH) {
      const coach = await this.usersService.getCoachProfile(userId);
      if (!coach || session.coachId !== coach.id) {
        throw new ForbiddenException('Vous ne gérez pas cette séance');
      }
      return;
    }

    const athlete = await this.usersService.getAthleteProfile(userId);
    if (!athlete || session.athleteId !== athlete.id) {
      throw new ForbiddenException('Cette séance ne vous appartient pas');
    }
  }
}
