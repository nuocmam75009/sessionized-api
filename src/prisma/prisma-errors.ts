import { Prisma } from '../../generated/prisma/client';

/**
 * Violation d'une contrainte d'unicité (P2002). C'est la base, et non un
 * `findUnique` préalable, qui garantit l'unicité : deux requêtes simultanées
 * passent toutes deux la vérification applicative, seule la contrainte
 * départage. Le code appelant doit donc traiter ce cas comme un conflit
 * métier, pas comme une panne.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
