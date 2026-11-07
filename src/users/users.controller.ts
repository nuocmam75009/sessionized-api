import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { PersonalDataService } from './personal-data.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { HealthDataConsentDto } from './dto/health-data-consent.dto';
import { AssignAthleteDto } from './dto/assign-athlete.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateCoachProfileDto } from './dto/update-coach-profile.dto';
import { UpdateAthleteProfileDto } from './dto/update-athlete-profile.dto';
import { RateCoachDto } from './dto/rate-coach.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly personalData: PersonalDataService,
  ) {}

  @ApiOperation({ summary: 'Récupérer son propre profil' })
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @ApiOperation({ summary: 'Modifier son propre profil (nom, prénom, email)' })
  @Patch('me')
  updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @ApiOperation({
    summary:
      'Supprimer mon compte et toutes mes données (droit à l’effacement, art. 17 RGPD). Mot de passe redemandé.',
  })
  @ApiNoContentResponse({ description: 'Compte et données supprimés' })
  @ApiForbiddenResponse({
    description:
      'Mot de passe incorrect (403 et non 401 : la session reste valide), ou compte coach',
  })
  @Roles(Role.ATHLETE)
  // Le mot de passe se devine ici aussi : même plafond que la connexion.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(@CurrentUser() user: JwtPayload, @Body() dto: DeleteAccountDto) {
    return this.personalData.deleteAthleteAccount(user.sub, dto.password);
  }

  @ApiOperation({
    summary:
      'Exporter toutes mes données en JSON, fichiers .fit/.gpx compris (droits d’accès et de portabilité, art. 15 et 20 RGPD)',
  })
  @Roles(Role.ATHLETE)
  @Get('me/export')
  exportMyData(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sessionized-export-${day}.json"`,
    );
    // Données de santé : aucun cache intermédiaire ne doit en garder copie.
    res.setHeader('Cache-Control', 'no-store');
    return this.personalData.exportAthleteData(user.sub);
  }

  @ApiOperation({
    summary:
      'Donner mon consentement au traitement de mes données de santé (comptes créés avant la case d’inscription). La date d’un consentement déjà donné est conservée.',
  })
  @Roles(Role.ATHLETE)
  @Post('me/health-consent')
  @HttpCode(HttpStatus.OK)
  recordHealthConsent(
    // Lu pour sa seule validation : la route n'aboutit que si
    // healthDataConsent vaut true.
    @Body() _consent: HealthDataConsentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personalData.recordHealthDataConsent(user.sub);
  }

  @ApiOperation({ summary: 'Lister les athlètes que je coache' })
  @Roles(Role.COACH)
  @Get('me/athletes')
  listAthletes(@CurrentUser() user: JwtPayload) {
    return this.usersService.listAthletes(user.sub);
  }

  @ApiOperation({
    summary:
      'Détail d’un athlète de mon roster (infos + pointeur vers son plan)',
  })
  @Roles(Role.COACH)
  @Get('me/athletes/:athleteId')
  getAthlete(
    @CurrentUser() user: JwtPayload,
    @Param('athleteId') athleteId: string,
  ) {
    return this.usersService.getAthleteDetail(user.sub, athleteId);
  }

  @ApiOperation({ summary: 'Assigner un athlète existant à mon roster' })
  @Roles(Role.COACH)
  @Post('me/athletes')
  assignAthlete(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignAthleteDto,
  ) {
    return this.usersService.assignAthlete(user.sub, dto.athleteEmail);
  }

  @ApiOperation({ summary: 'Retirer un athlète de mon roster' })
  @Roles(Role.COACH)
  @Delete('me/athletes/:athleteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassignAthlete(
    @CurrentUser() user: JwtPayload,
    @Param('athleteId') athleteId: string,
  ) {
    return this.usersService.unassignAthlete(user.sub, athleteId);
  }

  @ApiOperation({
    summary: 'Modifier mon profil coach (age, description, spécialité)',
  })
  @Roles(Role.COACH)
  @Patch('me/coach-profile')
  updateMyCoachProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCoachProfileDto,
  ) {
    return this.usersService.updateMyCoachProfile(user.sub, dto);
  }

  @ApiOperation({
    summary:
      'Modifier mon profil athlète (âge, poids, taille, métabolisme basal, zones FC, spécialité)',
  })
  @Roles(Role.ATHLETE)
  @Patch('me/athlete-profile')
  updateMyAthleteProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateAthleteProfileDto,
  ) {
    return this.usersService.updateMyAthleteProfile(user.sub, dto);
  }

  @ApiOperation({ summary: 'Lister tous les coachs disponibles' })
  @Roles(Role.ATHLETE)
  @Get('coaches')
  listCoaches() {
    return this.usersService.listCoaches();
  }

  @ApiOperation({ summary: 'Récupérer les infos de mon coach actuel' })
  @Roles(Role.ATHLETE)
  @Get('me/coach')
  getMyCoach(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMyCoach(user.sub);
  }

  @ApiOperation({
    summary: 'Noter mon coach actuel (1 à 5, met à jour la moyenne du profil)',
  })
  @Roles(Role.ATHLETE)
  @Post('me/coach/rating')
  rateMyCoach(@CurrentUser() user: JwtPayload, @Body() dto: RateCoachDto) {
    return this.usersService.rateMyCoach(user.sub, dto.value);
  }

  @ApiOperation({ summary: 'Quitter mon coach actuel' })
  @Roles(Role.ATHLETE)
  @Delete('me/coach')
  @HttpCode(HttpStatus.NO_CONTENT)
  leaveCoach(@CurrentUser() user: JwtPayload) {
    return this.usersService.leaveCoach(user.sub);
  }
}
