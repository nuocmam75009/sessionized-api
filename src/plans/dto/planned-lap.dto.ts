import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class PlannedLapDto {
  @IsInt()
  @Min(0)
  index: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDistanceM?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPaceSecPerKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetDurationSec?: number;
}
