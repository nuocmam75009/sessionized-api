import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { translatePrismaError } from './prisma-exception.filter';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`athleteId`,`fileHash`)',
    { code, clientVersion: 'test' },
  );

describe('translatePrismaError', () => {
  it('P2002 (unicité) → 409, sans nommer table ni colonnes', () => {
    const error = translatePrismaError(prismaError('P2002'));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error?.message).toBe('Cette ressource existe déjà');
    expect(error?.message).not.toContain('fileHash');
  });

  it('P2025 (introuvable) → 404', () => {
    expect(translatePrismaError(prismaError('P2025'))).toBeInstanceOf(
      NotFoundException,
    );
  });

  it('autre code → non traduit, reste une 500', () => {
    expect(translatePrismaError(prismaError('P1001'))).toBeNull();
  });
});
