import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateRiderLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  // Device-reported GPS accuracy radius in meters, if the client sends it.
  // Purely informational for now — nothing filters/rejects low-accuracy
  // pings yet.
  @IsInt()
  @IsOptional()
  @Min(0)
  accuracyMeters?: number;
}
