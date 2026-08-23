import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Rider } from '../../database/entities/rider.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

// No new entities/migrations of its own — dispatch operates on top of the
// existing shipments/riders/shipment_statuses tables from the Shipments
// and Riders vertical slices, plus rider_locations from the tracking
// vertical slice (read-only here, for distance-based candidate ranking —
// see DispatchService.rankCandidates).
@Module({
  imports: [
    TypeOrmModule.forFeature([Shipment, Rider, ShipmentStatusHistory, RiderLocation]),
  ],
  controllers: [DispatchController],
  providers: [DispatchService],
})
export class DispatchModule {}
