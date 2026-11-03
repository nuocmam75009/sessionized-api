import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Payloads des événements WebSocket du chat : mêmes règles que les DTO REST,
// le ValidationPipe global ne s'appliquant pas aux gateways.

export class WsConversationRefDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;
}

export class WsSendMessageDto extends WsConversationRefDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;
}

export class WsTypingDto extends WsConversationRefDto {
  @IsBoolean()
  isTyping: boolean;
}
