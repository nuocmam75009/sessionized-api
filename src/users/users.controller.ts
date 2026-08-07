import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AssignAthleteDto } from './dto/assign-athlete.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Roles(Role.COACH)
  @Get('me/athletes')
  listAthletes(@CurrentUser() user: JwtPayload) {
    return this.usersService.listAthletes(user.sub);
  }

  @Roles(Role.COACH)
  @Post('me/athletes')
  assignAthlete(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignAthleteDto,
  ) {
    return this.usersService.assignAthlete(user.sub, dto.athleteEmail);
  }

  @Roles(Role.COACH)
  @Delete('me/athletes/:athleteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassignAthlete(
    @CurrentUser() user: JwtPayload,
    @Param('athleteId') athleteId: string,
  ) {
    return this.usersService.unassignAthlete(user.sub, athleteId);
  }

  @Roles(Role.ATHLETE)
  @Delete('me/coach')
  @HttpCode(HttpStatus.NO_CONTENT)
  leaveCoach(@CurrentUser() user: JwtPayload) {
    return this.usersService.leaveCoach(user.sub);
  }
}
