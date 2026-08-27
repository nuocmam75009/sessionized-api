import { Module } from '@nestjs/common';
import { RaceDaysService } from './race-days.service';
import { RaceDaysController } from './race-days.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [RaceDaysController],
  providers: [RaceDaysService],
})
export class RaceDaysModule {}
