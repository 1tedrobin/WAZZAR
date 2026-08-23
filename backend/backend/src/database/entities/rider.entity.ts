import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum RiderStatus {
  ONBOARDING = 'ONBOARDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

// The four documents a rider can upload — matches the four *DocumentUrl
// columns below one-for-one. Keyed this way (rather than a foreign key
// per document) because there's exactly one of each per rider.
export enum RiderDocumentType {
  ID = 'ID',
  LICENSE = 'LICENSE',
  VEHICLE_REGISTRATION = 'VEHICLE_REGISTRATION',
  INSURANCE = 'INSURANCE',
}

export enum DocumentReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface DocumentReview {
  status: DocumentReviewStatus;
  // Required by the service when status is REJECTED; null otherwise.
  reason: string | null;
  reviewedAt: string | null;
}

// Live GPS position lives in a separate `rider_locations` table (see
// RiderLocation entity + the `tracking` module) — `isOnline` here is just
// a manual availability flag a rider can toggle, not their position.
@Entity('riders')
export class Rider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 50, nullable: true })
  vehicleType: string | null;

  @Column({
    name: 'vehicle_registration',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  vehicleRegistration: string | null;

  @Column({ name: 'license_number', type: 'varchar', length: 100, nullable: true })
  licenseNumber: string | null;

  // Populated by clients calling POST /uploads first, then passing the
  // returned URL here. All nullable — see AddRiderDocumentUrls migration.
  @Column({ name: 'id_document_url', type: 'varchar', length: 500, nullable: true })
  idDocumentUrl: string | null;

  @Column({ name: 'license_document_url', type: 'varchar', length: 500, nullable: true })
  licenseDocumentUrl: string | null;

  @Column({ name: 'vehicle_registration_document_url', type: 'varchar', length: 500, nullable: true })
  vehicleRegistrationDocumentUrl: string | null;

  @Column({ name: 'insurance_document_url', type: 'varchar', length: 500, nullable: true })
  insuranceDocumentUrl: string | null;

  @Column({ name: 'insurance_expires_at', type: 'date', nullable: true })
  insuranceExpiresAt: string | null;

  @Column({ name: 'documents_verified_at', type: 'timestamp', nullable: true })
  documentsVerifiedAt: Date | null;

  // Per-document review, alongside (not instead of) the whole-application
  // status above — see AddRiderDocumentReviews migration. `verify()` still
  // flips the whole profile ACTIVE in one action; this lets an admin also
  // record a decision on an individual document (e.g. reject just the
  // insurance doc as expired while everything else looks fine), without
  // that rejection blocking the rider's overall status by itself. Keyed
  // by RiderDocumentType; a document with no entry here hasn't been
  // reviewed yet (equivalent to PENDING).
  @Column({ name: 'document_reviews', type: 'jsonb', default: {} })
  documentReviews: Partial<Record<RiderDocumentType, DocumentReview>>;

  @Column({
    type: 'enum',
    enum: RiderStatus,
    default: RiderStatus.ONBOARDING,
  })
  status: RiderStatus;

  // Toggled via POST /riders/availability/online|offline. Gated on
  // `status === ACTIVE` in the service — an unverified rider can't go
  // online no matter what this column says.
  @Column({ name: 'is_online', type: 'boolean', default: false })
  isOnline: boolean;

  @Column({
    name: 'total_earnings',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalEarnings: string;

  @Column({ name: 'rating_avg', type: 'decimal', precision: 3, scale: 2, nullable: true })
  ratingAvg: string | null;

  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
