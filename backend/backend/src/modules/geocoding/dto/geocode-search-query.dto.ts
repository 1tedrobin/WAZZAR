import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GeocodeSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  q: string;

  // ISO 3166-1 alpha-2, e.g. "tz" — narrows results to one country.
  // Optional: WAZZAR is Tanzania-first today but architecturally
  // regional (see wazzar-project memory), so this isn't hardcoded.
  @IsString()
  @IsOptional()
  @MaxLength(2)
  countryCode?: string;
}
