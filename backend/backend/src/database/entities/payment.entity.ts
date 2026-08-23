import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PaymentMethod {
  MPESA = 'MPESA',
  STRIPE = 'STRIPE',
  CASH = 'CASH',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  PENDING_CASH_COLLECTION = 'PENDING_CASH_COLLECTION',
}

// NOTE: shipment_id / customer_id are plain uuid columns, not TypeORM
// @ManyToOne relations — same convention as Shipment.customerId /
// Shipment.riderId (see the NOTE at the top of shipment.entity.ts).
// Both DO have real DB-level FKs as of CreatePaymentsTable, enforced by
// Postgres even without a relation object here.
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shipment_id', type: 'uuid' })
  shipmentId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ type: 'enum', enum: PaymentMethod })
  method: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  // Provider's transaction/checkout id (M-Pesa CheckoutRequestID, Stripe
  // PaymentIntent id, ...). Unique so a webhook can look a payment up by
  // it, and so re-inserting the same provider id (a retried initiate
  // call) fails loudly instead of creating a duplicate charge record.
  // Null until the provider call succeeds; always null for CASH.
  @Column({ name: 'external_id', type: 'varchar', length: 255, unique: true, nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  provider: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({
    name: 'refunded_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  refundedAmount: string;

  @Column({ name: 'refund_reason', type: 'text', nullable: true })
  refundReason: string | null;

  // Provider callback payloads, refund ids, and anything else worth
  // keeping for support/dispute lookups without adding a column per field.
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamp', nullable: true })
  failedAt: Date | null;
}
