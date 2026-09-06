import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum TrackingEventType {
  LOCATION_UPDATE = 'LOCATION_UPDATE',
  STATUS_CHANGE = 'STATUS_CHANGE',
  HUB_HANDOFF = 'HUB_HANDOFF',
}

// Normalized, append-only timeline for a Leg — what a customer tracking
// screen or dispatcher audit view actually reads, as opposed to the raw
// TrackingChannel ingestion log this is usually derived from (see that
// entity's header comment for the split). Also written directly by
// LegsService on leg status transitions (STATUS_CHANGE, HUB_HANDOFF),
// not only via a TrackingChannel ping — the same relationship
// Shipment's `shipment_status_history` has to `rider_locations` in
// Phase 1: one is a position feed, the other is "what happened, when."
@Entity('tracking_events')
export class TrackingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'leg_id', type: 'uuid' })
  legId: string;

  @Column({ name: 'event_type', type: 'enum', enum: TrackingEventType })
  eventType: TrackingEventType;

  @Column({ type: 'jsonb' })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
