import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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

// Every field optional — a PATCH only touches what's provided. Two
// things worth calling out because they're not obvious from the shape
// alone (see ScheduledDeliveriesService.update for the actual logic):
//
// - `active` is how the frontend's toggle switch works: flipping
//   PENDING/inactive -> active recomputes nextRunAt from *now*, not from
//   whenever it was last edited, so re-enabling a long-dormant schedule
//   doesn't immediately fire a backlog of "missed" runs.
// - Changing daysOfWeek or timeOfDay also recomputes nextRunAt from now
//   — editing a schedule's time always means "starting from when I
//   saved this edit," never silently keeping a stale next-run instant
//   computed under the old recurrence rule.
export class UpdateScheduledDeliveryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @IsOptional()
  name?: string;

  @ValidateNested()
  @Type(() => ScheduledLocationDto)
  @IsOptional()
  pickupLocation?: ScheduledLocationDto;

  @ValidateNested()
  @Type(() => ScheduledLocationDto)
  @IsOptional()
  dropoffLocation?: ScheduledLocationDto;

  @IsNumber()
  @IsOptional()
  packageWeightKg?: number;

  @IsString()
  @IsOptional()
  packageDescription?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  daysOfWeek?: number[];

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'timeOfDay must be a 24-hour "HH:mm" string, e.g. "09:00"',
  })
  @IsOptional()
  timeOfDay?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
