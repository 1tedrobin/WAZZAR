import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Carrier } from '../../database/entities/carrier.entity';
import { PartnerOperatorsModule } from '../partner-operators/partner-operators.module';
import { CarriersController } from './carriers.controller';
import { CarriersService } from './carriers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Carrier]), PartnerOperatorsModule],
  controllers: [CarriersController],
  providers: [CarriersService],
  // Exported so LegsModule can look up carrier candidates for a TRUNK leg
  // (findActiveForRoute) and validate a carrierId at assignment time.
  exports: [CarriersService],
})
export class CarriersModule {}
