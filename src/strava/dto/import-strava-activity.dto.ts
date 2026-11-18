import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ImportStravaActivityDto {
  @ApiPropertyOptional({
    description: 'Lie cette activité à un workout existant',
  })
  @IsOptional()
  @IsString()
  workoutId?: string;

  @ApiPropertyOptional({
    description: "Note libre de l'athlète sur le ressenti de la séance",
    example: 'Jambes lourdes sur la fin, mais bonnes sensations globales',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  athleteNote?: string;

  @ApiPropertyOptional({
    description:
      'Difficulté ressentie, sur une échelle de 1 (facile) à 10 (max)',
    example: 7,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  difficultyNote?: number;

  @ApiPropertyOptional({
    description:
      'Séance de qualité, à comparer avec les autres. Par défaut : true si le workout lié est marqué training ou si Strava libelle l’activité « Workout », false sinon',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  training?: boolean;
}
