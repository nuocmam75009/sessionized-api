import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

// Corps explicite plutôt qu'un POST vide : un consentement est un acte, pas
// l'effet de bord d'une requête envoyée par erreur.
export class HealthDataConsentDto {
  @ApiProperty({ example: true })
  @Equals(true, {
    message:
      'Le consentement au traitement des données de santé doit valoir true',
  })
  healthDataConsent: boolean;
}
