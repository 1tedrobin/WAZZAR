import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A business account's profile (name, category, default pickup location).
// Previously saved only in frontend localStorage; now persisted server-side
// so it syncs across devices. One profile per business account.
@Entity('business_profiles')
export class BusinessProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'business_id', type: 'uuid' })
  businessId: string;

  @Column({ type: 'varchar', length: 150 })
  businessName: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  // Pickup location latitude — the "default" point from which the merchant
  // typically dispatches. Stored as float; frontend geocodes via Nominatim.
  @Column({ type: 'float', nullable: true })
  pickupLatitude: number | null;

  // Pickup location longitude.
  @Column({ type: 'float', nullable: true })
  pickupLongitude: number | null;

  // Human-readable pickup address string (for display/confirmation).
  @Column({ type: 'varchar', length: 500, nullable: true })
  pickupAddress: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
