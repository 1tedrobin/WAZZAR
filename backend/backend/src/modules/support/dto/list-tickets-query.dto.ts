import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { TicketCategory, TicketPriority, TicketStatus } from '../../../database/entities/support-ticket.entity';

// Admin-only listing filters — mirrors PaymentHistoryQueryDto's
// pagination shape. The ticket-owner's own GET /support/tickets takes
// no query params beyond an optional status (see ListMyTicketsQueryDto)
// since it's already scoped to one user and never needs this many knobs.
export class ListTicketsQueryDto {
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsEnum(TicketCategory)
  @IsOptional()
  category?: TicketCategory;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsUUID()
  @IsOptional()
  assignedAdminId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number = 0;
}
