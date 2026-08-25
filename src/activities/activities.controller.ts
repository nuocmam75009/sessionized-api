import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { UploadActivityDto } from './dto/upload-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

const MAX_FIT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_GPX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

@ApiTags('activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @ApiOperation({ summary: 'Uploader un fichier .fit et parser l’activité' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        workoutId: { type: 'string' },
        athleteNote: { type: 'string' },
        difficultyNote: { type: 'number', minimum: 1, maximum: 10 },
      },
    },
  })
  @Roles(Role.ATHLETE)
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FIT_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.fit')) {
          callback(
            new BadRequestException('Seuls les fichiers .fit sont acceptés'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadActivityDto,
  ) {
    return this.activitiesService.upload(user.sub, file, dto);
  }

  @ApiOperation({
    summary:
      'Lister les activités (les miennes en tant qu’athlète, ou celles de mes athlètes en tant que coach)',
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
    return this.activitiesService.findAll(user.sub, user.role, athleteId);
  }

  @ApiOperation({ summary: 'Récupérer une activité et ses laps' })
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.activitiesService.findOne(user.sub, user.role, id);
  }

  @ApiOperation({
    summary:
      'Récupérer la trace GPS complète (points seconde par seconde) — à charger séparément pour ne pas alourdir GET /activities/:id',
  })
  @Get(':id/track')
  getTrack(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.activitiesService.getTrack(user.sub, user.role, id);
  }

  @ApiOperation({
    summary:
      'Uploader un fichier .gpx pour le tracé carte d’une activité existante (complémentaire au .fit : laps/physio restent sur le .fit)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Roles(Role.ATHLETE)
  @Post(':id/gpx')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_GPX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.gpx')) {
          callback(
            new BadRequestException('Seuls les fichiers .gpx sont acceptés'),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadGpx(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.activitiesService.uploadGpx(user.sub, id, file);
  }

  @ApiOperation({
    summary:
      'Récupérer le tracé importé via .gpx (pour affichage carte) — à charger séparément',
  })
  @Get(':id/route')
  getRoute(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.activitiesService.getRoute(user.sub, user.role, id);
  }

  @ApiOperation({
    summary: 'Télécharger le fichier .fit original de cette activité',
  })
  @Get(':id/fit-file')
  @Header('Content-Type', 'application/octet-stream')
  async getFitFile(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.activitiesService.getFitFile(
      user.sub,
      user.role,
      id,
    );
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }

  @ApiOperation({
    summary: 'Télécharger le fichier .gpx original de cette activité',
  })
  @Get(':id/gpx-file')
  @Header('Content-Type', 'application/gpx+xml')
  async getGpxFile(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, filename } = await this.activitiesService.getGpxFile(
      user.sub,
      user.role,
      id,
    );
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
  }

  @ApiOperation({
    summary: 'Modifier ma note/difficulté ressentie sur une activité',
  })
  @Roles(Role.ATHLETE)
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'Supprimer une de mes activités' })
  @Roles(Role.ATHLETE)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.activitiesService.remove(user.sub, id);
  }
}
