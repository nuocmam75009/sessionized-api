import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const PREFIX = 'enc:v1:';

// Le token stocké ne se déchiffre pas avec la clé actuelle : clé changée
// depuis son enregistrement, ou valeur altérée. À distinguer d'une clé absente
// ou mal formée, erreur de configuration du serveur que l'athlète ne peut pas
// réparer en se reconnectant.
export class StravaTokenDecryptionError extends Error {}

// Chiffre les tokens Strava au repos (AES-256-GCM, IV aléatoire par valeur) :
// une fuite de la base ne donne pas accès aux comptes Strava des athlètes.
// Format stocké : "enc:v1:<iv>:<authTag>:<ciphertext>" (base64).
@Injectable()
export class StravaTokenCipher {
  constructor(private readonly configService: ConfigService) {}

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return (
      PREFIX +
      [iv, cipher.getAuthTag(), ciphertext]
        .map((part) => part.toString('base64'))
        .join(':')
    );
  }

  decrypt(stored: string): string {
    // Tokens enregistrés avant le chiffrement : lus tels quels, puis
    // rechiffrés au prochain rafraîchissement.
    if (!stored.startsWith(PREFIX)) {
      return stored;
    }

    const [iv, authTag, ciphertext] = stored
      .slice(PREFIX.length)
      .split(':')
      .map((part) => Buffer.from(part, 'base64'));
    // Hors du try : une clé absente ou mal formée doit remonter comme telle,
    // et non se faire passer pour un token corrompu.
    const key = this.key();
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new StravaTokenDecryptionError(
        'Déchiffrement du token Strava impossible : STRAVA_TOKEN_ENCRYPTION_KEY a changé ou le token est corrompu',
      );
    }
  }

  private key(): Buffer {
    const key = Buffer.from(
      this.configService.getOrThrow<string>('STRAVA_TOKEN_ENCRYPTION_KEY'),
      'base64',
    );
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `STRAVA_TOKEN_ENCRYPTION_KEY doit faire ${KEY_BYTES} octets (base64)`,
      );
    }
    return key;
  }
}
