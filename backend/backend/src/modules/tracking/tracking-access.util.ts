import { Rider } from '../../database/entities/rider.entity';
import { Shipment } from '../../database/entities/shipment.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN];

// Same rule as ShipmentsService's private assertCanAccess (owning
// customer, assigned rider, or admin) — duplicated rather than imported
// since that method is private to ShipmentsService, and this needs to run
// from two different callers (TrackingService/Controller for HTTP, and
// TrackingGateway for the WebSocket `subscribe` handler) that each look
// the caller's rider profile up themselves before calling this. Pure and
// synchronous on purpose: no repo access here, so it's trivial to unit test.
export function canAccessShipment(
  shipment: Shipment,
  requester: JwtPayload,
  callerRider: Rider | null,
): boolean {
  if (shipment.customerId === requester.sub) {
    return true;
  }
  if (requester.roles.some((role) => ADMIN_ROLES.includes(role))) {
    return true;
  }
  if (shipment.riderId && callerRider && callerRider.id === shipment.riderId) {
    return true;
  }
  return false;
}
