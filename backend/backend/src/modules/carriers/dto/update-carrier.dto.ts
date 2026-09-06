import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CarrierStatus, CarrierVehicleType } from '../../../database/entities/carrier.entity';
import { CarrierRouteDto } from './create-carrier.dto';

export class UpdateCarrierDto {
  @IsEnum(CarrierVehicleType)
  @IsOptional()
  vehicleType?: CarrierVehicleType;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsOptional()
  registration?: string;

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

  @IsEnum(CarrierStatus)
  @IsOptional()
  status?: CarrierStatus;
}
