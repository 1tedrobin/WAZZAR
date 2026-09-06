import { LegStatus, LegType } from '../../database/entities/leg.entity';
import { ShipmentStatus } from '../../database/entities/shipment.entity';
import { deriveShipmentStatusForLegTransition } from './intercity-status.util';

describe('deriveShipmentStatusForLegTransition', () => {
  it('maps leg 1 (LOCAL) transitions to the pickup milestones', () => {
    expect(
      deriveShipmentStatusForLegTransition(1, 3, LegType.LOCAL, LegStatus.ASSIGNED),
    ).toBe(ShipmentStatus.ASSIGNED);
    expect(
      deriveShipmentStatusForLegTransition(1, 3, LegType.LOCAL, LegStatus.IN_PROGRESS),
    ).toBe(ShipmentStatus.PICKUP_IN_PROGRESS);
    expect(
      deriveShipmentStatusForLegTransition(1, 3, LegType.LOCAL, LegStatus.COMPLETED),
    ).toBe(ShipmentStatus.PICKED_UP);
  });

  it('maps leg 2 (TRUNK) departure to IN_TRANSIT and nothing else', () => {
    expect(
      deriveShipmentStatusForLegTransition(2, 3, LegType.TRUNK, LegStatus.IN_PROGRESS),
    ).toBe(ShipmentStatus.IN_TRANSIT);
    expect(
      deriveShipmentStatusForLegTransition(2, 3, LegType.TRUNK, LegStatus.ASSIGNED),
    ).toBeNull();
    expect(
      deriveShipmentStatusForLegTransition(2, 3, LegType.TRUNK, LegStatus.COMPLETED),
    ).toBeNull();
  });

  it('maps leg 3 (LOCAL) transitions to the final-delivery milestones', () => {
    expect(
      deriveShipmentStatusForLegTransition(3, 3, LegType.LOCAL, LegStatus.IN_PROGRESS),
    ).toBe(ShipmentStatus.OUT_FOR_DELIVERY);
    expect(
      deriveShipmentStatusForLegTransition(3, 3, LegType.LOCAL, LegStatus.COMPLETED),
    ).toBe(ShipmentStatus.DELIVERED);
  });

  it('returns null for a shape other than the current 3-leg model', () => {
    expect(
      deriveShipmentStatusForLegTransition(1, 5, LegType.LOCAL, LegStatus.ASSIGNED),
    ).toBeNull();
  });

  it('returns null for CANCELLED (no dedicated shipment milestone — cancellation is handled separately)', () => {
    expect(
      deriveShipmentStatusForLegTransition(1, 3, LegType.LOCAL, LegStatus.CANCELLED),
    ).toBeNull();
  });
});
