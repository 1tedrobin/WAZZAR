// Public profile of a rider — what customers see during delivery tracking.
// Excludes sensitive fields like documents, bank info, verification status.
export class RiderPublicProfileDto {
  id: string;
  name: string;
  vehicleType: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  isOnline: boolean;
}
