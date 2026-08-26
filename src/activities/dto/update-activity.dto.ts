import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateActivityDto {
  @ApiPropertyOptional({
    description: 'Lier cette activité au workout prescrit correspondant',
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
  @IsInt()
  @Min(1)
  @Max(10)
  difficultyNote?: number;
}
