import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from './user-role.entity';

// The thread for a SupportTicket. is_internal_note is what makes this
// double as admin-to-admin case notes: a note with is_internal_note=true
// is written by an ADMIN/SUPER_ADMIN and is filtered out of every
// ticket-owner-facing read (SupportService.findOwnedOrThrow's message
// list) — same visibility split as a helpdesk's "public reply" vs
// "internal comment". Messages are append-only; there's no edit/delete
// route, matching shipment-status-history's audit-trail treatment.
@Entity('support_ticket_messages')
export class SupportTicketMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @Column({ name: 'author_role', type: 'enum', enum: Role })
  authorRole: Role;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'is_internal_note', type: 'boolean', default: false })
  isInternalNote: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
