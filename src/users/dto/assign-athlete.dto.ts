import { IsEmail } from 'class-validator';

export class AssignAthleteDto {
  @IsEmail()
  athleteEmail: string;
}
