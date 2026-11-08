import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class LoginDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  // Pas de politique ici : les comptes créés avant elle doivent pouvoir se
  // connecter. Elle s'applique à la création du mot de passe.
  @ApiProperty({ example: 'Course-matinale-2026' })
  @IsString()
  password: string;
}
