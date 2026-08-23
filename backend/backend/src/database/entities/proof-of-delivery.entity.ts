import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// One row per shipment — the evidence captured when a rider moves a
// shipment from OUT_FOR_DELIVERY to DELIVERED (see
// ShipmentsService.submitProofOfDelivery). shipment_id is the primary
// key, not a separate id column: exactly one proof exists per shipment
// (delivery only happens once), same reasoning as RiderLocation keying
// on rider_id for "exactly one current row" instead of a generated id.
//
// photo_url is a plain string column, not an upload endpoint of its own —
// there's no S3/pre-signed-URL flow wired up anywhere in this repo yet
// (no AWS credentials in .env.example), the same gap that made tracking's
// ETA a straight-line estimate instead of a real routing call. A client
// that already has a hosted image (or a Phase 2 upload service) can pass
// its URL here; nothing in this piece uploads or validates image bytes.
@Entity('proof_of_delivery')
export class ProofOfDelivery {
  @PrimaryColumn({ name: 'shipment_id', type: 'uuid' })
  shipmentId: string;

  // Who the rider says they handed the package to. Free text, not a
  // structured contact — there's no recipient-identity concept anywhere
  // else in the schema yet (customer_id is the payer/requester, not
  // necessarily the person present at the door).
  @Column({ name: 'recipient_name', type: 'varchar', length: 255 })
  recipientName: string;

  @Column({ name: 'photo_url', type: 'text', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Plain uuid, not an FK — same convention as shipment.riderId /
  // shipment_statuses.changed_by. Always the assigned rider's user id;
  // see submitProofOfDelivery's conditional UPDATE for why it can't be
  // anyone else.
  @Column({ name: 'delivered_by', type: 'uuid' })
  deliveredBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
