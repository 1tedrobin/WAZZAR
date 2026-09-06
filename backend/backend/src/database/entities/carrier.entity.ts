import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum CarrierVehicleType {
  BUS = 'BUS',
  TRUCK = 'TRUCK',
  VAN = 'VAN',
}

export enum CarrierStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface CarrierRoute {
  fromCity: string;
  toCity: string;
}

// A single bus/truck/van belonging to a PartnerOperator, used for TRUNK
// legs (hub-to-hub). `routes` is a small JSONB list rather than a
// separate table (matches this codebase's existing preference for JSONB
// over a join table when the data is small and always read as a whole —
// see Shipment.pickupLocation/dropoffLocation) — it's what
// LegsService.findCarrierCandidates uses to shortlist carriers for a
// given hub pair; `schedule` is intentionally untyped JSONB for now
// (departure times/frequency vary enough by operator that forcing a
// shape here would fight real-world data before any operator has been
// onboarded to see what they actually send).
@Entity('carriers')
export class Carrier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'partner_operator_id', type: 'uuid' })
  partnerOperatorId: string;

  @Column({ name: 'vehicle_type', type: 'enum', enum: CarrierVehicleType })
  vehicleType: CarrierVehicleType;

  @Column({ type: 'varchar', length: 100 })
  registration: string;

  @Column({ name: 'capacity_kg', type: 'int', nullable: true })
  capacityKg: number | null;

  @Column({ type: 'jsonb', default: [] })
  routes: CarrierRoute[];

  @Column({ type: 'jsonb', nullable: true })
  schedule: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: CarrierStatus, default: CarrierStatus.ACTIVE })
  status: CarrierStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
