import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginAttemptsService } from './login-attempts.service';
import { TokenRevocationService } from './token-revocation.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AccessTokenClaims, JwtPayload } from './types/jwt-payload.interface';
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
    private readonly loginAttempts: LoginAttemptsService,
    private readonly revocation: TokenRevocationService,
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
      firstName: dto.firstName,
      lastName: dto.lastName,
      // RegisterDto a déjà refusé un athlète sans consentement : on en garde
      // ici la preuve, datée.
      healthDataConsentAt: dto.role === Role.ATHLETE ? new Date() : undefined,
    });
    this.logger.log(
      `Compte créé : ${user.email} (${user.role}, id=${user.id})`,
    );

    return this.buildToken(user);
  }

  async login(dto: LoginDto) {
    this.logger.log(`Tentative de connexion : ${dto.email}`);

    // Comptée avant de vérifier le mot de passe : un compte verrouillé ne
    // déclenche ni requête SQL ni calcul bcrypt. Le compteur existe aussi
    // pour les emails inconnus, donc la réponse 429 ne révèle pas si un
    // compte existe.
    const retryAfterSeconds = await this.loginAttempts.consumeAttempt(
      dto.email,
    );
    if (retryAfterSeconds > 0) {
      this.logger.warn(`Connexion refusée : trop de tentatives (${dto.email})`);
      // retryAfterSec : le délai en clair pour les clients, qui affichent
      // leur propre message (le front athlète est en anglais).
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Trop de tentatives de connexion. Réessayez dans ${Math.ceil(retryAfterSeconds / 60)} min.`,
          retryAfterSec: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findByEmail(dto.email);
    const passwordMatches =
      user && (await bcrypt.compare(dto.password, user.password));

    if (!passwordMatches) {
      this.logger.warn(
        `Connexion refusée : identifiants invalides (${dto.email})`,
      );
      throw new UnauthorizedException('Identifiants invalides');
    }

    await this.loginAttempts.reset(dto.email);
    this.logger.log(`Connexion réussie : ${user.email} (id=${user.id})`);
    return this.buildToken(user);
  }

  /**
   * Déconnexion : le jeton présenté est révoqué jusqu'à son expiration. Il a
   * déjà été vérifié par le JwtAuthGuard, ses revendications sont fiables.
   */
  async logout(claims: AccessTokenClaims): Promise<void> {
    await this.revocation.revoke(claims.jti, claims.exp);
    this.logger.log(`Déconnexion : jeton révoqué (id=${claims.sub})`);
  }

  private buildToken(user: AuthenticatedUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      // jti : identifiant unique du jeton, qui permet de le révoquer seul.
      accessToken: this.jwtService.sign(payload, { jwtid: randomUUID() }),
      user: payload,
    };
  }
}
