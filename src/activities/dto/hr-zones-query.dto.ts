import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

// `@IsISO8601()` seul (même en `strict`) accepte aussi une date seule
// ("2026-08-23") ou "2026-08" : validator.js ne vérifie que la validité
// calendaire, pas la présence de l'heure. Cette regex impose un datetime
// complet avec heure ET offset (`Z` ou `+HH:mm`/`-HH:mm`), pour retrouver
// l'absence d'ambiguïté de fuseau voulue ici.
const ISO_DATETIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATETIME_MESSAGE =
  'doit être un datetime ISO 8601 complet avec heure et offset, ex. 2026-08-24T00:00:00+02:00';

export class HrZonesQueryDto {
  @ApiProperty({
    description:
      'Borne de début (incluse), datetime ISO 8601 avec offset — pas une date seule, pour éviter toute ambiguïté de fuseau côté serveur',
    example: '2026-08-24T00:00:00+02:00',
  })
  @IsISO8601()
  @Matches(ISO_DATETIME_WITH_OFFSET, { message: `from ${DATETIME_MESSAGE}` })
  from: string;

  @ApiProperty({
    description: 'Borne de fin (incluse), datetime ISO 8601 avec offset',
    example: '2026-08-30T23:59:59+02:00',
  })
  @IsISO8601()
  @Matches(ISO_DATETIME_WITH_OFFSET, { message: `to ${DATETIME_MESSAGE}` })
  to: string;

  @ApiPropertyOptional({
    description: 'Coach uniquement : calculer pour un athlète précis',
  })
  @IsOptional()
  @IsString()
  athleteId?: string;
}
