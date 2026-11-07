import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Role } from '../../../generated/prisma/enums';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';
import { IsCompliantPassword } from '../decorators/is-compliant-password.decorator';
import { PASSWORD_MAX_LENGTH } from '../password-policy';

export class RegisterDto {
  @ApiProperty({ example: 'athlete@example.com' })
  @NormalizeEmail()
  @IsEmail()
  email: string;

  // Politique de la CNIL, cas n° 2 (voir password-policy.ts). bcrypt ignore
  // tout ce qui dépasse 72 octets : au-delà, deux mots de passe différents
  // partageant le même début seraient acceptés indifféremment.
  @ApiProperty({
    example: 'Course-matinale-2026',
    maxLength: PASSWORD_MAX_LENGTH,
    description:
      "Au moins 8 caractères mêlant 3 types parmi majuscules, minuscules, chiffres et caractères spéciaux, ou une phrase d'au moins 5 mots, ou au moins 16 chiffres (recommandation CNIL n° 2022-100, cas n° 2). Refusé s'il est courant ou prévisible, ou s'il contient le nom, l'adresse e-mail ou le nom du service.",
  })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @IsCompliantPassword()
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

  // Fréquence cardiaque, poids, séances : des données de santé (art. 9 du
  // RGPD), traitées sur la base d'un consentement explicite. Sans lui, pas de
  // compte athlète. Un coach n'en confie pas sur lui-même : champ ignoré.
  @ApiPropertyOptional({
    example: true,
    description:
      'Obligatoire et égal à true pour un compte ATHLETE : consentement explicite au traitement de ses données de santé, horodaté en base (healthDataConsentAt).',
  })
  @ValidateIf((dto: RegisterDto) => dto.role === Role.ATHLETE)
  @Equals(true, {
    message:
      'Le consentement au traitement des données de santé est requis pour créer un compte athlète',
  })
  healthDataConsent?: boolean;
}
