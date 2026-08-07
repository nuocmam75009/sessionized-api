import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PlannedLapDto } from './planned-lap.dto';

export class UpdatePlannedSessionDto {
  @ApiPropertyOptional({ example: 'Séance seuil (modifiée)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ example: '2026-08-10T07:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({
    type: [PlannedLapDto],
    description: 'Remplace intégralement les laps existants si fourni',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlannedLapDto)
  plannedLaps?: PlannedLapDto[];
}
