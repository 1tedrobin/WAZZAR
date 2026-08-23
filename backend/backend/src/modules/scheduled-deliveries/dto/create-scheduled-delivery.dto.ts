import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Same shape as shipments/dto/create-shipment.dto.ts's LocationDto —
// deliberately duplicated rather than imported, so this module doesn't
// take a compile-time dependency on ShipmentsModule's DTO folder for
// what is otherwise an unrelated module boundary. ScheduledDeliveriesService
// still depends on ShipmentsService directly (that's a real, intentional
// coupling — see the service); this DTO just happens to describe the
// same fields.
class ScheduledLocationDto {
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

export class CreateScheduledDeliveryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @ValidateNested()
  @Type(() => ScheduledLocationDto)
  pickupLocation: ScheduledLocationDto;

  @ValidateNested()
  @Type(() => ScheduledLocationDto)
  dropoffLocation: ScheduledLocationDto;

  @IsNumber()
  @IsOptional()
  packageWeightKg?: number;

  @IsString()
  @IsOptional()
  packageDescription?: string;

  // 0 = Sunday ... 6 = Saturday, matching Date#getUTCDay() — see the
  // recurrence util. At least one day, at most seven (there's nothing
  // to validate against duplicates beyond that — a duplicate day is
  // harmless, computeNextRunAt just checks membership).
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek: number[];

  // 24-hour "HH:mm" — kept as a plain validated string rather than a
  // Date so the client never has to think about timezones; the
  // recurrence util is the one place that interprets it (always as
  // EAT — see that file's header comment).
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'timeOfDay must be a 24-hour "HH:mm" string, e.g. "09:00"',
  })
  timeOfDay: string;
}
