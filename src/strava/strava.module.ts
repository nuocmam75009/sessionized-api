import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { StravaService } from './strava.service';
import { StravaTokenCipher } from './strava-token-cipher';
import { StravaController } from './strava.controller';
import { UsersModule } from '../users/users.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [
    UsersModule,
    ActivitiesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [StravaController],
  providers: [StravaService, StravaTokenCipher],
})
export class StravaModule {}
