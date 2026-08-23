import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProofOfDelivery } from '../../database/entities/proof-of-delivery.entity';
import { Rider } from '../../database/entities/rider.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { PricingModule } from '../pricing/pricing.module';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

@Module({
  // Rider is registered here too (not just RidersModule) so
  // ShipmentsService can check "is this caller the assigned rider?" and
  // "is this rider ACTIVE + online?" directly — see assertCanAccess() and
  // assign() in shipments.service.ts. ProofOfDelivery backs
  // submitProofOfDelivery()/getProofOfDelivery() — see Piece 8 in the README.
  // PricingModule is imported (not TypeOrmModule.forFeature'd) since
  // ShipmentsService only needs PricingService.calculatePrice(), not
  // direct repository access to PricingConfig — see create() in
  // shipments.service.ts (Piece 11 in the README).
  imports: [
    TypeOrmModule.forFeature([Shipment, Rider, ShipmentStatusHistory, ProofOfDelivery]),
    PricingModule,
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  // Exported so PaymentsModule can call confirmAfterPayment() when a
  // payment webhook completes — see the comment on that method.
  exports: [ShipmentsService],
})
export class ShipmentsModule {}

