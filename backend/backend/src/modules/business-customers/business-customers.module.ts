import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessCustomer } from '../../database/entities/business-customer.entity';
import { BusinessCustomersController } from './business-customers.controller';
import { BusinessCustomersService } from './business-customers.service';

@Module({
  imports: [TypeOrmModule.forFeature([BusinessCustomer])],
  controllers: [BusinessCustomersController],
  providers: [BusinessCustomersService],
})
export class BusinessCustomersModule {}
