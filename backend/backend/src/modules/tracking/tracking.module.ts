import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rider } from '../../database/entities/rider.entity';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { TrackingController } from './tracking.controller';
import { TrackingGateway } from './tracking.gateway';
import { TrackingService } from './tracking.service';

@Module({
  imports: [
    // Rider + Shipment are registered here too (not just their own
    // modules) for the same reason ShipmentsModule registers Rider — this
    // module needs to check rider status/ownership and shipment access
    // directly, in both the HTTP service and the WebSocket gateway.
    TypeOrmModule.forFeature([RiderLocation, Rider, Shipment]),
    // Registered with no default secret, same as AuthModule — the gateway
    // passes JWT_SECRET explicitly on every verifyAsync() call instead.
    JwtModule.register({}),
  ],
  controllers: [TrackingController],
  providers: [TrackingService, TrackingGateway],
  // Exported so PublicApiModule can call getShipmentTracking() behind
  // the tracking:read API-key scope — same reasoning ShipmentsModule
  // exports ShipmentsService. TrackingGateway is also exported so
  // Phase 2's LegsModule/TrackingChannelsModule can push
  // `tracking:leg-update` events to the same shipment:{id} room this
  // gateway already broadcasts Phase 1 rider-GPS updates to (see
  // TrackingGateway.broadcastLegUpdate) — additive, doesn't change
  // anything about how Phase 1's own `tracking:update` broadcast works.
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
