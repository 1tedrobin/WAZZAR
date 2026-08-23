import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ShipmentStatus } from '../../../database/entities/shipment.entity';

// customerId no longer lives here — it comes from req.user.id (see
// ShipmentsController), so a caller can only ever list their own
// shipments. An admin-only "list everything" endpoint is a separate,
// role-gated route, not a param on this one.
export class ListShipmentsQueryDto {
  @IsEnum(ShipmentStatus)
  @IsOptional()
  status?: ShipmentStatus;

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
