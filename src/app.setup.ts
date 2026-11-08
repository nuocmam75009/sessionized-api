import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { parseCorsOrigins } from './config/env.validation';

/**
 * Swagger expose toute la surface de l'API (routes, paramètres, schémas) :
 * masqué par défaut en production, `SWAGGER_ENABLED` force l'un ou l'autre.
 */
export function isSwaggerEnabled(
  nodeEnv: string | undefined,
  swaggerEnabled: string | undefined,
): boolean {
  return swaggerEnabled ? swaggerEnabled === 'true' : nodeEnv !== 'production';
}

/**
 * Configuration HTTP de l'application, partagée par le serveur (main.ts) et
 * les tests e2e : les tests de sécurité vérifient ainsi les en-têtes, le CORS
 * et la validation réellement servis en production, pas une copie.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV');
  const isProduction = nodeEnv === 'production';

  // Derrière le reverse proxy de l'hébergeur, req.ip vaut sinon l'IP du proxy :
  // le rate limiting compterait alors tous les utilisateurs comme un seul client.
  const trustProxy = config.get<string>('TRUST_PROXY');
  app.set(
    'trust proxy',
    trustProxy ? Number(trustProxy) : isProduction ? 1 : 0,
  );

  app.use(
    helmet({
      // API consommée par des frontends sur d'autres domaines : on autorise le
      // chargement cross-origin des réponses (fichiers .fit/.gpx notamment).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // En dev (http://localhost), ne pas forcer le HTTPS sur les assets de Swagger UI.
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: isProduction ? [] : null },
      },
    }),
  );

  const corsOrigins = parseCorsOrigins(config.get<string>('CORS_ORIGINS'));
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  if (isSwaggerEnabled(nodeEnv, config.get<string>('SWAGGER_ENABLED'))) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Sessionized API')
        .setDescription(
          "Backend NestJS de la plateforme Sessionized — coaching sportif, import et analyse de séances (.fit, Strava), charge d'entraînement.",
        )
        .setVersion('0.0.1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
