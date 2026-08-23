import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BusinessStaffRole {
  MANAGER = 'MANAGER',
  STAFF = 'STAFF',
}

export enum BusinessStaffStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
}

// A business account's team roster entry — NOT a real login account.
// See the migration (CreateBusinessStaffTable) for the full rationale.
@Entity('business_staff')
export class BusinessStaff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'business_id', type: 'uuid' })
  businessId: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'enum', enum: BusinessStaffRole, default: BusinessStaffRole.STAFF })
  role: BusinessStaffRole;

  @Column({ type: 'enum', enum: BusinessStaffStatus, default: BusinessStaffStatus.PENDING })
  status: BusinessStaffStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
