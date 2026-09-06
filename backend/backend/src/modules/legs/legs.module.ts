import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Leg } from '../../database/entities/leg.entity';
import { Rider } from '../../database/entities/rider.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { TrackingEvent } from '../../database/entities/tracking-event.entity';
import { CarriersModule } from '../carriers/carriers.module';
import { HubsModule } from '../hubs/hubs.module';
import { PartnerOperatorsModule } from '../partner-operators/partner-operators.module';
import { PricingModule } from '../pricing/pricing.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { TrackingModule } from '../tracking/tracking.module';
import { IntercityShipmentsController } from './intercity-shipments.controller';
import { LegsController } from './legs.controller';
import { LegsService } from './legs.service';
import { PartnerLegsController } from './partner-legs.controller';
import { RiderLegsController } from './rider-legs.controller';

@Module({
  // Shipment/Rider/ShipmentStatusHistory are registered here directly
  // (not only via ShipmentsModule) for the same reason DispatchModule
  // already does this — LegsService needs to read/write them directly
  // for its own transactional, legCount-aware logic that ShipmentsService
  // doesn't expose. ShipmentsModule is still imported for its exported
  // ShipmentsService, used only for the access-checked read in
  // LegsService.getLegs. PartnerOperatorsModule is imported for
  // PartnerLegsController's PartnerApiKeyGuard (carrier self-service).
  imports: [
    TypeOrmModule.forFeature([Leg, Shipment, Rider, ShipmentStatusHistory, TrackingEvent]),
    HubsModule,
    CarriersModule,
    PricingModule,
    ShipmentsModule,
    TrackingModule,
    PartnerOperatorsModule,
  ],
  controllers: [
    IntercityShipmentsController,
    LegsController,
    RiderLegsController,
    PartnerLegsController,
  ],
  providers: [LegsService],
  exports: [LegsService],
})
export class LegsModule {}
