import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ChatGateway } from './chat.gateway';
import { Role } from '../../generated/prisma/enums';

const participantSelect = {
  athlete: {
    select: {
      id: true,
      userId: true,
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  },
  coach: {
    select: {
      id: true,
      userId: true,
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  },
} as const;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        OR: [{ athlete: { userId } }, { coach: { userId } }],
      },
      include: {
        ...participantSelect,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async listMessages(
    userId: string,
    conversationId: string,
    cursor?: string,
    limit = 30,
  ) {
    await this.getConversationForParticipant(userId, conversationId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    return messages.reverse();
  }

  /**
   * L'athlète peut démarrer une conversation avec n'importe quel coach
   * (marketplace) — la demande de contact EST le premier message.
   */
  async startConversationAsAthlete(
    athleteUserId: string,
    coachId: string,
    content: string,
  ) {
    const athlete = await this.usersService.getAthleteProfile(athleteUserId);
    if (!athlete) {
      throw new ForbiddenException('Profil athlète introuvable');
    }

    const coach = await this.prisma.coachProfile.findUnique({
      where: { id: coachId },
    });
    if (!coach) {
      throw new NotFoundException('Coach introuvable');
    }

    return this.createConversationAndMessage(
      athlete.id,
      coach.id,
      athleteUserId,
      content,
    );
  }

  /**
   * Le coach ne peut démarrer une conversation qu'avec un athlète
   * qu'il coache déjà (roster) — pas de démarchage à froid.
   */
  async startConversationAsCoach(
    coachUserId: string,
    athleteId: string,
    content: string,
  ) {
    const coach = await this.usersService.getCoachProfile(coachUserId);
    if (!coach) {
      throw new ForbiddenException('Profil coach introuvable');
    }

    const athlete = await this.prisma.athleteProfile.findUnique({
      where: { id: athleteId },
    });
    if (!athlete) {
      throw new NotFoundException('Athlète introuvable');
    }
    if (athlete.coachId !== coach.id) {
      throw new ForbiddenException("Cet athlète n'est pas coaché par vous");
    }

    return this.createConversationAndMessage(
      athlete.id,
      coach.id,
      coachUserId,
      content,
    );
  }

  private async createConversationAndMessage(
    athleteId: string,
    coachId: string,
    senderUserId: string,
    content: string,
  ) {
    const conversation = await this.prisma.conversation.upsert({
      where: { athleteId_coachId: { athleteId, coachId } },
      create: { athleteId, coachId },
      update: {},
      include: participantSelect,
    });

    const message = await this.persistMessage(
      conversation.id,
      senderUserId,
      content,
    );
    conversation.lastMessageAt = message.createdAt;

    this.broadcast(conversation, message);
    return { conversation, message };
  }

  async sendMessage(
    userId: string,
    role: Role,
    conversationId: string,
    content: string,
  ) {
    const conversation = await this.getConversationForParticipant(
      userId,
      conversationId,
      role,
    );

    const message = await this.persistMessage(conversation.id, userId, content);
    this.broadcast(conversation, message);
    return message;
  }

  async markAsRead(userId: string, conversationId: string) {
    const conversation = await this.getConversationForParticipant(
      userId,
      conversationId,
    );

    const { count } = await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });

    if (count > 0) {
      this.chatGateway.broadcastToUsers(
        [conversation.athlete.userId, conversation.coach.userId],
        'message:read',
        { conversationId, readerId: userId, readAt: new Date() },
      );
    }

    return { count };
  }

  /** Destinataire d'un événement « typing » : l'autre participant de la conversation. */
  async getOtherParticipantUserId(userId: string, conversationId: string) {
    const conversation = await this.getConversationForParticipant(
      userId,
      conversationId,
    );
    return conversation.athlete.userId === userId
      ? conversation.coach.userId
      : conversation.athlete.userId;
  }

  private async persistMessage(
    conversationId: string,
    senderId: string,
    content: string,
  ) {
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId, content },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    this.logger.log(
      `Message envoyé : conversation=${conversationId}, sender=${senderId}`,
    );

    return message;
  }

  private broadcast(
    conversation: {
      id: string;
      athlete: { userId: string };
      coach: { userId: string };
    },
    message: { id: string },
  ) {
    this.chatGateway.broadcastToUsers(
      [conversation.athlete.userId, conversation.coach.userId],
      'message:new',
      message,
    );
    this.chatGateway.broadcastToUsers(
      [conversation.athlete.userId, conversation.coach.userId],
      'conversation:updated',
      { conversationId: conversation.id },
    );
  }

  private async getConversationForParticipant(
    userId: string,
    conversationId: string,
    role?: Role,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: participantSelect,
    });
    if (!conversation) {
      throw new NotFoundException('Conversation introuvable');
    }

    const isAthlete = conversation.athlete.userId === userId;
    const isCoach = conversation.coach.userId === userId;
    if (!isAthlete && !isCoach) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }
    if (role === Role.ATHLETE && !isAthlete) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }
    if (role === Role.COACH && !isCoach) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    return conversation;
  }
}
