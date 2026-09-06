import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Scopes a key can be granted. Deliberately coarse-grained (three
// scopes, not one per endpoint) — matches the size of the public API
// surface this ships with (shipments + tracking). Add scopes here as
// the public API grows; never widen an existing scope's meaning after
// keys exist that rely on its current behavior.
export enum ApiKeyScope {
  SHIPMENTS_READ = 'shipments:read',
  SHIPMENTS_WRITE = 'shipments:write',
  TRACKING_READ = 'tracking:read',
}

export enum ApiKeyStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

// A business's own programmatic-access credential. Plaintext key is
// shown to the caller exactly once, at creation (see
// BusinessApiKeysService.create) — only a bcrypt hash of it is ever
// stored, same principle as User.passwordHash. `keyPrefix` is the
// non-secret first segment of the key (e.g. "wzr_live_ab12cd34"),
// kept in the clear specifically so ApiKeyAuthGuard can narrow its
// lookup to candidates sharing that prefix instead of bcrypt-comparing
// against every row in the table on every request.
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'business_id', type: 'uuid' })
  businessId: string;

  // Caller-chosen label ("Warehouse integration", "Zapier") — purely
  // for the business's own bookkeeping across multiple keys.
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Index()
  @Column({ name: 'key_prefix', type: 'varchar', length: 20 })
  keyPrefix: string;

  @Column({ name: 'key_hash', type: 'varchar' })
  keyHash: string;

  @Column({ type: 'enum', enum: ApiKeyScope, array: true, default: '{}' })
  scopes: ApiKeyScope[];

  @Column({ type: 'enum', enum: ApiKeyStatus, default: ApiKeyStatus.ACTIVE })
  status: ApiKeyStatus;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  // Lifetime call counter — coarse usage visibility for the business's
  // own dashboard. Not a rate limiter; the global ThrottlerModule still
  // applies per-IP on top of this, same as every other route.
  @Column({ name: 'request_count', type: 'int', default: 0 })
  requestCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
