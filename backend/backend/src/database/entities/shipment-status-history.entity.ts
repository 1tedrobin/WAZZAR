import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Audit trail for shipment status changes — one row per transition,
// including the initial CREATED row written at shipment creation.
// `status` is a plain string (not the ShipmentStatus enum type) on purpose:
// this is a historical record, so it shouldn't break if the live enum
// ever drops or renames a value years from now.
//
// NOTE: changed_by is a plain nullable UUID, not an FK, for the same
// reason customer_id/rider_id aren't FKs yet on `shipments` — the users
// table doesn't exist until the Auth vertical slice lands. Until then
// this column will just be null.
@Entity('shipment_statuses')
export class ShipmentStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'shipment_id', type: 'uuid' })
  shipmentId: string;

  @Column({ type: 'varchar', length: 50 })
  status: string;

  @Column({ name: 'changed_by', type: 'uuid', nullable: true })
  changedBy: string | null;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt: Date;

  @Column({ type: 'text', nullable: true })
  reason: string | null;
}
