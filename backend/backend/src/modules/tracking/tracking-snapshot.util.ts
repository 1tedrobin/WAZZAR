import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { estimateEtaSeconds } from './eta.util';

// Statuses where the rider has already collected the package — ETA should
// point at the dropoff from here on, not back at the pickup.
const POST_PICKUP_STATUSES = new Set<ShipmentStatus>([
  ShipmentStatus.PICKED_UP,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
]);

export interface TrackingSnapshot {
  shipmentId: string;
  status: ShipmentStatus;
  riderLocation: {
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
  } | null;
  pickupLocation: Shipment['pickupLocation'];
  dropoffLocation: Shipment['dropoffLocation'];
  etaSeconds: number | null;
  lastUpdated: Date | null;
}

// Pure — takes the shipment and (already-fetched) location, no repo
// access — so both TrackingService (REST) and TrackingGateway (WebSocket)
// can build the exact same payload shape without depending on each other.
export function buildTrackingSnapshot(
  shipment: Shipment,
  location: RiderLocation | null,
): TrackingSnapshot {
  let riderLocation: TrackingSnapshot['riderLocation'] = null;
  let etaSeconds: number | null = null;

  if (location) {
    riderLocation = {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracyMeters: location.accuracyMeters,
    };

    const destination = POST_PICKUP_STATUSES.has(shipment.status)
      ? shipment.dropoffLocation
      : shipment.pickupLocation;

    etaSeconds = estimateEtaSeconds(riderLocation, destination);
  }

  return {
    shipmentId: shipment.id,
    status: shipment.status,
    riderLocation,
    pickupLocation: shipment.pickupLocation,
    dropoffLocation: shipment.dropoffLocation,
    etaSeconds,
    lastUpdated: location?.updatedAt ?? null,
  };
}
