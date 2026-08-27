import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { AthleteSpecialty } from '../../../generated/prisma/enums';

export class UpdateAthleteProfileDto {
  @ApiPropertyOptional({ example: 28 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(100)
  age?: number;

  @ApiPropertyOptional({ example: 68.5, description: 'Poids en kilogrammes' })
  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(300)
  weightKg?: number;

  @ApiPropertyOptional({ example: 178, description: 'Taille en centimètres' })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(250)
  heightCm?: number;

  @ApiPropertyOptional({
    example: 1650,
    description: 'Métabolisme basal en kcal/jour',
  })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(5000)
  basalMetabolicRateKcal?: number;

  @ApiPropertyOptional({
    enum: AthleteSpecialty,
    example: AthleteSpecialty.TRAIL,
  })
  @IsOptional()
  @IsEnum(AthleteSpecialty)
  specialty?: AthleteSpecialty;

}
