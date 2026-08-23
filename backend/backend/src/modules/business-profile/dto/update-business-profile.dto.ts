export class UpdateBusinessProfileDto {
  businessName?: string;
  category?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  pickupAddress?: string | null;
}
