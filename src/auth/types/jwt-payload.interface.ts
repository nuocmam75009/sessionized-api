import { Role } from '../../../generated/prisma/enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

/**
 * Revendications d'un jeton d'accès décodé : l'identité, plus son identifiant
 * unique (`jti`, pour la révocation) et son expiration (`exp`, en secondes).
 */
export interface AccessTokenClaims extends JwtPayload {
  jti: string;
  exp: number;
}

// Le même secret signe aussi le `state` OAuth Strava : on vérifie qu'un JWT
// valide est bien un token d'accès avant de l'accepter comme identité. Le
// `jti` est exigé : un jeton sans identifiant ne pourrait pas être révoqué.
export function isAccessTokenPayload(
  payload: unknown,
): payload is AccessTokenClaims {
  const candidate = payload as Partial<AccessTokenClaims> | null;
  return (
    typeof candidate?.sub === 'string' &&
    typeof candidate.email === 'string' &&
    Object.values(Role).includes(candidate.role as Role) &&
    typeof candidate.jti === 'string' &&
    typeof candidate.exp === 'number'
  );
}
