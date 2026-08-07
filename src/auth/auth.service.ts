import {
  ConflictException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    this.logger.log(`Tentative d'inscription : ${dto.email} (${dto.role})`);

    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      this.logger.warn(
        `Inscription refusée : email déjà utilisé (${dto.email})`,
      );
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const password = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      password,
      role: dto.role,
    });
    this.logger.log(
      `Compte créé : ${user.email} (${user.role}, id=${user.id})`,
    );

    return this.buildToken(user);
  }

  async login(dto: LoginDto) {
    this.logger.log(`Tentative de connexion : ${dto.email}`);

    const user = await this.usersService.findByEmail(dto.email);
    const passwordMatches =
      user && (await bcrypt.compare(dto.password, user.password));

    if (!passwordMatches) {
      this.logger.warn(
        `Connexion refusée : identifiants invalides (${dto.email})`,
      );
      throw new UnauthorizedException('Identifiants invalides');
    }

    this.logger.log(`Connexion réussie : ${user.email} (id=${user.id})`);
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
