import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SupportedCurrency } from '../../../common/currency';

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
  // Which market to price and quote this shipment in. Deliberately no
  // `= DEFAULT_CURRENCY` initializer — omitted must stay `undefined`
  // after transform, not silently become 'TZS', so ShipmentsService can
  // tell "no preference given" apart from "explicitly TZS" and fall back
  // to the requesting customer's registered market (see
  // src/common/market.ts) instead of a hardcoded one. A caller that
  // wants to override their own market's default can still pass this
  // explicitly.
  @IsEnum(SupportedCurrency)
  @IsOptional()
  currency?: SupportedCurrency;

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
