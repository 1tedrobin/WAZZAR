import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessStaff } from '../../database/entities/business-staff.entity';
import { BusinessStaffController } from './business-staff.controller';
import { BusinessStaffService } from './business-staff.service';

@Module({
  imports: [TypeOrmModule.forFeature([BusinessStaff])],
  controllers: [BusinessStaffController],
  providers: [BusinessStaffService],
})
export class BusinessStaffModule {}
