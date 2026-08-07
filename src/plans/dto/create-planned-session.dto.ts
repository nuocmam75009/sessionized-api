import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PlannedLapDto } from './planned-lap.dto';

export class CreatePlannedSessionDto {
  @ApiProperty({ description: 'ID du profil AthleteProfile ciblé' })
  @IsString()
  @IsNotEmpty()
  athleteId: string;

  @ApiProperty({ example: 'Séance seuil' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: '2026-08-10T07:00:00.000Z' })
  @IsDateString()
  scheduledDate: string;

  @ApiProperty({ type: [PlannedLapDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlannedLapDto)
  plannedLaps: PlannedLapDto[];
}
