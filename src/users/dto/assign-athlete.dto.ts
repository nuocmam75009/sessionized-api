import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class AssignAthleteDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @IsEmail()
  athleteEmail: string;
}
