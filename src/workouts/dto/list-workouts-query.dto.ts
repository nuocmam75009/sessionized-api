import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ToBoolean } from '../../common/transforms/to-boolean.transform';

export class ListWorkoutsQueryDto {
  @ApiPropertyOptional({
    description: 'Coach uniquement : filtrer sur un athlète précis',
  })
  @IsOptional()
  @IsString()
  athleteId?: string;

  @ApiPropertyOptional({
    description:
      'true : seulement les séances de qualité, false : seulement les autres. Absent : toutes',
    example: true,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  training?: boolean;
}
