import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StravaService } from './strava.service';
import { ImportStravaActivityDto } from './dto/import-strava-activity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@ApiTags('strava')
@Controller('strava')
export class StravaController {
  constructor(
    private readonly stravaService: StravaService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({
    summary: "Générer l'URL de connexion OAuth Strava pour l'athlète courant",
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ATHLETE)
  @Get('authorize')
  async authorize(@CurrentUser() user: JwtPayload) {
    const url = await this.stravaService.getAuthorizeUrl(user.sub);
    return { url };
  }

  @ApiOperation({
    summary: "Savoir si l'athlète courant a un compte Strava connecté",
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ATHLETE)
  @Get('status')
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.stravaService.getStatus(user.sub);
  }

  @ApiOperation({ summary: 'Déconnecter le compte Strava de cet athlète' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ATHLETE)
  @Delete('disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.stravaService.disconnect(user.sub);
  }

  @ApiOperation({
    summary:
      "Callback OAuth appelé par Strava (redirection navigateur, sans JWT) — identifie l'athlète via le paramètre state, puis redirige vers /profile sur l'app athlète",
  })
  @Get('callback')
  @Redirect()
  async callback(@Query('code') code: string, @Query('state') state: string) {
    const athleteAppUrl =
      this.configService.get<string>('ATHLETE_APP_URL') ??
      'http://localhost:3000';

    try {
      await this.stravaService.handleCallback(code, state);
      return { url: `${athleteAppUrl}/profile?strava=connected` };
    } catch {
      return { url: `${athleteAppUrl}/profile?strava=error` };
    }
  }

  @ApiOperation({
    summary:
      "Lister les activités Strava récentes de l'athlète, pour choisir laquelle importer",
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ATHLETE)
  @Get('activities')
  listActivities(@CurrentUser() user: JwtPayload) {
    return this.stravaService.listActivities(user.sub);
  }

  @ApiOperation({
    summary:
      'Importer une activité Strava choisie (laps + trace GPS) au lieu d’un upload manuel .fit/.gpx',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ATHLETE)
  @Post('activities/:stravaActivityId/import')
  importActivity(
    @CurrentUser() user: JwtPayload,
    @Param('stravaActivityId') stravaActivityId: string,
    @Body() dto: ImportStravaActivityDto,
  ) {
    return this.stravaService.importActivity(user.sub, stravaActivityId, dto);
  }

  @ApiOperation({
    summary:
      "Synchroniser automatiquement les nouvelles activités Strava de l'athlète, en les liant au workout du jour si un seul existe et n'est pas déjà pris",
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ATHLETE)
  @Post('sync')
  syncActivities(@CurrentUser() user: JwtPayload) {
    return this.stravaService.syncActivities(user.sub);
  }
}
