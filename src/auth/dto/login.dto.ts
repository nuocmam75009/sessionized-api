import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class LoginDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  password: string;
}
