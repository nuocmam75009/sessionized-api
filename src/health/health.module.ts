import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// PrismaService et RedisService viennent de modules globaux.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
