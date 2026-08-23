import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TicketPriority, TicketStatus } from '../../../database/entities/support-ticket.entity';

// Admin-only (see SupportController's PATCH /support/admin/tickets/:id).
// Deliberately doesn't allow editing subject/category/shipmentId — those
// describe what the raiser reported, not something an admin should be
// able to silently rewrite; only the ticket's handling state changes here.
export class UpdateTicketDto {
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  // Pass null to unassign. Assigning to a specific admin id is not
  // validated against user_roles here (same trust level as an admin
  // acting on any other admin-only route) — see SupportService.update.
  @IsUUID()
  @IsOptional()
  assignedAdminId?: string | null;
}
