import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateCoachProfileDto {
  @ApiPropertyOptional({ example: 32 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(100)
  age?: number;

  @ApiPropertyOptional({
    example: 'Coach spécialisé en trail et ultra-distance.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'Trail running' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  specialty?: string;
}
