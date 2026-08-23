import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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
}
