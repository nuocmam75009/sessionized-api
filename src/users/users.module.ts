import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { PersonalDataService } from './personal-data.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PersonalDataService],
  exports: [UsersService],
})
export class UsersModule {}
