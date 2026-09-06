import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Not, Repository } from 'typeorm';
import { Invoice } from '../../database/entities/invoice.entity';
import { InvoiceLineItem } from '../../database/entities/invoice-line-item.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { centsFromDecimal, decimalFromCents } from '../../common/money';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';

export interface InvoiceWithLineItems extends Invoice {
  lineItems: InvoiceLineItem[];
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoicesRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private readonly lineItemsRepo: Repository<InvoiceLineItem>,
    @InjectRepository(Payment)
    private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async generate(businessId: string, dto: GenerateInvoiceDto): Promise<InvoiceWithLineItems> {
    if (dto.periodStart > dto.periodEnd) {
      throw new BadRequestException('periodStart must not be after periodEnd');
    }
    const taxRatePercent = dto.taxRatePercent ?? 0;

    // Whole-day range in UTC. Same "good enough, not timezone-aware
    // per business" tradeoff PricingConfig's time-of-day windows make
    // elsewhere in this codebase — East Africa Time is UTC+3
    // year-round (no DST), so a business's "day" and UTC's day only
    // ever disagree by a few hours at the very edges, not by a whole
    // calendar day.
    const rangeStart = new Date(`${dto.periodStart}T00:00:00.000Z`);
    const rangeEnd = new Date(`${dto.periodEnd}T23:59:59.999Z`);

    // Already-invoiced payments (any invoice, not just this business's
    // — a payment can only ever belong to one business anyway via
    // customerId) are excluded so re-running generate() for an
    // overlapping range never double-bills a delivery.
    const alreadyInvoicedPaymentIds = (
      await this.lineItemsRepo.find({ select: ['paymentId'] })
    ).map((li) => li.paymentId);

    const eligiblePayments = await this.paymentsRepo.find({
      where: {
        customerId: businessId,
        status: PaymentStatus.COMPLETED,
        completedAt: Between(rangeStart, rangeEnd),
        ...(alreadyInvoicedPaymentIds.length ? { id: Not(In(alreadyInvoicedPaymentIds)) } : {}),
      },
      order: { completedAt: 'ASC' },
    });

    if (eligiblePayments.length === 0) {
      throw new BadRequestException(
        'No completed, not-yet-invoiced payments were found in this period',
      );
    }

    const shipments = await this.shipmentsRepo.find({
      where: { id: In(eligiblePayments.map((p) => p.shipmentId)) },
    });
    const shipmentById = new Map(shipments.map((s) => [s.id, s]));

    const subtotalCents = eligiblePayments.reduce(
      (sum, p) => sum + centsFromDecimal(p.amount),
      0,
    );
    const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
    const totalCents = subtotalCents + taxCents;

    return this.dataSource.transaction(async (manager) => {
      const invoicesRepo = manager.getRepository(Invoice);
      const lineItemsRepo = manager.getRepository(InvoiceLineItem);

      const invoiceNumber = await this.nextInvoiceNumber(businessId, invoicesRepo);

      const invoice = await invoicesRepo.save(
        invoicesRepo.create({
          businessId,
          invoiceNumber,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          subtotalAmount: decimalFromCents(subtotalCents),
          taxRatePercent: taxRatePercent.toFixed(2),
          taxAmount: decimalFromCents(taxCents),
          totalAmount: decimalFromCents(totalCents),
          currency: 'TZS',
          shipmentCount: eligiblePayments.length,
        }),
      );

      const lineItems = await lineItemsRepo.save(
        eligiblePayments.map((payment) =>
          lineItemsRepo.create({
            invoiceId: invoice.id,
            shipmentId: payment.shipmentId,
            paymentId: payment.id,
            description: this.buildDescription(shipmentById.get(payment.shipmentId)),
            amount: payment.amount,
            deliveredAt: shipmentById.get(payment.shipmentId)?.completedAt ?? null,
          }),
        ),
      );

      return { ...invoice, lineItems };
    });
  }

  // Newest-first, same convention as every other business-owned list.
  async list(businessId: string): Promise<Invoice[]> {
    return this.invoicesRepo.find({ where: { businessId }, order: { createdAt: 'DESC' } });
  }

  async findOne(businessId: string, id: string): Promise<InvoiceWithLineItems> {
    const invoice = await this.findOwnedOrThrow(businessId, id);
    const lineItems = await this.lineItemsRepo.find({
      where: { invoiceId: id },
      order: { deliveredAt: 'ASC' },
    });
    return { ...invoice, lineItems };
  }

  async findOwnedOrThrow(businessId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoicesRepo.findOne({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    if (invoice.businessId !== businessId) {
      throw new ForbiddenException('You do not have access to this invoice');
    }
    return invoice;
  }

  // "Delivery — Mikocheni B to CBD" — falls back to a generic label if
  // the shipment somehow can't be found (shouldn't happen given the FK,
  // but a description shouldn't ever throw and abort a whole invoice).
  private buildDescription(shipment: Shipment | undefined): string {
    if (!shipment) return 'Delivery';
    const from = shortenAddress(shipment.pickupLocation?.address);
    const to = shortenAddress(shipment.dropoffLocation?.address);
    if (!from || !to) return 'Delivery';
    return `Delivery — ${from} to ${to}`;
  }

  // Best-effort sequential numbering scoped per business
  // ("INV-2026-0001", "INV-2026-0002", ...) — counts this business's
  // existing invoices for the calendar year and adds one, inside the
  // same transaction as the insert. NOT strictly race-proof: two
  // concurrent generate() calls for the same business could in theory
  // both read the same count before either inserts. Acceptable at
  // today's volume (one business generating one invoice at a time
  // from its own dashboard); a DB sequence or advisory lock would be
  // the fix if concurrent generation ever becomes a real scenario.
  private async nextInvoiceNumber(businessId: string, invoicesRepo: Repository<Invoice>): Promise<string> {
    const year = new Date().getUTCFullYear();
    const count = await invoicesRepo.count({
      where: { businessId, invoiceNumber: Between(`INV-${year}-0000`, `INV-${year}-9999`) },
    });
    return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  }
}

function shortenAddress(address: string | undefined): string | null {
  if (!address) return null;
  const firstSegment = address.split(',')[0].trim();
  return firstSegment || address;
}
