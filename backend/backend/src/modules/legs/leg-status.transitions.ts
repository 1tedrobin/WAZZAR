import { LegStatus } from '../../database/entities/leg.entity';

// PENDING -> ASSIGNED happens only via LegsService.assignRider/
// assignCarrier's own conditional UPDATE (same "dedicated atomic action
// for the claim transition" reasoning as Shipment's ASSIGNED status —
// see shipment-status.transitions.ts and ShipmentsService.assign) — not
// reachable through LegsService.advanceLegStatus, which only handles
// ASSIGNED -> IN_PROGRESS -> COMPLETED and any non-terminal -> CANCELLED.
export const LEG_STATUS_TRANSITIONS: Record<LegStatus, LegStatus[]> = {
  [LegStatus.PENDING]: [LegStatus.ASSIGNED, LegStatus.CANCELLED],
  [LegStatus.ASSIGNED]: [LegStatus.IN_PROGRESS, LegStatus.CANCELLED],
  [LegStatus.IN_PROGRESS]: [LegStatus.COMPLETED, LegStatus.CANCELLED],
  [LegStatus.COMPLETED]: [],
  [LegStatus.CANCELLED]: [],
};

export function isValidLegStatusTransition(from: LegStatus, to: LegStatus): boolean {
  return LEG_STATUS_TRANSITIONS[from].includes(to);
}
