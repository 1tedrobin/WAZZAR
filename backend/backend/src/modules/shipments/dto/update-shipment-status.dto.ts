import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ShipmentStatus } from '../../../database/entities/shipment.entity';

export class UpdateShipmentStatusDto {
  @IsEnum(ShipmentStatus)
  status: ShipmentStatus;

  // Optional note for the audit trail (e.g. "customer requested cancellation").
  // Not required — most transitions won't need one.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
