import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';

// Matches the permissions table in WAZZAR_SYSTEM_ARCHITECTURE.md.
// ADMIN / SUPER_ADMIN / DISPATCHER are intentionally excluded from what the
// public /auth/register endpoint accepts — see RegisterDto — they're granted
// out-of-band (seeded or by an existing admin), never self-assigned.
//
// DISPATCHER (added in Piece 6) is a dedicated dispatch operator role for
// Phase 2 (intercity/trunk legs), allowing fine-grained audit trails and
// billing per dispatcher without promoting to ADMIN.
export enum Role {
  CUSTOMER = 'CUSTOMER',
  RIDER = 'RIDER',
  BUSINESS = 'BUSINESS',
  DISPATCHER = 'DISPATCHER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

@Entity('user_roles')
export class UserRole {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'enum', enum: Role })
  role: Role;

  @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  @ManyToOne(() => User, (user) => user.roles)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
