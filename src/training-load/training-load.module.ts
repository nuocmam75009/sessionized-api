import { Module } from '@nestjs/common';
import { TrainingLoadService } from './training-load.service';
import { TrainingLoadController } from './training-load.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [TrainingLoadController],
  providers: [TrainingLoadService],
  exports: [TrainingLoadService],
})
export class TrainingLoadModule {}
