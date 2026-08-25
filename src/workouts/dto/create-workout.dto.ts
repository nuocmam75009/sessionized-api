import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { WorkoutLapDto } from './workout-lap.dto';
import { HeartRateZone } from '../../../generated/prisma/enums';

export class CreateWorkoutDto {
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

  @ApiPropertyOptional({ example: 'Concentre-toi sur la régularité du rythme' })
  @IsOptional()
  @IsString()
  coachNote?: string;

  @ApiPropertyOptional({
    example: 10000,
    description: 'Distance cible globale du workout (mètres)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDistanceM?: number;

  @ApiPropertyOptional({
    example: 3600,
    description: 'Durée cible globale du workout (secondes)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDurationSec?: number;

  @ApiPropertyOptional({
    enum: HeartRateZone,
    example: HeartRateZone.Z2,
    description: 'Zone FC cible globale (si pas définie lap par lap)',
  })
  @IsOptional()
  @IsEnum(HeartRateZone)
  targetHeartRateZone?: HeartRateZone;

  @ApiProperty({ type: [WorkoutLapDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WorkoutLapDto)
  laps: WorkoutLapDto[];
}
