import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { PricingMode, SurgeWindow } from '../../../database/entities/pricing-config.entity';

export class CreatePricingConfigDto {
  @IsEnum(PricingMode)
  pricingMode: PricingMode;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basePrice: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  pricePerKm?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  includedDistanceKm?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  pricePerKg?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  includedWeightKg?: number;

  // Must sum to 100 with riderPayoutPercent — checked in
  // PricingService.createConfig(), not here, since the rule spans two
  // fields (class-validator decorators only see one field at a time).
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  platformCommissionPercent: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  riderPayoutPercent: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  surgeMultiplier?: number;

  // e.g. [[8,11],[17,21]] — see SurgeWindow on the entity. Validated
  // structurally in the service (array-of-pairs, hours in 0-23) since
  // class-validator can't express "array of 2-tuples" declaratively.
  @IsArray()
  @ArrayMaxSize(12)
  @IsOptional()
  surgeActiveHours?: SurgeWindow[];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  // Defaults to now in the service if omitted.
  @IsISO8601()
  @IsOptional()
  effectiveFrom?: string;
}
