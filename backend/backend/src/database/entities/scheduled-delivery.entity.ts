import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LocationPoint } from './shipment.entity';

// A business's recurring-shipment definition — "every Monday at 7:30am,
// send this package from A to B." The scheduling itself (turning a due
// definition into a real Shipment) is NOT done here — see
// ScheduledDeliveriesCronService, which is the only writer of
// last_run_at/next_run_at outside of create/update. This entity is just
// the recurrence rule + shipment template.
//
// daysOfWeek uses JS's Date.getUTCDay() numbering (0 = Sunday ... 6 =
// Saturday) so it lines up directly with the recurrence util's own
// getUTCDay() calls — see scheduled-delivery-recurrence.util.ts's header
// comment for why everything here is computed in EAT (UTC+3), not the
// server's local/system timezone.
@Entity('scheduled_deliveries')
export class ScheduledDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'business_id', type: 'uuid' })
  businessId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

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

  // Stored as jsonb (an int array, 0-6) rather than Postgres's native
  // integer[] type — same reasoning as pickup/dropoff being jsonb: one
  // less TypeORM array-column edge case to worry about, and this column
  // is never queried/filtered on directly (runDueSchedules() loads every
  // active row and checks daysOfWeek in application code), so there's no
  // indexing benefit to a real array column here.
  @Column({ name: 'days_of_week', type: 'jsonb' })
  daysOfWeek: number[];

  // 24-hour "HH:mm", interpreted in EAT — see the recurrence util.
  @Column({ name: 'time_of_day', type: 'varchar', length: 5 })
  timeOfDay: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Index()
  @Column({ name: 'next_run_at', type: 'timestamptz' })
  nextRunAt: Date;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  // Set by the cron job when the most recent run's shipment creation
  // threw (e.g. no active PricingConfig at that moment). Not a hard
  // stop — the schedule still advances to its next occurrence rather
  // than retrying in a loop — but it's surfaced here so a business
  // (or an admin) can see a schedule quietly failing instead of just
  // never producing shipments with no explanation.
  @Column({ name: 'last_run_error', type: 'text', nullable: true })
  lastRunError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
