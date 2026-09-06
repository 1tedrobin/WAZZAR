import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum PartnerOperatorStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

// A bus/trucking company WAZZAR contracts with for TRUNK legs (see
// Leg entity). Authenticates its own systems (route/schedule pushes,
// tracking-channel ingestion — see TrackingChannel) against WAZZAR's API
// via a bearer API key, the same "external system, not a WAZZAR user
// account" shape partner integrations take elsewhere in this codebase
// (payment provider webhooks, geocoding). There is no User/Role for a
// partner operator — onboarding one is an ADMIN action (see
// PartnerOperatorsService), not a self-registration flow.
//
// `apiKeyHash` — the key itself is only ever shown once, at creation or
// rotation (PartnerOperatorsService.create/rotateKey), the same
// "generate once, store only the hash, verify with bcrypt.compare" shape
// this codebase already uses for passwords (see AuthService) — chosen
// over a reversible/encrypted key so a database leak alone can't be
// used to authenticate as a partner.
@Entity('partner_operators')
export class PartnerOperator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'api_key_hash', type: 'varchar', length: 255 })
  apiKeyHash: string;

  // The operator's own LATRA API key, used when WAZZAR polls LATRA for
  // that operator's buses (see LatraProvider). Stored as plain text for
  // now — genuinely a gap, not glossed over: this codebase has no
  // encryption-at-rest utility anywhere yet (payments/M-Pesa secrets are
  // all env vars, never DB columns), and building one is a bigger,
  // separate task than this pass. Column is nullable and unused until a
  // real LATRA account exists — see docs/delivery-notes/LATRA_INTEGRATION.md.
  // Do not put real credentials in this column before that gap is closed.
  @Column({ name: 'latra_api_key', type: 'varchar', length: 255, nullable: true })
  latraApiKey: string | null;

  @Column({
    type: 'enum',
    enum: PartnerOperatorStatus,
    default: PartnerOperatorStatus.ACTIVE,
  })
  status: PartnerOperatorStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
