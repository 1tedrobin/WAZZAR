import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class SubmitProofOfDeliveryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  recipientName: string;

  // No upload endpoint behind this yet (see ProofOfDelivery entity) — just
  // a URL a client already hosts the image at. Validated as a URL so at
  // least garbage strings don't land in the column, not because anything
  // downstream fetches or displays it yet.
  @IsUrl()
  @IsOptional()
  photoUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}
