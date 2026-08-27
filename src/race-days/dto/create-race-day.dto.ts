import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateRaceDayDto {
  @ApiProperty({ description: 'ID du Plan ciblé' })
  @IsString()
  @IsNotEmpty()
  planId: string;

  @ApiProperty({ example: 'Marathon de Paris' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: '2027-04-11T07:00:00.000Z' })
  @IsDateString()
  date: string;
}
