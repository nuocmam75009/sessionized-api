import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

const BCRYPT_SALT_ROUNDS = 10;

interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      password,
      role: dto.role,
    });

    return this.buildToken(user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    const passwordMatches =
      user && (await bcrypt.compare(dto.password, user.password));

    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    return this.buildToken(user);
  }

  private buildToken(user: AuthenticatedUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: payload,
    };
  }
}
