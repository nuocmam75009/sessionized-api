import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({
    summary:
      'Démarrer une conversation (athlète → n’importe quel coach de la marketplace, ou coach → un athlète de son roster)',
  })
  @Post('conversations')
  startConversation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: StartConversationDto,
  ) {
    if (user.role === Role.ATHLETE) {
      return this.chatService.startConversationAsAthlete(
        user.sub,
        dto.targetId,
        dto.content,
      );
    }
    return this.chatService.startConversationAsCoach(
      user.sub,
      dto.targetId,
      dto.content,
    );
  }

  @ApiOperation({ summary: 'Lister mes conversations' })
  @Get('conversations')
  listConversations(@CurrentUser() user: JwtPayload) {
    return this.chatService.listConversations(user.sub);
  }

  @ApiOperation({ summary: "Lister les messages d'une conversation" })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.listMessages(
      user.sub,
      id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @ApiOperation({
    summary: 'Envoyer un message dans une conversation existante',
  })
  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user.sub, user.role, id, dto.content);
  }

  @ApiOperation({
    summary: "Marquer les messages d'une conversation comme lus",
  })
  @Patch('conversations/:id/read')
  markAsRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.chatService.markAsRead(user.sub, id);
  }
}
