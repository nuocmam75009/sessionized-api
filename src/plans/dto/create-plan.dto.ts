import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ description: 'ID du profil AthleteProfile ciblé' })
  @IsString()
  @IsNotEmpty()
  athleteId: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-12-14T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'Marathon de Paris sous les 3h30' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  objective1?: string;

  @ApiPropertyOptional({ example: "Aucune blessure d'ici la course" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  objective2?: string;
}
