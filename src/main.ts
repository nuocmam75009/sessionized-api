import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // Ferme proprement les connexions Prisma quand l'hébergeur envoie SIGTERM.
  app.enableShutdownHooks();

  await app.listen(app.get(ConfigService).get<string>('PORT') ?? 3000);
}
void bootstrap();
