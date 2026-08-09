import { Inject, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import type { JwtPayload } from '../auth/types/jwt-payload.interface';
import { Role } from '../../generated/prisma/enums';

interface AuthenticatedSocket extends Socket {
  data: { user?: JwtPayload };
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    credentials: true,
  },
})
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
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
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
  async handleStartConversation(
    client: AuthenticatedSocket,
    payload: { targetId: string; content: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    try {
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
      client.emit('error', { message: (error as Error).message });
    }
  }

  @SubscribeMessage('message:send')
  async handleSendMessage(
    client: AuthenticatedSocket,
    payload: { conversationId: string; content: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    try {
      await this.chatService.sendMessage(
        user.sub,
        user.role,
        payload.conversationId,
        payload.content,
      );
    } catch (error) {
      client.emit('error', { message: (error as Error).message });
    }
  }

  @SubscribeMessage('conversation:read')
  async handleRead(
    client: AuthenticatedSocket,
    payload: { conversationId: string },
  ) {
    const user = client.data.user;
    if (!user) return;

    try {
      await this.chatService.markAsRead(user.sub, payload.conversationId);
    } catch (error) {
      client.emit('error', { message: (error as Error).message });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    client: AuthenticatedSocket,
    payload: {
      conversationId: string;
      recipientUserId: string;
      isTyping: boolean;
    },
  ) {
    const user = client.data.user;
    if (!user) return;

    this.server.to(`user:${payload.recipientUserId}`).emit('typing', {
      conversationId: payload.conversationId,
      userId: user.sub,
      isTyping: payload.isTyping,
    });
  }

  broadcastToUsers(userIds: string[], event: string, payload: unknown) {
    const rooms = [...new Set(userIds)].map((id) => `user:${id}`);
    this.server.to(rooms).emit(event, payload);
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
