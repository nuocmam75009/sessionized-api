import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../generated/prisma/enums';

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
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
}
