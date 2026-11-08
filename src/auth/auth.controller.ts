import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type {
  AccessTokenClaims,
  JwtPayload,
} from './types/jwt-payload.interface';

// Anti brute-force : 10 tentatives par minute et par IP sur login/register
// (au lieu de la limite globale, cf. AppModule).
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Créer un compte (athlète ou coach)' })
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Se connecter et obtenir un JWT' })
  @ApiUnauthorizedResponse({ description: 'Identifiants invalides' })
  @ApiTooManyRequestsResponse({
    description:
      "Plus de 10 requêtes par minute depuis cette IP, ou plus de 5 tentatives en 15 minutes sur ce compte (connexion verrouillée jusqu'à la fin de la fenêtre)",
  })
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Se déconnecter : le jeton présenté est révoqué',
    description:
      "Le jeton n'est plus accepté par aucune route jusqu'à son expiration. Les autres sessions du compte restent ouvertes.",
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@CurrentUser() claims: AccessTokenClaims) {
    return this.authService.logout(claims);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Récupérer l'utilisateur authentifié" })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
