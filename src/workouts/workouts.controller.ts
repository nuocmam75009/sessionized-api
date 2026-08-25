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
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@ApiTags('workouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @ApiOperation({
    summary: 'Créer un workout pour un de mes athlètes (dans son plan)',
  })
  @Roles(Role.COACH)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateWorkoutDto) {
    return this.workoutsService.create(user.sub, dto);
  }

  @ApiOperation({
    summary:
      'Lister les workouts (les miens en tant que coach, ou les siens en tant qu’athlète)',
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
    return this.workoutsService.findAll(user.sub, user.role, athleteId);
  }

  @ApiOperation({ summary: 'Récupérer un workout' })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.workoutsService.findOne(user.sub, user.role, id);
  }

  @ApiOperation({ summary: 'Modifier un workout' })
  @Roles(Role.COACH)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWorkoutDto,
  ) {
    return this.workoutsService.update(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'Supprimer un workout' })
  @Roles(Role.COACH)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.workoutsService.remove(user.sub, id);
  }
}
