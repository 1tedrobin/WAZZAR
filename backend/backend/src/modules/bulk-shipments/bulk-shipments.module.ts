import { Module } from '@nestjs/common';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { BulkShipmentsController } from './bulk-shipments.controller';
import { BulkShipmentsService } from './bulk-shipments.service';

@Module({
  imports: [
    // For ShipmentsService.create(), reused as-is — one call per valid
    // CSV row, same pricing/state-machine path a single manual order
    // goes through.
    ShipmentsModule,
    // For GeocodingService.search(), used for any row missing lat/lng.
    GeocodingModule,
  ],
  controllers: [BulkShipmentsController],
  providers: [BulkShipmentsService],
})
export class BulkShipmentsModule {}
