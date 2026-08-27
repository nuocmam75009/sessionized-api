import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RaceDaysService } from './race-days.service';
import { CreateRaceDayDto } from './dto/create-race-day.dto';
import { UpdateRaceDayDto } from './dto/update-race-day.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@ApiTags('race-days')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('race-days')
export class RaceDaysController {
  constructor(private readonly raceDaysService: RaceDaysService) {}

  @ApiOperation({
    summary:
      'Ajouter une course (titre + date) à un de mes plans actifs — un plan peut en contenir autant que nécessaire',
  })
  @Roles(Role.COACH)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRaceDayDto) {
    return this.raceDaysService.create(user.sub, dto);
  }

  @ApiOperation({ summary: 'Modifier le titre ou la date d’une course' })
  @Roles(Role.COACH)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRaceDayDto,
  ) {
    return this.raceDaysService.update(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'Supprimer une course' })
  @Roles(Role.COACH)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.raceDaysService.remove(user.sub, id);
  }
}
