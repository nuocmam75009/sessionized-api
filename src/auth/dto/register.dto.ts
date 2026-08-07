import { IsEmail, IsEnum, MinLength } from 'class-validator';
import { Role } from '../../../generated/prisma/enums';

export class RegisterDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;

  @IsEnum(Role)
  role: Role;
}
