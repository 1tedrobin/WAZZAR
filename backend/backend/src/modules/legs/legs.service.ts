import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { CarrierStatus } from '../../database/entities/carrier.entity';
import { Hub } from '../../database/entities/hub.entity';
import { Leg, LegStatus, LegType } from '../../database/entities/leg.entity';
import { PartnerOperator } from '../../database/entities/partner-operator.entity';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import {
  LocationPoint,
  Shipment,
  ShipmentStatus,
  ShipmentType,
} from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import {
  TrackingEvent,
  TrackingEventType,
} from '../../database/entities/tracking-event.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { CarriersService } from '../carriers/carriers.service';
import { HubsService } from '../hubs/hubs.service';
import { PricingService } from '../pricing/pricing.service';
import { ShipmentsService } from '../shipments/shipments.service';
import {
  isValidShipmentStatusTransition,
  SHIPMENT_STATUS_TIMESTAMP_FIELD,
} from '../shipments/shipment-status.transitions';
import { haversineDistanceMeters } from '../tracking/eta.util';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { AssignCarrierLegDto } from './dto/assign-carrier-leg.dto';
import { AssignRiderLegDto } from './dto/assign-rider-leg.dto';
import { PlanIntercityShipmentDto } from './dto/plan-intercity-shipment.dto';
import { deriveShipmentStatusForLegTransition } from './intercity-status.util';
import { isValidLegStatusTransition } from './leg-status.transitions';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN];

export interface IntercityShipmentPlan {
  shipment: Shipment;
  legs: Leg[];
}

export interface PendingLegQueue {
  pendingLocalLegs: Leg[];
  pendingTrunkLegs: Leg[];
}

export interface ActiveLegQueue {
  activeLocalLegs: Leg[];
  activeTrunkLegs: Leg[];
}

// The core of Phase 2 (Intercity/Trunk Network): plans a 3-leg intercity
// shipment (LOCAL pickup->hub, TRUNK hub->hub, LOCAL hub->dropoff), then
// drives each leg's PENDING -> ASSIGNED -> IN_PROGRESS -> COMPLETED
// lifecycle, cascading the meaningful transitions back onto the parent
// Shipment's existing status machine (see intercity-status.util.ts) so
// nothing downstream of `shipments` (payments, ratings, the customer
// tracking screen) needs to know or care that a shipment is INTERCITY
// rather than LOCAL.
//
// Scoping decision for this pass: every leg-assignment and
// status-advance action here is DISPATCHER/ADMIN/SUPER_ADMIN-only (see
// assertDispatcherHubAccess) — there is no rider/carrier self-service
// leg claim or self-reported status update yet, unlike Phase 1's
// ShipmentsService.assign()/submitProofOfDelivery(). A real driver-facing
// self-service flow (mirroring how Phase 1 started dispatcher-only
// before rider self-claim was added — see dispatch.service.ts's header
// comment) is flagged as a follow-up in
// docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md, not built here.
@Injectable()
export class LegsService {
  constructor(
    @InjectRepository(Leg)
    private readonly legsRepo: Repository<Leg>,
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    @InjectRepository(ShipmentStatusHistory)
    private readonly statusHistoryRepo: Repository<ShipmentStatusHistory>,
    @InjectRepository(TrackingEvent)
    private readonly trackingEventsRepo: Repository<TrackingEvent>,
    @InjectRepository(Rider)
    private readonly ridersRepo: Repository<Rider>,
    private readonly hubsService: HubsService,
    private readonly carriersService: CarriersService,
    private readonly pricingService: PricingService,
    // Only for the access-checked read in getLegs() — every write in
    // this service manages `shipments` directly via shipmentsRepo (see
    // header comment: LegsService needs transactional/legCount-aware
    // control ShipmentsService doesn't expose), the same
    // "inject the repo directly for writes, the service for reads"
    // split DispatchService/TrackingService already use for Shipment.
    private readonly shipmentsService: ShipmentsService,
    private readonly gateway: TrackingGateway,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // POST /shipments/intercity
  async planIntercityShipment(
    dto: PlanIntercityShipmentDto,
    customerId: string,
  ): Promise<IntercityShipmentPlan> {
    const originHub = await this.hubsService.findOne(dto.originHubId);
    const destinationHub = await this.hubsService.findOne(dto.destinationHubId);

    if (originHub.id === destinationHub.id) {
      throw new ConflictException('Origin and destination hubs must be different');
    }

    const originPoint = this.hubToLocationPoint(originHub);
    const destinationPoint = this.hubToLocationPoint(destinationHub);

    // Straight-line, same caveat as ShipmentsService.create's own
    // distance estimate (see tracking/eta.util.ts) — summed across all
    // three legs to get a total for pricing. This reuses Phase 1's own
    // per-km/per-kg rate card wholesale rather than a separate
    // intercity pricing model with real trunk-leg carrier cost and
    // partner revenue-share economics — a deliberate stand-in, not a
    // finished intercity pricing engine. Flagged in
    // PHASE2_INTERCITY_FOUNDATION.md as a follow-up.
    const totalDistanceKm =
      (haversineDistanceMeters(dto.pickupLocation, originPoint) +
        haversineDistanceMeters(originPoint, destinationPoint) +
        haversineDistanceMeters(destinationPoint, dto.dropoffLocation)) /
      1000;

    const quote = await this.pricingService.calculatePrice({
      distanceKm: totalDistanceKm,
      weightKg: dto.packageWeightKg,
    });

    return this.dataSource.transaction(async (manager) => {
      const shipmentsRepo = manager.getRepository(Shipment);
      const legsRepo = manager.getRepository(Leg);
      const historyRepo = manager.getRepository(ShipmentStatusHistory);

      const shipment = shipmentsRepo.create({
        customerId,
        status: ShipmentStatus.QUOTED,
        shipmentType: ShipmentType.INTERCITY,
        legCount: 3,
        currentLeg: 1,
        pickupLocation: dto.pickupLocation,
        dropoffLocation: dto.dropoffLocation,
        packageWeightKg:
          dto.packageWeightKg !== undefined ? dto.packageWeightKg.toString() : null,
        packageDescription: dto.packageDescription ?? null,
        price: quote.price,
        commission: quote.commission,
        riderPayout: quote.riderPayout,
      });
      const savedShipment = await shipmentsRepo.save(shipment);

      const legDefinitions: Array<Partial<Leg>> = [
        {
          legType: LegType.LOCAL,
          sequence: 1,
          fromLocation: dto.pickupLocation,
          toLocation: originPoint,
          fromHubId: null,
          toHubId: originHub.id,
        },
        {
          legType: LegType.TRUNK,
          sequence: 2,
          fromLocation: originPoint,
          toLocation: destinationPoint,
          fromHubId: originHub.id,
          toHubId: destinationHub.id,
        },
        {
          legType: LegType.LOCAL,
          sequence: 3,
          fromLocation: destinationPoint,
          toLocation: dto.dropoffLocation,
          fromHubId: destinationHub.id,
          toHubId: null,
        },
      ];

      const legs = await legsRepo.save(
        legDefinitions.map((def) =>
          legsRepo.create({ ...def, shipmentId: savedShipment.id, status: LegStatus.PENDING }),
        ),
      );

      // Same two-row CREATED-then-QUOTED history as
      // ShipmentsService.create — see that method's comment.
      await historyRepo.save(
        historyRepo.create({
          shipmentId: savedShipment.id,
          status: ShipmentStatus.CREATED,
          changedBy: customerId,
          reason: null,
        }),
      );
      await historyRepo.save(
        historyRepo.create({
          shipmentId: savedShipment.id,
          status: ShipmentStatus.QUOTED,
          changedBy: customerId,
          reason: `Priced at ${quote.price} across ${legs.length} legs (pricing config ${quote.pricingConfigId})`,
        }),
      );

      return { shipment: savedShipment, legs };
    });
  }

  // GET /shipments/:id/legs — same access rule as the shipment itself
  // (owning customer, assigned rider — n/a here, or admin); reuses
  // ShipmentsService.findOne so that rule lives in exactly one place.
  async getLegs(shipmentId: string, requester: JwtPayload): Promise<Leg[]> {
    await this.shipmentsService.findOne(shipmentId, requester);
    return this.legsRepo.find({ where: { shipmentId }, order: { sequence: 'ASC' } });
  }

  // GET /legs/pending — the admin app's Dispatch page (Phase 2 section).
  // ADMIN/SUPER_ADMIN see every pending leg; a DISPATCHER only sees legs
  // that touch a hub they're assigned to (see HubsService.findAssignedHubIds).
  async getPendingQueue(requester: JwtPayload): Promise<PendingLegQueue> {
    const assignedHubIds = await this.resolveAssignedHubIds(requester);
    if (assignedHubIds && assignedHubIds.length === 0) {
      return { pendingLocalLegs: [], pendingTrunkLegs: [] };
    }

    const pending = await this.legsRepo.find({
      where: { status: LegStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
    const scoped = this.scopeLegsToHubs(pending, assignedHubIds);

    return {
      pendingLocalLegs: scoped.filter((leg) => leg.legType === LegType.LOCAL),
      pendingTrunkLegs: scoped.filter((leg) => leg.legType === LegType.TRUNK),
    };
  }

  // GET /legs/active — legs already ASSIGNED or IN_PROGRESS, for the
  // dispatcher to advance (start/complete) or cancel. Split into its own
  // method/endpoint rather than widening getPendingQueue's own status
  // filter, so "pending" keeps meaning exactly what it already did —
  // additive, not a change to something already shipped. Same
  // hub-scoping as getPendingQueue.
  async getActiveQueue(requester: JwtPayload): Promise<ActiveLegQueue> {
    const assignedHubIds = await this.resolveAssignedHubIds(requester);
    if (assignedHubIds && assignedHubIds.length === 0) {
      return { activeLocalLegs: [], activeTrunkLegs: [] };
    }

    const active = await this.legsRepo.find({
      where: { status: In([LegStatus.ASSIGNED, LegStatus.IN_PROGRESS]) },
      order: { assignedAt: 'ASC' },
    });
    const scoped = this.scopeLegsToHubs(active, assignedHubIds);

    return {
      activeLocalLegs: scoped.filter((leg) => leg.legType === LegType.LOCAL),
      activeTrunkLegs: scoped.filter((leg) => leg.legType === LegType.TRUNK),
    };
  }

  // null = no scoping (caller is ADMIN/SUPER_ADMIN); [] = a DISPATCHER
  // assigned to zero hubs (getPendingQueue/getActiveQueue both treat
  // that as "nothing to show" without a wasted legsRepo.find call).
  private async resolveAssignedHubIds(requester: JwtPayload): Promise<string[] | null> {
    const isAdmin = requester.roles.some((role) => ADMIN_ROLES.includes(role));
    if (isAdmin) {
      return null;
    }
    return this.hubsService.findAssignedHubIds(requester.sub);
  }

  private scopeLegsToHubs(legs: Leg[], assignedHubIds: string[] | null): Leg[] {
    if (!assignedHubIds) {
      return legs;
    }
    return legs.filter(
      (leg) =>
        (leg.fromHubId && assignedHubIds.includes(leg.fromHubId)) ||
        (leg.toHubId && assignedHubIds.includes(leg.toHubId)),
    );
  }

  // POST /legs/:id/assign-rider
  async assignRider(
    legId: string,
    dto: AssignRiderLegDto,
    requester: JwtPayload,
  ): Promise<Leg> {
    const leg = await this.findLegOrThrow(legId);
    if (leg.legType !== LegType.LOCAL) {
      throw new ConflictException(
        'Only LOCAL legs can be assigned a rider — use assign-carrier for TRUNK legs',
      );
    }
    await this.assertDispatcherHubAccess(leg, requester);

    const rider = await this.ridersRepo.findOne({ where: { id: dto.riderId } });
    if (!rider) {
      throw new NotFoundException(`Rider ${dto.riderId} not found`);
    }
    // Same ACTIVE + online requirement as DispatchService.assign().
    if (rider.status !== RiderStatus.ACTIVE || !rider.isOnline) {
      throw new ForbiddenException('Rider must be ACTIVE and online to be assigned a leg');
    }

    // Same race-safe conditional UPDATE pattern as
    // DispatchService.assignInternal / ShipmentsService.assign.
    const result = await this.legsRepo.update(
      { id: legId, status: LegStatus.PENDING, riderId: IsNull() },
      { status: LegStatus.ASSIGNED, riderId: rider.id, assignedAt: new Date() },
    );
    if (result.affected === 0) {
      const current = await this.legsRepo.findOne({ where: { id: legId } });
      throw new ConflictException(
        current?.riderId
          ? 'This leg has already been assigned'
          : `Leg must be PENDING to assign (currently ${current?.status})`,
      );
    }

    const updated = await this.findLegOrThrow(legId);
    await this.cascadeToShipment(updated, LegStatus.ASSIGNED, requester.sub);
    await this.recordTrackingEvent(legId, TrackingEventType.STATUS_CHANGE, {
      status: 'ASSIGNED',
      riderId: rider.id,
    });
    this.broadcastLegUpdate(updated);
    return updated;
  }

  // POST /legs/:id/assign-carrier
  async assignCarrier(
    legId: string,
    dto: AssignCarrierLegDto,
    requester: JwtPayload,
  ): Promise<Leg> {
    const leg = await this.findLegOrThrow(legId);
    if (leg.legType !== LegType.TRUNK) {
      throw new ConflictException(
        'Only TRUNK legs can be assigned a carrier — use assign-rider for LOCAL legs',
      );
    }
    await this.assertDispatcherHubAccess(leg, requester);

    const carrier = await this.carriersService.findOne(dto.carrierId);
    if (carrier.status !== CarrierStatus.ACTIVE) {
      throw new ForbiddenException('Carrier must be ACTIVE to be assigned a leg');
    }

    const result = await this.legsRepo.update(
      { id: legId, status: LegStatus.PENDING, carrierId: IsNull() },
      { status: LegStatus.ASSIGNED, carrierId: carrier.id, assignedAt: new Date() },
    );
    if (result.affected === 0) {
      const current = await this.legsRepo.findOne({ where: { id: legId } });
      throw new ConflictException(
        current?.carrierId
          ? 'This leg has already been assigned'
          : `Leg must be PENDING to assign (currently ${current?.status})`,
      );
    }

    const updated = await this.findLegOrThrow(legId);
    await this.cascadeToShipment(updated, LegStatus.ASSIGNED, requester.sub);
    await this.recordTrackingEvent(legId, TrackingEventType.STATUS_CHANGE, {
      status: 'ASSIGNED',
      carrierId: carrier.id,
    });
    this.broadcastLegUpdate(updated);
    return updated;
  }

  // POST /legs/:id/start
  async startLeg(legId: string, requester: JwtPayload): Promise<Leg> {
    return this.advanceStatus(legId, LegStatus.IN_PROGRESS, requester);
  }

  // POST /legs/:id/complete
  async completeLeg(legId: string, requester: JwtPayload): Promise<Leg> {
    return this.advanceStatus(legId, LegStatus.COMPLETED, requester);
  }

  // POST /legs/:id/cancel — cancels this leg AND every other non-terminal
  // sibling leg AND the parent shipment. Simplification: this pass has
  // no reroute/redo-leg flow, so a single leg failing (a bus breaks
  // down, a rider can't complete pickup) takes the whole intercity job
  // down with it rather than attempting to recover mid-route. Flagged
  // in PHASE2_INTERCITY_FOUNDATION.md as a follow-up.
  async cancelLeg(legId: string, requester: JwtPayload): Promise<Leg> {
    return this.advanceStatus(legId, LegStatus.CANCELLED, requester);
  }

  private async advanceStatus(
    legId: string,
    nextStatus: LegStatus,
    requester: JwtPayload,
  ): Promise<Leg> {
    const leg = await this.findLegOrThrow(legId);
    await this.assertDispatcherHubAccess(leg, requester);

    if (!isValidLegStatusTransition(leg.status, nextStatus)) {
      throw new ConflictException(`Cannot move leg from ${leg.status} to ${nextStatus}`);
    }

    leg.status = nextStatus;
    if (nextStatus === LegStatus.COMPLETED) {
      leg.completedAt = new Date();
    }
    const saved = await this.legsRepo.save(leg);

    await this.afterLegStatusChange(saved, nextStatus, requester.sub);
    return saved;
  }

  // POST /legs/:id/self-claim — a rider claiming a PENDING LOCAL leg
  // themselves, mirroring ShipmentsService.assign()'s Phase 1 self-claim
  // (same ACTIVE + online requirement, same race-safe conditional
  // UPDATE). Known gap, flagged not hidden: unlike a real multi-hub
  // network probably wants, this doesn't scope which riders can see or
  // claim which leg by geography — any ACTIVE, online rider anywhere can
  // claim any PENDING LOCAL leg system-wide. Phase 1 has the exact same
  // openness (a single-city deployment made it moot there); closing this
  // for Phase 2 needs a "rider's current city/hub" concept this codebase
  // doesn't have yet — see PHASE2_INTERCITY_FOUNDATION.md.
  async selfClaimLocalLeg(legId: string, riderUserId: string): Promise<Leg> {
    const rider = await this.ridersRepo.findOne({ where: { userId: riderUserId } });
    if (!rider) {
      throw new NotFoundException('No rider profile for this account yet');
    }
    if (rider.status !== RiderStatus.ACTIVE || !rider.isOnline) {
      throw new ForbiddenException('Rider must be ACTIVE and online to claim a leg');
    }

    const leg = await this.findLegOrThrow(legId);
    if (leg.legType !== LegType.LOCAL) {
      throw new ConflictException('Only LOCAL legs can be self-claimed by a rider');
    }

    const result = await this.legsRepo.update(
      { id: legId, status: LegStatus.PENDING, riderId: IsNull() },
      { status: LegStatus.ASSIGNED, riderId: rider.id, assignedAt: new Date() },
    );
    if (result.affected === 0) {
      const current = await this.legsRepo.findOne({ where: { id: legId } });
      throw new ConflictException(
        current?.riderId
          ? 'This leg has already been claimed'
          : `Leg must be PENDING to claim (currently ${current?.status})`,
      );
    }

    const updated = await this.findLegOrThrow(legId);
    await this.afterLegStatusChange(updated, LegStatus.ASSIGNED, riderUserId);
    return updated;
  }

  // POST /legs/:id/self-start, /legs/:id/self-complete — the rider
  // assigned to a LOCAL leg advancing it themselves. Same
  // conditional-UPDATE-keyed-by-the-assigned-party pattern as
  // ShipmentsService.submitProofOfDelivery, generalized to cover both
  // transitions (ASSIGNED->IN_PROGRESS and IN_PROGRESS->COMPLETED) in
  // one method instead of two near-duplicates.
  //
  // Real gap, flagged not hidden: unlike submitProofOfDelivery, this
  // does NOT capture proof-of-delivery evidence (photo/signature) even
  // when completing the final leg (sequence === shipment.legCount) —
  // the actual customer-facing delivery event. Phase 1 requires that
  // evidence for every LOCAL shipment; an intercity shipment's final
  // leg arguably should too. Not built here — see
  // PHASE2_INTERCITY_FOUNDATION.md.
  async selfAdvanceLocalLeg(
    legId: string,
    riderUserId: string,
    nextStatus: LegStatus,
  ): Promise<Leg> {
    const rider = await this.ridersRepo.findOne({ where: { userId: riderUserId } });
    if (!rider) {
      throw new NotFoundException('No rider profile for this account yet');
    }

    const leg = await this.findLegOrThrow(legId);
    if (leg.legType !== LegType.LOCAL) {
      throw new ConflictException('Only LOCAL legs support rider self-service');
    }
    if (!isValidLegStatusTransition(leg.status, nextStatus)) {
      throw new ConflictException(`Cannot move leg from ${leg.status} to ${nextStatus}`);
    }

    const result = await this.legsRepo.update(
      { id: legId, status: leg.status, riderId: rider.id },
      {
        status: nextStatus,
        ...(nextStatus === LegStatus.COMPLETED ? { completedAt: new Date() } : {}),
      },
    );
    if (result.affected === 0) {
      const current = await this.legsRepo.findOne({ where: { id: legId } });
      if (current?.riderId !== rider.id) {
        throw new ForbiddenException('Only the rider assigned to this leg can update it');
      }
      throw new ConflictException(`Cannot move leg from ${current.status} to ${nextStatus}`);
    }

    const updated = await this.findLegOrThrow(legId);
    await this.afterLegStatusChange(updated, nextStatus, riderUserId);
    return updated;
  }

  // POST /legs/:id/carrier-start, /legs/:id/carrier-complete — a partner
  // operator's own system (PartnerApiKeyGuard, not a WAZZAR user JWT)
  // advancing its own carrier's TRUNK leg. Same shape as
  // selfAdvanceLocalLeg above; "ownership" is leg.carrierId belonging to
  // the calling operator (same check as
  // TrackingChannelsService.ingestPartnerPing) instead of leg.riderId
  // belonging to the calling rider.
  async carrierAdvanceTrunkLeg(
    legId: string,
    partnerOperator: PartnerOperator,
    nextStatus: LegStatus,
  ): Promise<Leg> {
    const leg = await this.findLegOrThrow(legId);
    if (leg.legType !== LegType.TRUNK || !leg.carrierId) {
      throw new ConflictException('Only an assigned TRUNK leg supports this action');
    }

    const carrier = await this.carriersService.findOne(leg.carrierId);
    if (carrier.partnerOperatorId !== partnerOperator.id) {
      throw new ForbiddenException('This leg is not assigned to one of your carriers');
    }
    if (!isValidLegStatusTransition(leg.status, nextStatus)) {
      throw new ConflictException(`Cannot move leg from ${leg.status} to ${nextStatus}`);
    }

    const result = await this.legsRepo.update(
      { id: legId, status: leg.status, carrierId: leg.carrierId },
      {
        status: nextStatus,
        ...(nextStatus === LegStatus.COMPLETED ? { completedAt: new Date() } : {}),
      },
    );
    if (result.affected === 0) {
      const current = await this.legsRepo.findOne({ where: { id: legId } });
      throw new ConflictException(`Cannot move leg from ${current?.status} to ${nextStatus}`);
    }

    const updated = await this.findLegOrThrow(legId);
    await this.afterLegStatusChange(updated, nextStatus, partnerOperator.id);
    return updated;
  }

  // Shared tail for every leg-status-changing action in this service
  // (dispatcher/admin-driven advanceStatus, and the rider/carrier
  // self-service methods above) — applied AFTER the caller's own
  // atomic/authorized write already landed, never before. Cancellation
  // gets its sibling/shipment cascade; every other transition gets the
  // shipment-status cascade + the appropriate tracking event. Both paths
  // end with the same best-effort Socket.IO broadcast.
  private async afterLegStatusChange(
    leg: Leg,
    newLegStatus: LegStatus,
    changedBy: string,
  ): Promise<void> {
    if (newLegStatus === LegStatus.CANCELLED) {
      await this.cancelSiblingLegsAndShipment(leg, changedBy);
      await this.recordTrackingEvent(leg.id, TrackingEventType.STATUS_CHANGE, {
        status: 'CANCELLED',
      });
    } else {
      await this.cascadeToShipment(leg, newLegStatus, changedBy);
      await this.recordTrackingEvent(
        leg.id,
        // A completed leg that hands off to another hub is a
        // HUB_HANDOFF; the final leg's completion (toHubId null) is the
        // actual delivery, so it's a plain STATUS_CHANGE instead —
        // matches the LOCATION_UPDATE/STATUS_CHANGE/HUB_HANDOFF split
        // on TrackingEvent's own header comment.
        newLegStatus === LegStatus.COMPLETED && leg.toHubId
          ? TrackingEventType.HUB_HANDOFF
          : TrackingEventType.STATUS_CHANGE,
        { status: newLegStatus, sequence: leg.sequence },
      );
    }

    this.broadcastLegUpdate(leg);
  }

  // Applies a leg transition's effect (if any) to the parent shipment —
  // both the coarse status milestone (deriveShipmentStatusForLegTransition)
  // and, on COMPLETED, advancing shipment.currentLeg to the next leg's
  // sequence. Single read-modify-write of the shipment row so the two
  // don't race against each other within the same request.
  private async cascadeToShipment(
    leg: Leg,
    newLegStatus: LegStatus,
    changedBy: string,
  ): Promise<void> {
    const shipment = await this.shipmentsRepo.findOne({ where: { id: leg.shipmentId } });
    if (!shipment || shipment.legCount === null) {
      return;
    }

    let dirty = false;
    let historyStatus: ShipmentStatus | null = null;

    const nextStatus = deriveShipmentStatusForLegTransition(
      leg.sequence,
      shipment.legCount,
      leg.legType,
      newLegStatus,
    );
    if (nextStatus && isValidShipmentStatusTransition(shipment.status, nextStatus)) {
      shipment.status = nextStatus;
      const timestampField = SHIPMENT_STATUS_TIMESTAMP_FIELD[nextStatus];
      if (timestampField) {
        shipment[timestampField] = new Date();
      }
      dirty = true;
      historyStatus = nextStatus;
    }

    if (newLegStatus === LegStatus.COMPLETED && leg.sequence < shipment.legCount) {
      shipment.currentLeg = leg.sequence + 1;
      dirty = true;
    }

    if (dirty) {
      await this.shipmentsRepo.save(shipment);
    }
    if (historyStatus) {
      await this.recordShipmentStatusHistory(
        shipment.id,
        historyStatus,
        changedBy,
        `Leg ${leg.sequence}/${shipment.legCount} (${leg.legType}) -> ${newLegStatus}`,
      );
    }
  }

  private async cancelSiblingLegsAndShipment(
    cancelledLeg: Leg,
    changedBy: string,
  ): Promise<void> {
    const siblings = await this.legsRepo.find({ where: { shipmentId: cancelledLeg.shipmentId } });
    const nonTerminal = siblings.filter(
      (leg) =>
        leg.id !== cancelledLeg.id &&
        leg.status !== LegStatus.COMPLETED &&
        leg.status !== LegStatus.CANCELLED,
    );
    for (const sibling of nonTerminal) {
      sibling.status = LegStatus.CANCELLED;
      await this.legsRepo.save(sibling);
    }

    const shipment = await this.shipmentsRepo.findOne({
      where: { id: cancelledLeg.shipmentId },
    });
    if (shipment && isValidShipmentStatusTransition(shipment.status, ShipmentStatus.CANCELLED)) {
      shipment.status = ShipmentStatus.CANCELLED;
      await this.shipmentsRepo.save(shipment);
      await this.recordShipmentStatusHistory(
        shipment.id,
        ShipmentStatus.CANCELLED,
        changedBy,
        `Leg ${cancelledLeg.sequence}/${shipment.legCount ?? '?'} (${cancelledLeg.legType}) was cancelled`,
      );
    }
  }

  private async recordShipmentStatusHistory(
    shipmentId: string,
    status: ShipmentStatus,
    changedBy: string | null,
    reason: string | null,
  ): Promise<void> {
    const entry = this.statusHistoryRepo.create({ shipmentId, status, changedBy, reason });
    await this.statusHistoryRepo.save(entry);
  }

  private async recordTrackingEvent(
    legId: string,
    eventType: TrackingEventType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const event = this.trackingEventsRepo.create({ legId, eventType, metadata });
    await this.trackingEventsRepo.save(event);
  }

  // Additive, best-effort push over the existing tracking:// Socket.IO
  // gateway — see TrackingGateway.broadcastLegUpdate's header comment.
  private broadcastLegUpdate(leg: Leg): void {
    this.gateway.broadcastLegUpdate(leg.shipmentId, {
      legId: leg.id,
      sequence: leg.sequence,
      legType: leg.legType,
      status: leg.status,
      fromHubId: leg.fromHubId,
      toHubId: leg.toHubId,
    });
  }

  // DISPATCHER must be assigned to a hub this leg touches (either end);
  // ADMIN/SUPER_ADMIN bypass the hub check entirely. Anyone else
  // (customer, rider, business) is rejected outright — see this
  // service's header comment on the no-self-service scoping decision.
  private async assertDispatcherHubAccess(leg: Leg, requester: JwtPayload): Promise<void> {
    if (requester.roles.some((role) => ADMIN_ROLES.includes(role))) {
      return;
    }
    if (!requester.roles.includes(Role.DISPATCHER)) {
      throw new ForbiddenException('Only a dispatcher or admin can manage intercity legs');
    }

    const assignedHubIds = await this.hubsService.findAssignedHubIds(requester.sub);
    const touchesAssignedHub =
      (leg.fromHubId && assignedHubIds.includes(leg.fromHubId)) ||
      (leg.toHubId && assignedHubIds.includes(leg.toHubId));
    if (!touchesAssignedHub) {
      throw new ForbiddenException('You are not assigned to a hub this leg touches');
    }
  }

  private async findLegOrThrow(id: string): Promise<Leg> {
    const leg = await this.legsRepo.findOne({ where: { id } });
    if (!leg) {
      throw new NotFoundException(`Leg ${id} not found`);
    }
    return leg;
  }

  private hubToLocationPoint(hub: Hub): LocationPoint {
    return {
      latitude: Number(hub.latitude),
      longitude: Number(hub.longitude),
      address: `${hub.name}, ${hub.city}`,
    };
  }
}
