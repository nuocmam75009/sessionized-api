import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../../auth/password-policy';

// Le mot de passe est redemandé : un jeton volé, ou une session laissée
// ouverte sur un poste partagé, ne suffit pas à effacer un compte.
export class DeleteAccountDto {
  @ApiProperty({ example: 'Course-matinale-2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
