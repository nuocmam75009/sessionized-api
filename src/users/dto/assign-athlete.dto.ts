import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class AssignAthleteDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @NormalizeEmail()
  @IsEmail()
  athleteEmail: string;
}
