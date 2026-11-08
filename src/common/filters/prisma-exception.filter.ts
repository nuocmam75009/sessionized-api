import {
  ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../../../generated/prisma/client';

/**
 * Filet de sécurité pour les erreurs Prisma que le code métier n'a pas
 * traduites lui-même. Sans lui, une contrainte d'unicité violée ou un
 * enregistrement disparu entre deux requêtes donnent un 500, que le client
 * prend pour une panne et qu'il est tenté de renvoyer à l'identique.
 *
 * - P2002 (unicité) → 409 : la ressource existe déjà.
 * - P2025 (enregistrement introuvable) → 404 : supprimé entre-temps.
 *
 * Le message ne reprend jamais celui de Prisma, qui nomme tables et colonnes.
 * Les autres codes restent des 500 : ce sont de vraies anomalies.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const translated = translatePrismaError(error);
    if (translated) {
      this.logger.warn(
        `Erreur Prisma ${error.code} convertie en ${translated.getStatus()}`,
      );
    }
    super.catch(translated ?? error, host);
  }
}

export function translatePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): HttpException | null {
  switch (error.code) {
    case 'P2002':
      return new ConflictException('Cette ressource existe déjà');
    case 'P2025':
      return new NotFoundException('Ressource introuvable');
    default:
      return null;
  }
}
