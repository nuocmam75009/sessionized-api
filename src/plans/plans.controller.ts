import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@ApiTags('plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @ApiOperation({
    summary:
      'Créer un nouveau plan pour un de mes athlètes (archive automatiquement son plan actif précédent)',
  })
  @Roles(Role.COACH)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePlanDto) {
    return this.plansService.create(user.sub, dto);
  }

  @ApiOperation({
    summary:
      'Lister les plans (coach : ceux que je gère, filtrables par athlète ; athlète : mon historique)',
  })
  @ApiQuery({
    name: 'athleteId',
    required: false,
    description: 'Coach uniquement : filtrer sur un athlète précis',
  })
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('athleteId') athleteId?: string,
  ) {
    return this.plansService.findAll(user.sub, user.role, athleteId);
  }

  @ApiOperation({ summary: 'Récupérer un plan avec tous ses workouts' })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.plansService.findOne(user.sub, user.role, id);
  }

  @ApiOperation({
    summary: 'Modifier un plan (dates, objectifs, statut)',
  })
  @Roles(Role.COACH)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plansService.update(user.sub, id, dto);
  }
}
