import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRaceDayDto {
  @ApiPropertyOptional({ example: 'Marathon de Paris' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: '2027-04-11T07:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  date?: string;
}
