import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../../database/entities/invoice.entity';
import { InvoiceLineItem } from '../../database/entities/invoice-line-item.entity';
import { Payment } from '../../database/entities/payment.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invoice, InvoiceLineItem, Payment, Shipment]),
    // For BusinessProfileService.getOrCreateProfile() — the invoice
    // PDF's "Billed to" line needs the business's display name.
    BusinessProfileModule,
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class InvoicesModule {}
