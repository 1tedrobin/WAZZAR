import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LocationDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsOptional()
  instruction?: string;
}

export class CreateShipmentDto {
  @ValidateNested()
  @Type(() => LocationDto)
  pickupLocation: LocationDto;

  @ValidateNested()
  @Type(() => LocationDto)
  dropoffLocation: LocationDto;

  @IsNumber()
  @IsOptional()
  packageWeightKg?: number;

  @IsString()
  @IsOptional()
  packageDescription?: string;
}
