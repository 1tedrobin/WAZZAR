import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from './user-role.entity';

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketCategory {
  DELIVERY_ISSUE = 'DELIVERY_ISSUE',
  PAYMENT_ISSUE = 'PAYMENT_ISSUE',
  ACCOUNT_ISSUE = 'ACCOUNT_ISSUE',
  OTHER = 'OTHER',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

// Any authenticated user (CUSTOMER, RIDER, or BUSINESS) can raise a
// ticket — support isn't scoped to one role the way business_customers
// or scheduled_deliveries are. raised_by_role is a snapshot of
// user.roles[0] at creation time (see SupportService.create), not a
// live join to user_roles, so a later role change never rewrites who a
// ticket "was" raised as.
//
// shipment_id is a plain nullable UUID column (no FK), same pattern as
// shipments.customer_id — most tickets will reference a delivery, but
// account/payment tickets legitimately have none, and this module
// doesn't need to eager-load the Shipment.
@Entity('support_tickets')
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'raised_by_user_id', type: 'uuid' })
  raisedByUserId: string;

  @Column({ name: 'raised_by_role', type: 'enum', enum: Role })
  raisedByRole: Role;

  @Column({ name: 'shipment_id', type: 'uuid', nullable: true })
  shipmentId: string | null;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  @Column({ type: 'enum', enum: TicketCategory, default: TicketCategory.OTHER })
  category: TicketCategory;

  @Column({ type: 'enum', enum: TicketPriority, default: TicketPriority.MEDIUM })
  priority: TicketPriority;

  @Index()
  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  // Null until an admin picks it up. Assignment doesn't gate who can
  // reply — any ADMIN/SUPER_ADMIN can still act on an unassigned or
  // someone-else's ticket, this is a routing hint, not an ownership lock.
  @Column({ name: 'assigned_admin_id', type: 'uuid', nullable: true })
  assignedAdminId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt: Date | null;
}
