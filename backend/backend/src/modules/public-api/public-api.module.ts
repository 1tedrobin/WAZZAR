import { Module } from '@nestjs/common';
import { BusinessApiKeysModule } from '../business-api-keys/business-api-keys.module';
import { ApiKeyAuthGuard } from '../business-api-keys/guards/api-key-auth.guard';
import { ShipmentsModule } from '../shipments/shipments.module';
import { TrackingModule } from '../tracking/tracking.module';
import { PublicApiController } from './public-api.controller';

@Module({
  imports: [
    // For BusinessApiKeysService (key validation) — see ApiKeyAuthGuard.
    BusinessApiKeysModule,
    // For ShipmentsService.create/findAll/findOne, reused as-is.
    ShipmentsModule,
    // For TrackingService.getShipmentTracking, reused as-is.
    TrackingModule,
  ],
  controllers: [PublicApiController],
  providers: [ApiKeyAuthGuard],
})
export class PublicApiModule {}
