import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// One row per completed payment folded into an invoice. `amount` is a
// SNAPSHOT taken at generation time (see InvoicesService.generate) —
// deliberately duplicated off Payment.amount rather than joined live,
// so a later refund or data correction on the payment can never
// silently change a total the business already handed to their
// accountant or a client.
//
// The unique index on payment_id is the mechanism that keeps a given
// payment from ever landing on two invoices — InvoicesService.generate
// only ever selects COMPLETED payments with no existing line item.
@Entity('invoice_line_items')
export class InvoiceLineItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'shipment_id', type: 'uuid' })
  shipmentId: string;

  @Index({ unique: true })
  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId: string;

  // Short human-readable line, e.g. "Delivery — Mikocheni B to CBD" —
  // built from the shipment's pickup/dropoff addresses at generation
  // time (see InvoicesService.buildDescription).
  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
