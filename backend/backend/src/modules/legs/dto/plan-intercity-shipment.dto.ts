import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { LocationDto } from '../../shipments/dto/create-shipment.dto';

export class PlanIntercityShipmentDto {
  @ValidateNested()
  @Type(() => LocationDto)
  pickupLocation: LocationDto;

  @ValidateNested()
  @Type(() => LocationDto)
  dropoffLocation: LocationDto;

  @IsUUID()
  originHubId: string;

  @IsUUID()
  destinationHubId: string;

  @IsNumber()
  @IsOptional()
  packageWeightKg?: number;

  @IsString()
  @IsOptional()
  packageDescription?: string;
}
