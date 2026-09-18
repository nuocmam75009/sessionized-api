import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TrainingLoadService } from './training-load.service';
import { TrainingLoadQueryDto } from './dto/training-load-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';

@ApiTags('training-load')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('training-load')
export class TrainingLoadController {
  constructor(private readonly trainingLoadService: TrainingLoadService) {}

  @ApiOperation({
    summary: 'Condition (CTL), fatigue (ATL) et fraîcheur (TSB) jour par jour',
    description:
      'Valeurs estimées à partir du temps passé dans chaque zone FC, à défaut du ressenti déclaré sur la séance, à défaut de sa seule durée — `sourceCounts` dit dans quelle proportion. À ne pas présenter comme une mesure.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', example: '2026-09-18' },
              load: { type: 'number' },
              ctl: { type: 'number' },
              atl: { type: 'number' },
              tsb: { type: 'number' },
              settled: { type: 'boolean' },
            },
          },
        },
        current: { type: 'object' },
        weeklyLoad: { type: 'number' },
        rampRate: { type: 'number' },
        sourceCounts: { type: 'object' },
        activityCount: { type: 'number' },
      },
    },
  })
  @Get()
  getSeries(
    @CurrentUser() user: JwtPayload,
    @Query() query: TrainingLoadQueryDto,
  ) {
    return this.trainingLoadService.getSeries(user.sub, user.role, query);
  }
}
