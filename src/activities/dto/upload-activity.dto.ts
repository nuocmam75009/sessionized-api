import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadActivityDto {
  @ApiPropertyOptional({
    description: 'Lie cette activité à une séance planifiée existante',
  })
  @IsOptional()
  @IsString()
  plannedSessionId?: string;
}
