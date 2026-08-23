import { ShipmentStatus } from '../../database/entities/shipment.entity';

// Which statuses a shipment is allowed to move to, from a given status.
// CANCELLED is reachable from every non-terminal state (a customer or
// dispatcher can cancel at almost any point before delivery); COMPLETED
// and CANCELLED are terminal — nothing can leave them.
export const SHIPMENT_STATUS_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.CREATED]: [ShipmentStatus.QUOTED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.QUOTED]: [ShipmentStatus.CONFIRMED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.CONFIRMED]: [
    ShipmentStatus.ASSIGNMENT_PENDING,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.ASSIGNMENT_PENDING]: [
    ShipmentStatus.ASSIGNED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.ASSIGNED]: [
    ShipmentStatus.PICKUP_IN_PROGRESS,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.PICKUP_IN_PROGRESS]: [
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.PICKED_UP]: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
  [ShipmentStatus.IN_TRANSIT]: [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.OUT_FOR_DELIVERY]: [
    ShipmentStatus.DELIVERED,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.DELIVERED]: [ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.COMPLETED]: [],
  [ShipmentStatus.CANCELLED]: [],
};

export function isValidShipmentStatusTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): boolean {
  return SHIPMENT_STATUS_TRANSITIONS[from].includes(to);
}

// Timestamp column to stamp when a shipment lands on a given status.
// Only statuses that have a matching column in the shipments table are
// listed here — the rest (QUOTED, CONFIRMED, etc.) have no dedicated column.
export const SHIPMENT_STATUS_TIMESTAMP_FIELD: Partial<
  Record<ShipmentStatus, 'assignedAt' | 'pickedUpAt' | 'deliveredAt' | 'completedAt'>
> = {
  [ShipmentStatus.ASSIGNED]: 'assignedAt',
  [ShipmentStatus.PICKED_UP]: 'pickedUpAt',
  [ShipmentStatus.DELIVERED]: 'deliveredAt',
  [ShipmentStatus.COMPLETED]: 'completedAt',
};
