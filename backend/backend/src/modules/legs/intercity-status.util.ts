import { LegStatus, LegType } from '../../database/entities/leg.entity';
import { ShipmentStatus } from '../../database/entities/shipment.entity';

// Pure — no DB access, independently unit-tested (same pattern as
// mpesa-callback.util.ts / scheduled-delivery-recurrence.util.ts). Given
// a leg's position in the 3-leg intercity shape
// (1: LOCAL pickup->originHub, 2: TRUNK originHub->destinationHub,
// 3: LOCAL destinationHub->dropoff) and the status it just moved to,
// returns the parent Shipment's new status milestone, or null if this
// particular leg transition has no dedicated shipment-level milestone
// (e.g. a TRUNK leg being ASSIGNED doesn't move the needle — the
// shipment already reads PICKED_UP from leg 1 completing, and stays
// there until leg 2 actually departs).
//
// Every mapped status here is already a legal transition in
// shipment-status.transitions.ts's SHIPMENT_STATUS_TRANSITIONS — this
// function doesn't add any new Shipment statuses or edges, it just picks
// which existing one applies to an intercity leg event. LegsService still
// calls isValidShipmentStatusTransition before writing, same as
// ShipmentsService.updateStatus does, so a leg transition arriving in an
// unexpected order fails loudly instead of corrupting shipment.status.
//
// Deliberately specific to the always-3-leg shape
// LegsService.planIntercityShipment produces today, not a generic
// N-leg reducer — see docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md's
// "Known simplifications" for what a variable-leg-count relay shipment
// would need instead (not built in this pass).
export function deriveShipmentStatusForLegTransition(
  legSequence: number,
  legCount: number,
  legType: LegType,
  newLegStatus: LegStatus,
): ShipmentStatus | null {
  if (legCount !== 3) {
    return null;
  }

  if (legSequence === 1 && legType === LegType.LOCAL) {
    if (newLegStatus === LegStatus.ASSIGNED) return ShipmentStatus.ASSIGNED;
    if (newLegStatus === LegStatus.IN_PROGRESS) return ShipmentStatus.PICKUP_IN_PROGRESS;
    if (newLegStatus === LegStatus.COMPLETED) return ShipmentStatus.PICKED_UP;
  }

  if (legSequence === 2 && legType === LegType.TRUNK) {
    if (newLegStatus === LegStatus.IN_PROGRESS) return ShipmentStatus.IN_TRANSIT;
  }

  if (legSequence === 3 && legType === LegType.LOCAL) {
    if (newLegStatus === LegStatus.IN_PROGRESS) return ShipmentStatus.OUT_FOR_DELIVERY;
    if (newLegStatus === LegStatus.COMPLETED) return ShipmentStatus.DELIVERED;
  }

  return null;
}
