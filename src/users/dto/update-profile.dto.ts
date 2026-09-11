import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Lucas' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Debort' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @ApiPropertyOptional({ example: 'lucas.new@example.com' })
  @IsOptional()
  @NormalizeEmail()
  @IsEmail()
  email?: string;
}
