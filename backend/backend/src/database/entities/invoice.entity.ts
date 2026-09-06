import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// NOTE: like Shipment.customerId / Payment.shipmentId elsewhere in this
// codebase, InvoiceLineItem.invoiceId is a plain uuid column, not a
// TypeORM @OneToMany/@ManyToOne relation — line items are fetched with
// a plain `find({ where: { invoiceId } })`, not eager-loaded here.
//
// WAZZAR prices per delivery, not as a subscription — an Invoice here
// is a generated STATEMENT over a date range of a business's own
// already-COMPLETED payments (see InvoicesService.generate), not a
// bill for something not yet paid. Its purpose is accounting/records:
// a business hands this to their accountant or files it for tax
// purposes, instead of scraping a per-delivery payment history table
// by hand. Once generated, an invoice's numbers are a frozen snapshot
// — see InvoiceLineItem's amount field — even if the underlying
// payment record were somehow later modified.
@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'business_id', type: 'uuid' })
  businessId: string;

  // Human-facing, sequential per business — "INV-2026-0007", not a
  // UUID — because that's what a business actually writes on their
  // own books / hands to a client. See InvoicesService.generate for
  // how the sequence is assigned (best-effort, not strictly race-proof
  // under concurrent generation for the same business — documented
  // there, not glossed over here).
  @Column({ name: 'invoice_number', type: 'varchar', length: 40 })
  invoiceNumber: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'subtotal_amount', type: 'decimal', precision: 12, scale: 2 })
  subtotalAmount: string;

  @Column({ name: 'tax_rate_percent', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRatePercent: string;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  taxAmount: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 12, scale: 2 })
  totalAmount: string;

  @Column({ type: 'varchar', length: 3, default: 'TZS' })
  currency: string;

  // Denormalized count so the list view doesn't need a join/count
  // against invoice_line_items just to show "12 deliveries".
  @Column({ name: 'shipment_count', type: 'int' })
  shipmentCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
