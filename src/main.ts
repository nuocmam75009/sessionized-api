import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { CorsIoAdapter } from './common/adapters/cors-io.adapter';
import { parseCorsOrigins } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

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
  app.useWebSocketAdapter(new CorsIoAdapter(app, corsOrigins));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Ferme proprement les connexions Prisma quand l'hébergeur envoie SIGTERM.
  app.enableShutdownHooks();

  const swaggerEnabled = config.get<string>('SWAGGER_ENABLED');
  if (swaggerEnabled ? swaggerEnabled === 'true' : !isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Sessionized API')
        .setDescription(
          'Backend NestJS de la plateforme Sessionized — coaching sportif, analyse de séances .fit et Warning Engine.',
        )
        .setVersion('0.0.1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.get<string>('PORT') ?? 3000);
}
void bootstrap();
