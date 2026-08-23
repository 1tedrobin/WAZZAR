import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingConfig } from '../../database/entities/pricing-config.entity';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [TypeOrmModule.forFeature([PricingConfig])],
  controllers: [PricingController],
  providers: [PricingService],
  // Exported so PaymentsModule (or, eventually, ShipmentsModule when it
  // starts quoting on create) can inject PricingService directly.
  exports: [PricingService],
})
export class PricingModule {}
