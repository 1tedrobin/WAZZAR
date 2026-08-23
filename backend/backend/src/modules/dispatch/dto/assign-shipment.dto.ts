import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignShipmentDto {
  @IsUUID()
  riderId: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
