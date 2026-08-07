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
import { CreatePlannedSessionDto } from './dto/create-planned-session.dto';
import { UpdatePlannedSessionDto } from './dto/update-planned-session.dto';
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
    summary: 'Créer une séance planifiée pour un de mes athlètes',
  })
  @Roles(Role.COACH)
  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePlannedSessionDto,
  ) {
    return this.plansService.create(user.sub, dto);
  }

  @ApiOperation({
    summary:
      'Lister les séances planifiées (les miennes en tant que coach, ou les siennes en tant qu’athlète)',
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

  @ApiOperation({ summary: 'Récupérer une séance planifiée' })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.plansService.findOne(user.sub, user.role, id);
  }

  @ApiOperation({ summary: 'Modifier une séance planifiée' })
  @Roles(Role.COACH)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlannedSessionDto,
  ) {
    return this.plansService.update(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'Supprimer une séance planifiée' })
  @Roles(Role.COACH)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.plansService.remove(user.sub, id);
  }
}
