import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { ShipmentsModule } from '../shipments/shipments.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MpesaTanzaniaProvider } from './providers/mpesa-tanzania.provider';
import { MpesaKenyaProvider } from './providers/mpesa-kenya.provider';
import { MtnMomoProvider } from './providers/mtn-momo.provider';
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
  // MpesaTanzaniaProvider (TZS), MpesaKenyaProvider (KES), and
  // MtnMomoProvider (UGX/RWF) are all registered even though
  // PaymentsService only picks one per request — see
  // resolveMobileMoneyProvider() there. See
  // docs/delivery-notes/PHASE4_REGIONAL_PAYMENT_PROVIDERS.md and
  // docs/delivery-notes/TANZANIA_MPESA_FIX.md for why these are
  // separate provider classes with separate credential sets rather than
  // one currency-parameterized class.
  //
  // MpesaProvider (the deprecated, mislabeled-as-Tanzania Safaricom
  // provider) is deliberately NOT registered here anymore — nothing in
  // PaymentsService references it. See its class-level comment.
  providers: [
    PaymentsService,
    MpesaTanzaniaProvider,
    MpesaKenyaProvider,
    MtnMomoProvider,
    StripeProvider,
  ],
})
export class PaymentsModule {}
