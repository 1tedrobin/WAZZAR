import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LocationPoint } from './shipment.entity';

export enum LegType {
  LOCAL = 'LOCAL',
  TRUNK = 'TRUNK',
}

export enum LegStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// One segment of an INTERCITY Shipment (see Shipment.shipmentType /
// legCount / currentLeg). A typical intercity shipment has three legs,
// sequence 1-3:
//   1. LOCAL  — customer pickup address -> origin hub   (rider)
//   2. TRUNK  — origin hub -> destination hub            (carrier)
//   3. LOCAL  — destination hub -> customer dropoff      (rider)
// matching the shape WAZZAR_SYSTEM_ARCHITECTURE.md's `legs` table
// describes. One deliberate departure from that doc's pseudocode: this
// uses two separate nullable FK columns (riderId, carrierId) instead of
// one polymorphic `assigned_to UUID` column — a real Postgres FK to
// riders(id)/carriers(id) each, the same "real FK, not a bare UUID"
// choice Shipment.riderId already made, at the cost of one column that's
// always null depending on legType (enforced in LegsService, not a DB
// CHECK constraint — same light-touch-in-the-DB style this codebase
// already uses for the shipment status machine).
@Entity('legs')
export class Leg {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shipment_id', type: 'uuid' })
  shipmentId: string;

  @Column({ name: 'leg_type', type: 'enum', enum: LegType })
  legType: LegType;

  // 1-based position within the parent shipment's leg sequence — matches
  // Shipment.currentLeg, which also starts at 1.
  @Column({ type: 'int' })
  sequence: number;

  @Column({ name: 'from_location', type: 'jsonb' })
  fromLocation: LocationPoint;

  @Column({ name: 'to_location', type: 'jsonb' })
  toLocation: LocationPoint;

  // Populated for legs that touch a hub (every leg in the 3-leg intercity
  // shape touches at least one) — null for a leg's customer-address end.
  // Leg 1: fromHubId null, toHubId set. Leg 2: both set. Leg 3: fromHubId
  // set, toHubId null.
  @Column({ name: 'from_hub_id', type: 'uuid', nullable: true })
  fromHubId: string | null;

  @Column({ name: 'to_hub_id', type: 'uuid', nullable: true })
  toHubId: string | null;

  @Column({ type: 'enum', enum: LegStatus, default: LegStatus.PENDING })
  status: LegStatus;

  // LOCAL legs only — see legType note above.
  @Column({ name: 'rider_id', type: 'uuid', nullable: true })
  riderId: string | null;

  // TRUNK legs only — see legType note above.
  @Column({ name: 'carrier_id', type: 'uuid', nullable: true })
  carrierId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'assigned_at', type: 'timestamp', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
