import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'Comment tu te sens après la séance de hier ?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}
