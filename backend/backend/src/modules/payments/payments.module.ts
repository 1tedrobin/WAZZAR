import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { ShipmentsModule } from '../shipments/shipments.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MpesaProvider } from './providers/mpesa.provider';
import { StripeProvider } from './providers/stripe.provider';

@Module({
  // Shipment is registered here (not just ShipmentsModule) so
  // PaymentsService can read the price to charge and verify the caller
  // owns the shipment — same pattern ShipmentsModule uses for Rider.
  // ShipmentsModule is imported (not TypeOrmModule.forFeature'd further)
  // so PaymentsService can call ShipmentsService.confirmAfterPayment()
  // on a completed webhook, going through the shipment state machine
  // instead of writing shipment.status directly from here.
  imports: [TypeOrmModule.forFeature([Payment, Shipment]), ShipmentsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, MpesaProvider, StripeProvider],
})
export class PaymentsModule {}
