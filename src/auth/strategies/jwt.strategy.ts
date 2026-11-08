import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AccessTokenClaims,
  isAccessTokenPayload,
} from '../types/jwt-payload.interface';
import { TokenRevocationService } from '../token-revocation.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly revocation: TokenRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Appelée une fois la signature et l'expiration vérifiées par passport-jwt.
  async validate(payload: unknown): Promise<AccessTokenClaims> {
    if (!isAccessTokenPayload(payload)) {
      throw new UnauthorizedException();
    }
    if (await this.revocation.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Session terminée, reconnectez-vous');
    }
    return payload;
  }
}
