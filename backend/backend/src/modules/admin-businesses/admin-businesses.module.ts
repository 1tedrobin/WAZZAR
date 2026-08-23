import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessCustomer } from '../../database/entities/business-customer.entity';
import { BusinessProfile } from '../../database/entities/business-profile.entity';
import { BusinessStaff } from '../../database/entities/business-staff.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { AdminBusinessesController } from './admin-businesses.controller';
import { AdminBusinessesService } from './admin-businesses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserRole, BusinessProfile, BusinessStaff, BusinessCustomer]),
  ],
  controllers: [AdminBusinessesController],
  providers: [AdminBusinessesService],
})
export class AdminBusinessesModule {}
