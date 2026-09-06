import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum TrackingChannelType {
  GPS_LIVE = 'GPS_LIVE',
  LATRA_TRACKING = 'LATRA_TRACKING',
  PARTNER_SCAN = 'PARTNER_SCAN',
  SMS_WEBHOOK = 'SMS_WEBHOOK',
  DISPATCHER_MANUAL = 'DISPATCHER_MANUAL',
}

// One row per raw tracking ping ingested for a Leg — the Phase 2
// counterpart to Phase 1's `rider_locations` table, but a log rather
// than a single latest-position row, because a TRUNK leg's position can
// come from any of several sources (see TrackingChannelType) that don't
// share a consistent shape or cadence the way a rider's GPS ping does.
// `eventData` is deliberately untyped JSONB — a LATRA poll, a partner's
// QR hub-scan, an inbound SMS webhook, and a dispatcher's manual note
// each carry different fields; TrackingChannelsService normalizes
// whatever's meaningful out of this into a TrackingEvent row.
//
// Named to match WAZZAR_SYSTEM_ARCHITECTURE.md's `tracking_channels`
// table, with one deliberate clarification the doc's own pseudocode
// left ambiguous (its `tracking_channels` and `tracking_events` tables
// have near-identical columns): here, TrackingChannel is the raw
// ingestion log (this entity) and TrackingEvent is the normalized,
// customer/dispatcher-facing timeline derived from it — the same
// raw-ping-vs-audit-trail split Phase 1 already has between
// `rider_locations` and `shipment_status_history`.
@Entity('tracking_channels')
export class TrackingChannel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'leg_id', type: 'uuid' })
  legId: string;

  @Column({ name: 'channel_type', type: 'enum', enum: TrackingChannelType })
  channelType: TrackingChannelType;

  // Free-text label for the specific source within a channel type, e.g.
  // 'latra_api', 'partner_scan_qr', a partner operator's name for an SMS
  // webhook. Not an enum — the set of real sources will only be known
  // once real partners are onboarded.
  @Column({ type: 'varchar', length: 100, nullable: true })
  source: string | null;

  @Column({ name: 'event_data', type: 'jsonb' })
  eventData: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Stamped once TrackingChannelsService has derived a TrackingEvent (and
  // broadcast it, if applicable) from this row — null means "ingested but
  // not yet processed," which should be momentary in normal operation
  // (processing happens synchronously in the same request today; this
  // column exists so a future async/queued processor has somewhere to
  // record progress without changing the table shape).
  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt: Date | null;
}
