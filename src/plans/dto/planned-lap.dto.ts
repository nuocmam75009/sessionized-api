import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class PlannedLapDto {
  @ApiProperty({ example: 0, description: 'Position du lap dans la séance' })
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
}
