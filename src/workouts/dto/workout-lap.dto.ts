import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { HeartRateZone } from '../../../generated/prisma/enums';

export class WorkoutLapDto {
  @ApiProperty({ example: 0, description: 'Position du lap dans le workout' })
  @IsInt()
  @Min(0)
  index: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDistanceM?: number;

  @ApiPropertyOptional({
    example: 240,
    description: 'Allure cible en secondes par km',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPaceSecPerKm?: number;

  @ApiPropertyOptional({ example: 300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDurationSec?: number;

  @ApiPropertyOptional({ enum: HeartRateZone, example: HeartRateZone.Z3 })
  @IsOptional()
  @IsEnum(HeartRateZone)
  targetHeartRateZone?: HeartRateZone;
}
