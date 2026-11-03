// Validation des variables d'environnement au démarrage (ConfigModule.validate) :
// une variable manquante ou invalide fait échouer le boot avec un message clair,
// plutôt qu'une erreur obscure au premier appel qui en dépend.

const DEV_CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3002'];
const MIN_PROD_JWT_SECRET_LENGTH = 32;
const ENCRYPTION_KEY_BYTES = 32;

export function isProduction(env: Record<string, unknown>): boolean {
  return env.NODE_ENV === 'production';
}

// CORS_ORIGINS="https://app.example.com,https://coach.example.com"
export function parseCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return DEV_CORS_ORIGINS;
  }
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];
  const prod = isProduction(config);
  const read = (key: string): string | undefined => {
    const value = config[key];
    return typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : undefined;
  };
  const requireVar = (key: string, reason = '') => {
    if (!read(key)) errors.push(`${key} est obligatoire${reason}`);
  };

  requireVar('DATABASE_URL');

  const jwtSecret = read('JWT_SECRET');
  if (!jwtSecret) {
    errors.push('JWT_SECRET est obligatoire');
  } else if (prod && jwtSecret.length < MIN_PROD_JWT_SECRET_LENGTH) {
    errors.push(
      `JWT_SECRET doit faire au moins ${MIN_PROD_JWT_SECRET_LENGTH} caractères en production`,
    );
  }

  const port = read('PORT');
  if (port && !/^\d+$/.test(port)) {
    errors.push('PORT doit être un nombre');
  }

  const trustProxy = read('TRUST_PROXY');
  if (trustProxy && !/^\d+$/.test(trustProxy)) {
    errors.push('TRUST_PROXY doit être un nombre de proxies (ex : 1)');
  }

  const swaggerEnabled = read('SWAGGER_ENABLED');
  if (swaggerEnabled && !['true', 'false'].includes(swaggerEnabled)) {
    errors.push('SWAGGER_ENABLED doit valoir true ou false');
  }

  const corsOrigins = read('CORS_ORIGINS');
  if (prod && !corsOrigins) {
    errors.push(
      'CORS_ORIGINS est obligatoire en production (URLs des frontends, séparées par des virgules)',
    );
  }
  for (const origin of corsOrigins ? parseCorsOrigins(corsOrigins) : []) {
    if (!URL.canParse(origin)) {
      errors.push(`CORS_ORIGINS contient une URL invalide : "${origin}"`);
    }
  }

  const encryptionKey = read('STRAVA_TOKEN_ENCRYPTION_KEY');
  if (
    encryptionKey &&
    Buffer.from(encryptionKey, 'base64').length !== ENCRYPTION_KEY_BYTES
  ) {
    errors.push(
      `STRAVA_TOKEN_ENCRYPTION_KEY doit être une clé de ${ENCRYPTION_KEY_BYTES} octets encodée en base64`,
    );
  }

  // Strava reste optionnel : si l'intégration est activée en production, toute
  // sa configuration doit l'être aussi.
  if (prod && read('STRAVA_CLIENT_ID')) {
    const reason = ' quand STRAVA_CLIENT_ID est défini';
    requireVar('STRAVA_CLIENT_SECRET', reason);
    requireVar('STRAVA_REDIRECT_URI', reason);
    requireVar('STRAVA_TOKEN_ENCRYPTION_KEY', reason);
    requireVar('ATHLETE_APP_URL', reason);
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuration invalide :\n- ${errors.join('\n- ')}\nVoir .env.example.`,
    );
  }

  return config;
}
