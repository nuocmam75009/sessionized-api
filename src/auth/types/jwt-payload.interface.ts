import { Role } from '../../../generated/prisma/enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

// Le même secret signe aussi le `state` OAuth Strava : on vérifie qu'un JWT
// valide est bien un token d'accès avant de l'accepter comme identité.
export function isAccessTokenPayload(payload: unknown): payload is JwtPayload {
  const candidate = payload as Partial<JwtPayload> | null;
  return (
    typeof candidate?.sub === 'string' &&
    typeof candidate.email === 'string' &&
    Object.values(Role).includes(candidate.role as Role)
  );
}
