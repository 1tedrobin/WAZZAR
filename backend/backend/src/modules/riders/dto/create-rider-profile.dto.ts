import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateRiderProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  vehicleType: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  vehicleRegistration: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  licenseNumber: string;

  // ISO date string, e.g. "2027-03-15" — matches the `date` column type.
  @IsDateString()
  @IsOptional()
  insuranceExpiresAt?: string;

  // URLs from POST /uploads (see modules/uploads/). All optional — a
  // rider can submit a profile and add documents afterward, but
  // RidersService.verify() (admin-only ACTIVE flip) should eventually
  // check these are present before approving; see the TODO on
  // RidersService.verify().
  @IsUrl()
  @IsOptional()
  idDocumentUrl?: string;

  @IsUrl()
  @IsOptional()
  licenseDocumentUrl?: string;

  @IsUrl()
  @IsOptional()
  vehicleRegistrationDocumentUrl?: string;

  @IsUrl()
  @IsOptional()
  insuranceDocumentUrl?: string;
}
