import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './types/jwt-payload.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Créer un compte (athlète ou coach)' })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Se connecter et obtenir un JWT' })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: "Récupérer l'utilisateur authentifié" })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
