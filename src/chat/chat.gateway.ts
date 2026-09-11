import {
  BadRequestException,
  HttpException,
  Inject,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import {
  WsConversationRefDto,
  WsSendMessageDto,
  WsTypingDto,
} from './dto/ws-events.dto';
import {
  isAccessTokenPayload,
  type JwtPayload,
} from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

interface AuthenticatedSocket extends Socket {
  data: { user?: JwtPayload };
}

// CORS configuré globalement par CorsIoAdapter (cf. main.ts).
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwtService.verifyAsync<object>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
      if (!isAccessTokenPayload(payload)) {
        throw new Error("Le token n'est pas un token d'accès");
      }
      client.data.user = payload;
      await client.join(`user:${payload.sub}`);
      this.logger.log(`Client connecté : user=${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Authentification invalide' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.data.user) {
      this.logger.log(`Client déconnecté : user=${client.data.user.sub}`);
    }
  }

  @SubscribeMessage('conversation:start')
  async handleStartConversation(client: AuthenticatedSocket, raw: unknown) {
    const user = client.data.user;
    if (!user) return;

    try {
      const payload = await this.parse(StartConversationDto, raw);
      const result =
        user.role === Role.ATHLETE
          ? await this.chatService.startConversationAsAthlete(
              user.sub,
              payload.targetId,
              payload.content,
            )
          : await this.chatService.startConversationAsCoach(
              user.sub,
              payload.targetId,
              payload.content,
            );
      client.emit('conversation:started', result);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(client: AuthenticatedSocket, raw: unknown) {
    const user = client.data.user;
    if (!user) return;

    try {
      const payload = await this.parse(WsSendMessageDto, raw);
      await this.chatService.sendMessage(
        user.sub,
        user.role,
        payload.conversationId,
        payload.content,
      );
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage('conversation:read')
  async handleRead(client: AuthenticatedSocket, raw: unknown) {
    const user = client.data.user;
    if (!user) return;

    try {
      const payload = await this.parse(WsConversationRefDto, raw);
      await this.chatService.markAsRead(user.sub, payload.conversationId);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  // Le destinataire est déduit de la conversation (dont l'émetteur doit être
  // participant) : un `recipientUserId` éventuellement envoyé par le client est
  // ignoré, pour qu'on ne puisse pas notifier un utilisateur arbitraire.
  @SubscribeMessage('typing')
  async handleTyping(client: AuthenticatedSocket, raw: unknown) {
    const user = client.data.user;
    if (!user) return;

    try {
      const payload = await this.parse(WsTypingDto, raw);
      const recipientUserId = await this.chatService.getOtherParticipantUserId(
        user.sub,
        payload.conversationId,
      );
      this.server.to(`user:${recipientUserId}`).emit('typing', {
        conversationId: payload.conversationId,
        userId: user.sub,
        isTyping: payload.isTyping,
      });
    } catch (error) {
      this.emitError(client, error);
    }
  }

  broadcastToUsers(userIds: string[], event: string, payload: unknown) {
    const rooms = [...new Set(userIds)].map((id) => `user:${id}`);
    this.server.to(rooms).emit(event, payload);
  }

  // Le ValidationPipe global ne s'applique pas aux gateways : on valide chaque
  // payload avec les mêmes règles class-validator que l'API REST.
  private async parse<T extends object>(
    dto: ClassConstructor<T>,
    raw: unknown,
  ): Promise<T> {
    const payload = plainToInstance(
      dto,
      typeof raw === 'object' && raw !== null ? raw : {},
    );
    const errors = await validate(payload, { whitelist: true });
    if (errors.length > 0) {
      const [firstMessage] = Object.values(errors[0].constraints ?? {});
      throw new BadRequestException(firstMessage ?? 'Payload invalide');
    }
    return payload;
  }

  // Seules les erreurs métier (HttpException) sont renvoyées telles quelles au
  // client : les autres peuvent contenir des détails internes (Prisma…).
  private emitError(client: AuthenticatedSocket, error: unknown) {
    if (error instanceof HttpException) {
      client.emit('error', { message: error.message });
      return;
    }
    this.logger.error(
      `Erreur WebSocket (user=${client.data.user?.sub}) : ${String(error)}`,
    );
    client.emit('error', { message: 'Erreur interne' });
  }

  private extractToken(client: Socket): string {
    const fromAuth = client.handshake.auth?.token as string | undefined;
    if (fromAuth) return fromAuth;

    const authHeader = client.handshake.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice('Bearer '.length);
    }

    throw new Error('Token manquant');
  }
}
