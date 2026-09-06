import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CarrierVehicleType } from '../../../database/entities/carrier.entity';

export class CarrierRouteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fromCity: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  toCity: string;
}

export class CreateCarrierDto {
  @IsUUID()
  partnerOperatorId: string;

  @IsEnum(CarrierVehicleType)
  vehicleType: CarrierVehicleType;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  registration: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  capacityKg?: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CarrierRouteDto)
  @IsOptional()
  routes?: CarrierRouteDto[];

  @IsOptional()
  schedule?: Record<string, unknown>;
}
