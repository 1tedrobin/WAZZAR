import { ShipmentStatus } from '../../database/entities/shipment.entity';
import {
  isValidShipmentStatusTransition,
  SHIPMENT_STATUS_TIMESTAMP_FIELD,
  SHIPMENT_STATUS_TRANSITIONS,
} from './shipment-status.transitions';

describe('isValidShipmentStatusTransition', () => {
  it('allows each documented step along the happy path', () => {
    const happyPath = [
      ShipmentStatus.CREATED,
      ShipmentStatus.QUOTED,
      ShipmentStatus.CONFIRMED,
      ShipmentStatus.ASSIGNMENT_PENDING,
      ShipmentStatus.ASSIGNED,
      ShipmentStatus.PICKUP_IN_PROGRESS,
      ShipmentStatus.PICKED_UP,
      ShipmentStatus.IN_TRANSIT,
      ShipmentStatus.OUT_FOR_DELIVERY,
      ShipmentStatus.DELIVERED,
      ShipmentStatus.COMPLETED,
    ];

    for (let i = 0; i < happyPath.length - 1; i++) {
      expect(isValidShipmentStatusTransition(happyPath[i], happyPath[i + 1])).toBe(
        true,
      );
    }
  });

  it('allows cancellation from every non-terminal status', () => {
    const nonTerminal = Object.values(ShipmentStatus).filter(
      (s) => s !== ShipmentStatus.COMPLETED && s !== ShipmentStatus.CANCELLED,
    );

    for (const status of nonTerminal) {
      expect(isValidShipmentStatusTransition(status, ShipmentStatus.CANCELLED)).toBe(
        true,
      );
    }
  });

  it('rejects skipping a step', () => {
    expect(
      isValidShipmentStatusTransition(ShipmentStatus.CREATED, ShipmentStatus.ASSIGNED),
    ).toBe(false);
    expect(
      isValidShipmentStatusTransition(
        ShipmentStatus.CONFIRMED,
        ShipmentStatus.PICKED_UP,
      ),
    ).toBe(false);
  });

  it('rejects moving backwards', () => {
    expect(
      isValidShipmentStatusTransition(ShipmentStatus.IN_TRANSIT, ShipmentStatus.PICKED_UP),
    ).toBe(false);
  });

  it('treats COMPLETED and CANCELLED as terminal — nothing leaves them', () => {
    for (const target of Object.values(ShipmentStatus)) {
      expect(
        isValidShipmentStatusTransition(ShipmentStatus.COMPLETED, target),
      ).toBe(false);
      expect(
        isValidShipmentStatusTransition(ShipmentStatus.CANCELLED, target),
      ).toBe(false);
    }
  });

  it('has a transition table entry for every status', () => {
    // Catches the case where a new ShipmentStatus is added to the enum
    // but someone forgets to add it to the transition map.
    for (const status of Object.values(ShipmentStatus)) {
      expect(SHIPMENT_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('SHIPMENT_STATUS_TIMESTAMP_FIELD', () => {
  it('only maps statuses that have a matching timestamp column', () => {
    expect(SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.ASSIGNED]).toBe(
      'assignedAt',
    );
    expect(SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.PICKED_UP]).toBe(
      'pickedUpAt',
    );
    expect(SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.DELIVERED]).toBe(
      'deliveredAt',
    );
    expect(SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.COMPLETED]).toBe(
      'completedAt',
    );
  });

  it('has no entry for statuses without a dedicated timestamp column', () => {
    expect(SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.QUOTED]).toBeUndefined();
    expect(SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.CONFIRMED]).toBeUndefined();
    expect(
      SHIPMENT_STATUS_TIMESTAMP_FIELD[ShipmentStatus.ASSIGNMENT_PENDING],
    ).toBeUndefined();
  });
});
