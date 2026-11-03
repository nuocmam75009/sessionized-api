import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { CorsIoAdapter } from './common/adapters/cors-io.adapter';
import { parseCorsOrigins } from './config/env.validation';

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3002',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configuredOrigins = process.env.FRONTEND_URLS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: configuredOrigins?.length ? configuredOrigins : DEFAULT_DEV_ORIGINS,
    credentials: true,
  });
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
