import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Hub } from '../../database/entities/hub.entity';
import { HubAssignment } from '../../database/entities/hub-assignment.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { HubsController } from './hubs.controller';
import { HubsService } from './hubs.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hub, HubAssignment, UserRole])],
  controllers: [HubsController],
  providers: [HubsService],
  // Exported so LegsModule can inject HubsService (findAssignedHubIds,
  // and validating origin/destination hub ids at plan time) without a
  // second TypeOrmModule.forFeature([Hub, ...]) registration.
  exports: [HubsService],
})
export class HubsModule {}
