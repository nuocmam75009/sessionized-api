import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { PlansModule } from './plans/plans.module';
import { RaceDaysModule } from './race-days/race-days.module';
import { ActivitiesModule } from './activities/activities.module';
import { ChatModule } from './chat/chat.module';
import { StravaModule } from './strava/strava.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Limite par IP sur toute l'API HTTP (plus stricte sur /auth, cf.
    // AuthController). Les événements WebSocket ne passent pas par ce guard.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      errorMessage: 'Trop de requêtes, réessayez dans un instant',
      skipIf: (context) => context.getType() !== 'http',
    }),
    PrismaModule,
    UsersModule,
    AuthModule,
    WorkoutsModule,
    PlansModule,
    RaceDaysModule,
    ActivitiesModule,
    ChatModule,
    StravaModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
