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

export class RegisterDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @MinLength(8)
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
