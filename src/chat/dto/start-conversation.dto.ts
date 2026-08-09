import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartConversationDto {
  @ApiProperty({
    description:
      'ID du profil ciblé : CoachProfile (si envoyé par un athlète) ou AthleteProfile (si envoyé par un coach)',
  })
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @ApiProperty({ example: 'Bonjour, je cherche un coach pour un marathon.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}
