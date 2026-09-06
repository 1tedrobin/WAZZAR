import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Phase 2 (Intercity/Trunk Network) — physical transfer points where a
// LOCAL leg (rider <-> hub) hands off to a TRUNK leg (carrier <-> hub)
// and vice versa. See WAZZAR_SYSTEM_ARCHITECTURE.md's "Phase 2 (Intercity)
// Tables" for the original design; this entity follows it with one
// deliberate change — `managerId` stays a plain nullable UUID column (no
// FK to users(id)), matching how Shipment.customerId already does this
// in this codebase (see the note on that entity) rather than the FK the
// architecture doc's pseudocode SQL shows, since users can't currently
// be deleted and nothing here needs an eager-loaded relation yet.
@Entity('hubs')
export class Hub {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'decimal', precision: 10, scale: 8 })
  latitude: string;

  @Column({ type: 'decimal', precision: 11, scale: 8 })
  longitude: string;

  @Column({ type: 'text' })
  address: string;

  @Column({ name: 'capacity_kg', type: 'int', nullable: true })
  capacityKg: number | null;

  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
