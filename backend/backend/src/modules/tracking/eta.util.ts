// Straight-line distance + a flat assumed average speed. This is a
// placeholder, not a real routing engine — Foundation 8 in
// WAZZAR_SYSTEM_ARCHITECTURE.md calls for Google Directions/Distance
// Matrix for real road-network ETAs, but there's no Maps API key
// configured anywhere in this repo yet. Good enough to show a plausible,
// moving ETA on a tracking screen; not something to expose as a delivery
// guarantee.
const EARTH_RADIUS_METERS = 6_371_000;
const ASSUMED_AVERAGE_SPEED_METERS_PER_SECOND = 8.3; // ~30 km/h — boda-boda in city traffic

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function estimateEtaSeconds(from: Coordinates, to: Coordinates): number {
  const distanceMeters = haversineDistanceMeters(from, to);
  return Math.round(distanceMeters / ASSUMED_AVERAGE_SPEED_METERS_PER_SECOND);
}
