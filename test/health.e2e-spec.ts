import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { RedisService } from '../src/redis/redis.service';

describe('GET /health (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();

    // Juste après le démarrage, ioredis peut encore être en train de se
    // connecter : la sonde dirait alors, à raison, « degraded ».
    const redis = app.get(RedisService);
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('vraie base et vrai Redis joignables : 200 ok, sans authentification', async () => {
    const res = await request(app.getHttpServer() as App)
      .get('/health')
      .expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up', redis: 'up' });
  });
});
