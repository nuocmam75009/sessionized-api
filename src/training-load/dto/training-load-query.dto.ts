import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

// Même exigence que HrZonesQueryDto : `@IsISO8601()` seul accepte aussi une
// date seule ("2026-08-23"), cette regex impose un datetime complet avec heure
// ET offset pour retrouver l'absence d'ambiguïté de fuseau.
const ISO_DATETIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DATETIME_MESSAGE =
  'doit être un datetime ISO 8601 complet avec heure et offset, ex. 2026-08-24T00:00:00+02:00';

export class TrainingLoadQueryDto {
  @ApiPropertyOptional({
    description:
      'Début de la fenêtre affichée (incluse). Par défaut 90 jours avant `to`. Sans effet sur le calcul, qui part toujours de la première activité connue.',
    example: '2026-06-01T00:00:00+02:00',
  })
  @IsOptional()
  @IsISO8601()
  @Matches(ISO_DATETIME_WITH_OFFSET, { message: `from ${DATETIME_MESSAGE}` })
  from?: string;

  @ApiPropertyOptional({
    description: 'Fin de la fenêtre (incluse). Par défaut maintenant.',
    example: '2026-09-18T23:59:59+02:00',
  })
  @IsOptional()
  @IsISO8601()
  @Matches(ISO_DATETIME_WITH_OFFSET, { message: `to ${DATETIME_MESSAGE}` })
  to?: string;

  @ApiPropertyOptional({
    description: 'Coach uniquement : calculer pour un athlète précis',
  })
  @IsOptional()
  @IsString()
  athleteId?: string;
}
