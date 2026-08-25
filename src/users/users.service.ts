import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../generated/prisma/enums';

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  getAthleteProfile(userId: string) {
    return this.prisma.athleteProfile.findUnique({ where: { userId } });
  }

  getCoachProfile(userId: string) {
    return this.prisma.coachProfile.findUnique({ where: { userId } });
  }

  create({ email, password, role }: CreateUserInput) {
    return this.prisma.user.create({
      data: {
        email,
        password,
        role,
        athleteProfile: role === Role.ATHLETE ? { create: {} } : undefined,
        coachProfile: role === Role.COACH ? { create: {} } : undefined,
      },
    });
  }

  getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        athleteProfile: { select: { id: true, coachId: true } },
        coachProfile: {
          select: {
            id: true,
            age: true,
            description: true,
            specialty: true,
            rating: true,
          },
        },
      },
    });
  }

  async updateMe(
    userId: string,
    dto: { firstName?: string; lastName?: string; email?: string },
  ) {
    if (dto.email) {
      const existing = await this.findByEmail(dto.email);
      if (existing && existing.id !== userId) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });
    this.logger.log(`Profil mis à jour : ${updated.id} (${updated.email})`);

    return updated;
  }

  async listAthletes(coachUserId: string) {
    const coach = await this.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    return this.prisma.athleteProfile.findMany({
      where: { coachId: coach.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getAthleteDetail(coachUserId: string, athleteId: string) {
    const coach = await this.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const athlete = await this.prisma.athleteProfile.findUnique({
      where: { id: athleteId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        plan: { select: { id: true, createdAt: true } },
      },
    });
    if (!athlete || athlete.coachId !== coach.id) {
      throw new NotFoundException('Athlète introuvable dans votre roster');
    }

    return athlete;
  }

  async assignAthlete(coachUserId: string, athleteEmail: string) {
    const coach = await this.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const athleteUser = await this.prisma.user.findUnique({
      where: { email: athleteEmail },
      include: { athleteProfile: true },
    });
    if (!athleteUser || !athleteUser.athleteProfile) {
      throw new NotFoundException('Aucun athlète trouvé avec cet email');
    }

    if (athleteUser.athleteProfile.coachId === coach.id) {
      this.logger.warn(
        `Assignation refusée : ${athleteEmail} déjà dans le roster du coach ${coach.id}`,
      );
      throw new ConflictException('Cet athlète est déjà dans votre roster');
    }
    if (athleteUser.athleteProfile.coachId) {
      this.logger.warn(
        `Assignation refusée : ${athleteEmail} déjà coaché par un autre coach`,
      );
      throw new ConflictException(
        'Cet athlète est déjà coaché par quelqu’un d’autre',
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.athleteProfile.update({
        where: { id: athleteUser.athleteProfile.id },
        data: { coachId: coach.id },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.plan.create({
        data: { coachId: coach.id, athleteId: athleteUser.athleteProfile.id },
      }),
    ]);
    this.logger.log(
      `Athlète ${athleteEmail} assigné au coach ${coach.id}, plan créé`,
    );

    return updated;
  }

  async unassignAthlete(coachUserId: string, athleteProfileId: string) {
    const coach = await this.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const athlete = await this.prisma.athleteProfile.findUnique({
      where: { id: athleteProfileId },
    });
    if (!athlete || athlete.coachId !== coach.id) {
      throw new NotFoundException('Athlète introuvable dans votre roster');
    }

    await this.prisma.$transaction([
      this.prisma.athleteProfile.update({
        where: { id: athleteProfileId },
        data: { coachId: null },
      }),
      this.prisma.plan.deleteMany({ where: { athleteId: athleteProfileId } }),
    ]);
    this.logger.log(
      `Athlète ${athleteProfileId} retiré du roster du coach ${coach.id}, plan supprimé`,
    );
  }

  listCoaches() {
    return this.prisma.coachProfile.findMany({
      select: {
        id: true,
        createdAt: true,
        age: true,
        description: true,
        specialty: true,
        rating: true,
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async updateMyCoachProfile(
    coachUserId: string,
    dto: { age?: number; description?: string; specialty?: string },
  ) {
    const coach = await this.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const updated = await this.prisma.coachProfile.update({
      where: { id: coach.id },
      data: {
        age: dto.age,
        description: dto.description,
        specialty: dto.specialty,
      },
      select: {
        id: true,
        age: true,
        description: true,
        specialty: true,
        rating: true,
      },
    });
    this.logger.log(`Profil coach mis à jour : ${coach.id}`);

    return updated;
  }

  async getMyCoach(athleteUserId: string) {
    const athlete = await this.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }
    if (!athlete.coachId) {
      throw new NotFoundException("Vous n'avez pas de coach actuellement");
    }

    return this.prisma.coachProfile.findUnique({
      where: { id: athlete.coachId },
      select: {
        id: true,
        createdAt: true,
        age: true,
        description: true,
        specialty: true,
        rating: true,
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async rateMyCoach(athleteUserId: string, value: number) {
    const athlete = await this.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }
    if (!athlete.coachId) {
      throw new NotFoundException("Vous n'avez pas de coach actuellement");
    }

    const coachId = athlete.coachId;

    const [, aggregate] = await this.prisma.$transaction([
      this.prisma.coachRating.upsert({
        where: { coachId_athleteId: { coachId, athleteId: athlete.id } },
        create: { coachId, athleteId: athlete.id, value },
        update: { value },
      }),
      this.prisma.coachRating.aggregate({
        where: { coachId },
        _avg: { value: true },
      }),
    ]);

    const updated = await this.prisma.coachProfile.update({
      where: { id: coachId },
      data: { rating: aggregate._avg.value },
      select: { id: true, rating: true },
    });
    this.logger.log(
      `Coach ${coachId} noté par l'athlète ${athlete.id} (${value}/5) — nouvelle moyenne : ${updated.rating}`,
    );

    return updated;
  }

  async leaveCoach(athleteUserId: string) {
    const athlete = await this.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }
    if (!athlete.coachId) {
      throw new ConflictException("Vous n'avez pas de coach actuellement");
    }

    const previousCoachId = athlete.coachId;
    await this.prisma.$transaction([
      this.prisma.athleteProfile.update({
        where: { id: athlete.id },
        data: { coachId: null },
      }),
      this.prisma.plan.deleteMany({ where: { athleteId: athlete.id } }),
    ]);
    this.logger.log(
      `Athlète ${athlete.id} a quitté le coach ${previousCoachId}, plan supprimé`,
    );
  }
}
