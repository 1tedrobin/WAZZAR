import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DEFAULT_CURRENCY, SupportedCurrency } from '../../common/currency';

export enum ShipmentStatus {
  CREATED = 'CREATED',
  QUOTED = 'QUOTED',
  CONFIRMED = 'CONFIRMED',
  ASSIGNMENT_PENDING = 'ASSIGNMENT_PENDING',
  ASSIGNED = 'ASSIGNED',
  PICKUP_IN_PROGRESS = 'PICKUP_IN_PROGRESS',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
  address: string;
  instruction?: string;
}

// Phase 2 (Intercity/Trunk Network) — LOCAL is every Phase 1 shipment
// (single rider, pickup straight to dropoff, unchanged). INTERCITY is
// new: created via POST /shipments/intercity (see LegsService), backed
// by 1+ Leg rows instead of being fulfilled directly by shipments.riderId.
export enum ShipmentType {
  LOCAL = 'LOCAL',
  INTERCITY = 'INTERCITY',
}

// NOTE: customer_id / rider_id are plain UUID columns, not TypeORM
// @ManyToOne relations, so this entity doesn't need to import User/Rider.
// rider_id DOES have a real DB-level foreign key to riders(id) as of the
// CreateRidersTable migration (ON DELETE SET NULL) — the constraint is
// enforced by Postgres even without a TypeORM relation object here.
// customer_id has no FK yet (users can't currently be deleted, so it
// hasn't mattered) — add both @ManyToOne relations if/when a future
// module needs to eager-load the related User/Rider from a Shipment.
@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'rider_id', type: 'uuid', nullable: true })
  riderId: string | null;

  @Column({
    type: 'enum',
    enum: ShipmentStatus,
    default: ShipmentStatus.CREATED,
  })
  status: ShipmentStatus;

  @Column({ name: 'pickup_location', type: 'jsonb' })
  pickupLocation: LocationPoint;

  @Column({ name: 'dropoff_location', type: 'jsonb' })
  dropoffLocation: LocationPoint;

  @Column({
    name: 'package_weight_kg',
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  packageWeightKg: string | null;

  @Column({ name: 'package_description', type: 'text', nullable: true })
  packageDescription: string | null;

  // Set from the PricingConfig's currency at quote time (see
  // ShipmentsService.create) — the currency price/commission/riderPayout
  // below are all denominated in. Never null: defaults to TZS even
  // before a price exists, since a currency is chosen for the shipment's
  // market up front, independent of whether pricing has resolved yet.
  @Column({ type: 'enum', enum: SupportedCurrency, default: DEFAULT_CURRENCY })
  currency: SupportedCurrency;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  price: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  commission: string | null;

  @Column({
    name: 'rider_payout',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  riderPayout: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'assigned_at', type: 'timestamp', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'picked_up_at', type: 'timestamp', nullable: true })
  pickedUpAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  // Populated once by POST /shipments/:id/rate-rider — NULL means "not
  // rated yet," which is also the guard against rating the same
  // shipment twice. See AddShipmentRiderRating migration.
  @Column({ name: 'rider_rating', type: 'smallint', nullable: true })
  riderRating: number | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  // Phase 2 (Intercity/Trunk Network) — additive, see AddIntercityShipmentFields
  // migration. Defaults keep every existing/Phase-1-created row exactly as
  // it was: shipmentType LOCAL, legCount/currentLeg null (a LOCAL shipment
  // has no Leg rows and is still fulfilled directly via riderId, same as
  // before this migration). Only LegsService.planIntercityShipment sets
  // these to non-default values, on a new shipment, at creation time —
  // nothing rewrites them on an existing LOCAL shipment.
  @Column({
    name: 'shipment_type',
    type: 'enum',
    enum: ShipmentType,
    default: ShipmentType.LOCAL,
  })
  shipmentType: ShipmentType;

  @Column({ name: 'leg_count', type: 'int', nullable: true })
  legCount: number | null;

  // 1-based index into the shipment's Leg rows (by `sequence`) — which
  // leg is currently in progress. Advanced by LegsService.updateStatus
  // when a leg completes; null for LOCAL shipments (no legs to index).
  @Column({ name: 'current_leg', type: 'int', nullable: true })
  currentLeg: number | null;
}
