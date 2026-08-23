import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PricingMode {
  DISTANCE = 'DISTANCE',
  WEIGHT = 'WEIGHT',
  HYBRID = 'HYBRID',
}

// One [startHour, endHour) pair per surge window, in 24h local time —
// e.g. [[8, 11], [17, 21]] for an 8-11am and 5-9pm surge. Stored as jsonb
// so PricingService can evaluate it without a schema change per config.
export type SurgeWindow = [number, number];

// Time-versioned pricing rule. Only one config is ever `isActive` at a
// time in this Phase 1 model (see PricingService.createConfig, which
// deactivates whatever was active before inserting the new one) — the
// effective_from/effective_to range is what lets PricingService answer
// "what price applied to a shipment quoted 3 weeks ago" for
// reconciliation, even after the config has changed since.
@Entity('pricing_configs')
export class PricingConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'pricing_mode', type: 'enum', enum: PricingMode })
  pricingMode: PricingMode;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'base_price', type: 'decimal', precision: 12, scale: 2 })
  basePrice: string;

  @Column({
    name: 'price_per_km',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  pricePerKm: string;

  @Column({
    name: 'included_distance_km',
    type: 'decimal',
    precision: 8,
    scale: 2,
    default: 0,
  })
  includedDistanceKm: string;

  @Column({
    name: 'price_per_kg',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  pricePerKg: string;

  @Column({
    name: 'included_weight_kg',
    type: 'decimal',
    precision: 8,
    scale: 2,
    default: 0,
  })
  includedWeightKg: string;

  @Column({
    name: 'platform_commission_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  platformCommissionPercent: string;

  @Column({
    name: 'rider_payout_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  riderPayoutPercent: string;

  // Multiplier applied when `at` falls inside one of surgeActiveHours'
  // windows — see PricingService.calculateSurgeMultiplier(). Outside
  // those windows the effective multiplier is always 1.00, regardless
  // of this value.
  @Column({
    name: 'surge_multiplier',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 1.0,
  })
  surgeMultiplier: string;

  @Column({ name: 'surge_active_hours', type: 'jsonb', nullable: true })
  surgeActiveHours: SurgeWindow[] | null;

  @Column({
    name: 'min_price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  minPrice: string | null;

  @Column({
    name: 'max_price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  maxPrice: string | null;

  @Column({ name: 'effective_from', type: 'timestamp' })
  effectiveFrom: Date;

  @Column({ name: 'effective_to', type: 'timestamp', nullable: true })
  effectiveTo: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Plain uuid, not an FK, for the same reason shipments.customer_id
  // isn't one yet — see the NOTE in shipment.entity.ts. Only admins can
  // reach the endpoint that sets this, so it's always a real user id in
  // practice.
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;
}
