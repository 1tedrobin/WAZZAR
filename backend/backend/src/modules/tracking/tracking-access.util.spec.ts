import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { canAccessShipment } from './tracking-access.util';

const CUSTOMER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const RIDER_USER_ID = 'b5f3c111-0000-4000-8000-000000000002';
const OTHER_USER_ID = 'c5f3c111-0000-4000-8000-000000000003';
const RIDER_ID = 'd5f3c111-0000-4000-8000-000000000004';

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: 'shipment-1',
    customerId: CUSTOMER_ID,
    riderId: RIDER_ID,
    status: ShipmentStatus.IN_TRANSIT,
    ...overrides,
  } as Shipment;
}

function requester(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: OTHER_USER_ID, phone: '+255700000000', roles: [Role.CUSTOMER], ...overrides };
}

function rider(overrides: Partial<Rider> = {}): Rider {
  return {
    id: RIDER_ID,
    userId: RIDER_USER_ID,
    status: RiderStatus.ACTIVE,
    ...overrides,
  } as Rider;
}

describe('canAccessShipment', () => {
  it('allows the owning customer', () => {
    expect(canAccessShipment(shipment(), requester({ sub: CUSTOMER_ID }), null)).toBe(true);
  });

  it('allows an admin regardless of ownership', () => {
    const result = canAccessShipment(
      shipment(),
      requester({ sub: OTHER_USER_ID, roles: [Role.ADMIN] }),
      null,
    );
    expect(result).toBe(true);
  });

  it('allows the assigned rider', () => {
    const result = canAccessShipment(
      shipment(),
      requester({ sub: RIDER_USER_ID, roles: [Role.RIDER] }),
      rider(),
    );
    expect(result).toBe(true);
  });

  it('denies a rider whose profile does not match the assigned rider', () => {
    const result = canAccessShipment(
      shipment(),
      requester({ sub: RIDER_USER_ID, roles: [Role.RIDER] }),
      rider({ id: 'someone-elses-rider-id' }),
    );
    expect(result).toBe(false);
  });

  it('denies an unrelated customer', () => {
    expect(canAccessShipment(shipment(), requester(), null)).toBe(false);
  });

  it('denies a rider on an unassigned shipment even with a rider profile', () => {
    const result = canAccessShipment(
      shipment({ riderId: null }),
      requester({ sub: RIDER_USER_ID, roles: [Role.RIDER] }),
      rider(),
    );
    expect(result).toBe(false);
  });
});
