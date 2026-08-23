import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TicketCategory } from '../../../database/entities/support-ticket.entity';

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string;

  // The first message in the thread — a ticket can't be created empty,
  // same reasoning as a shipment always needing at least a pickup/dropoff.
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;

  @IsEnum(TicketCategory)
  @IsOptional()
  category?: TicketCategory;

  @IsUUID()
  @IsOptional()
  shipmentId?: string;
}
