import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/enums';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class RegisterDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  // bcrypt ignore tout ce qui dépasse 72 octets : au-delà, deux mots de passe
  // différents partageant le même début seraient acceptés indifféremment.
  @ApiProperty({ example: 'password123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @ApiProperty({ enum: Role, example: Role.ATHLETE })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({ example: 'Jordan' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Reyes' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;
}
