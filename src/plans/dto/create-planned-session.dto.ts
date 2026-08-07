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
  @IsString()
  @IsNotEmpty()
  athleteId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsDateString()
  scheduledDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PlannedLapDto)
  plannedLaps: PlannedLapDto[];
}
