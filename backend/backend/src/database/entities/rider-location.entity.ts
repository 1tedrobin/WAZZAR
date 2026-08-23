import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// One row per rider — the *current* position only, upserted on every
// POST /rider/location ping. Not a history table: WAZZAR_SYSTEM_ARCHITECTURE.md
// also describes a `tracking_events` audit trail (Phase 2, alongside
// TrackingChannel/PARTNER_SCAN/Latra/etc.) — that's out of scope here.
// A plain uuid FK to riders(id), same convention as shipment.riderId — no
// TypeORM relation object since nothing has needed to eager-load through
// it yet.
@Entity('rider_locations')
export class RiderLocation {
  @PrimaryColumn({ name: 'rider_id', type: 'uuid' })
  riderId: string;

  @Column({ type: 'decimal', precision: 10, scale: 8 })
  latitude: string;

  @Column({ type: 'decimal', precision: 11, scale: 8 })
  longitude: string;

  @Column({ name: 'accuracy_meters', type: 'int', nullable: true })
  accuracyMeters: number | null;

  // Auto-bumped by TypeORM on every .save() of an existing row — this is
  // exactly the "last ping" timestamp tracking screens need, so no manual
  // `new Date()` assignment like the shipment status timestamps use.
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
