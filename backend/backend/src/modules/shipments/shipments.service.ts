import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { ProofOfDelivery } from '../../database/entities/proof-of-delivery.entity';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { Role } from '../../database/entities/user-role.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { PricingService } from '../pricing/pricing.service';
import { haversineDistanceMeters } from '../tracking/eta.util';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ListShipmentsQueryDto } from './dto/list-shipments-query.dto';
import { RateRiderDto } from './dto/rate-rider.dto';
import { SubmitProofOfDeliveryDto } from './dto/submit-proof-of-delivery.dto';
import {
  isValidShipmentStatusTransition,
  SHIPMENT_STATUS_TIMESTAMP_FIELD,
} from './shipment-status.transitions';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN];

@Injectable()
export class ShipmentsService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    @InjectRepository(Rider)
    private readonly ridersRepo: Repository<Rider>,
    @InjectRepository(ShipmentStatusHistory)
    private readonly statusHistoryRepo: Repository<ShipmentStatusHistory>,
    @InjectRepository(ProofOfDelivery)
    private readonly proofOfDeliveryRepo: Repository<ProofOfDelivery>,
    private readonly pricingService: PricingService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateShipmentDto, customerId: string): Promise<Shipment> {
    // Straight-line distance between the two points — same haversine
    // util tracking/dispatch already use for ETA and candidate ranking
    // (see tracking/eta.util.ts), not a real routing distance. Good
    // enough for a quote; not turn-by-turn accurate.
    const distanceKm =
      haversineDistanceMeters(dto.pickupLocation, dto.dropoffLocation) / 1000;

    // Computed and validated BEFORE the shipment is inserted — if pricing
    // fails (most likely: no active PricingConfig covers right now), the
    // whole create() throws and nothing gets written, rather than leaving
    // an orphaned shipment stuck at CREATED with a null price forever.
    const quote = await this.pricingService.calculatePrice({
      distanceKm,
      weightKg: dto.packageWeightKg,
    });

    // Shipment insert + both history rows commit or roll back together —
    // same one-transaction pattern PaymentsService uses for payment
    // completion (see Piece 13 in the README). The pricing call above
    // stays outside: it's a read against PricingConfig, not a write that
    // needs to roll back with anything.
    return this.dataSource.transaction(async (manager) => {
      const shipmentsRepo = manager.getRepository(Shipment);

      const shipment = shipmentsRepo.create({
        customerId,
        status: ShipmentStatus.QUOTED,
        pickupLocation: dto.pickupLocation,
        dropoffLocation: dto.dropoffLocation,
        packageWeightKg:
          dto.packageWeightKg !== undefined
            ? dto.packageWeightKg.toString()
            : null,
        packageDescription: dto.packageDescription ?? null,
        price: quote.price,
        commission: quote.commission,
        riderPayout: quote.riderPayout,
      });

      const saved = await shipmentsRepo.save(shipment);

      // Two history rows for one API call, not one — CREATED and QUOTED
      // both genuinely happened, just atomically rather than as separate
      // customer-visible steps (there's no standalone "request a quote"
      // endpoint yet). Keeps the audit trail meaningful and keeps the
      // state machine's CREATED -> QUOTED transition (see
      // shipment-status.transitions.ts) reflected in the history, not just
      // implied by the final status.
      await this.recordStatusHistory(
        saved.id,
        ShipmentStatus.CREATED,
        customerId,
        null,
        manager,
      );
      await this.recordStatusHistory(
        saved.id,
        ShipmentStatus.QUOTED,
        customerId,
        `Priced at ${quote.price} (pricing config ${quote.pricingConfigId})`,
        manager,
      );

      return saved;
    });
  }

  // Owner-checked read, for the controller. Internal callers (updateStatus,
  // assign) use findByIdOrThrow instead — they do their own, more specific
  // authorization rather than the generic owner-or-admin rule below.
  async findOne(id: string, requester: JwtPayload): Promise<Shipment> {
    const shipment = await this.findByIdOrThrow(id);
    await this.assertCanAccess(shipment, requester);
    return shipment;
  }

  // Same access rule as findOne — owning customer, assigned rider, or
  // admin — since the history is just as revealing as the shipment itself.
  async getStatusHistory(
    id: string,
    requester: JwtPayload,
  ): Promise<ShipmentStatusHistory[]> {
    const shipment = await this.findByIdOrThrow(id);
    await this.assertCanAccess(shipment, requester);

    return this.statusHistoryRepo.find({
      where: { shipmentId: id },
      order: { changedAt: 'ASC' },
    });
  }

  async findAll(
    query: ListShipmentsQueryDto,
    customerId: string,
  ): Promise<Shipment[]> {
    return this.shipmentsRepo.find({
      where: {
        customerId,
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
  }

  // GET /shipments/available — the rider-facing counterpart to
  // GET /dispatch/queue (which is ADMIN/SUPER_ADMIN/DISPATCHER-only).
  // Riders have no dispatcher UI in this pass, so they need their own
  // read of "what can I claim right now": unassigned, ASSIGNMENT_PENDING
  // shipments, oldest first (simple fairness — first requested, first
  // shown; no geo-ranking yet, unlike DispatchService.getCandidates).
  // Deliberately NOT scoped by rider identity — unlike findAll, every
  // online rider should see the same open queue until one of them wins
  // the race in assign()'s conditional UPDATE.
  async findAvailableForRider(limit = 20, offset = 0): Promise<Shipment[]> {
    return this.shipmentsRepo.find({
      where: { status: ShipmentStatus.ASSIGNMENT_PENDING, riderId: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
  }

  async updateStatus(
    id: string,
    nextStatus: ShipmentStatus,
    requester: JwtPayload,
    reason?: string,
  ): Promise<Shipment> {
    // ASSIGNED is only reachable through assign() — it's the one status
    // change that also has to atomically claim the shipment (set
    // rider_id) in the same write, which this generic method can't do
    // safely (see assign()'s conditional UPDATE).
    if (nextStatus === ShipmentStatus.ASSIGNED) {
      throw new ConflictException(
        'Use POST /shipments/:id/assign to move a shipment to ASSIGNED',
      );
    }

    // Same reasoning as ASSIGNED above — DELIVERED now has its own
    // atomic write (it also has to insert the proof-of-delivery row in
    // the same operation), and shouldn't be reachable by a bare status
    // PATCH with no evidence anyone actually delivered anything.
    if (nextStatus === ShipmentStatus.DELIVERED) {
      throw new ConflictException(
        'Use POST /shipments/:id/deliver to move a shipment to DELIVERED',
      );
    }

    const shipment = await this.findByIdOrThrow(id);
    await this.assertCanAccess(shipment, requester);

    if (!isValidShipmentStatusTransition(shipment.status, nextStatus)) {
      throw new ConflictException(
        `Cannot move shipment from ${shipment.status} to ${nextStatus}`,
      );
    }

    shipment.status = nextStatus;

    const timestampField = SHIPMENT_STATUS_TIMESTAMP_FIELD[nextStatus];
    if (timestampField) {
      shipment[timestampField] = new Date();
    }

    const saved = await this.shipmentsRepo.save(shipment);

    await this.recordStatusHistory(id, nextStatus, requester.sub, reason ?? null);

    return saved;
  }

  // Called by PaymentsService once a payment is confirmed — either a
  // provider webhook lands as COMPLETED, or (for CASH) the payment is
  // accepted at checkout time, since cash isn't collected until delivery
  // but the shipment still needs to reach riders immediately. The one
  // remaining gap flagged in the README's Piece 11 "Known
  // simplifications". Lives here rather than in Payments so both status
  // transitions still go through this module's own state machine
  // (isValidShipmentStatusTransition) instead of Payments reaching in
  // and mutating shipment.status directly.
  //
  // Moves QUOTED -> CONFIRMED -> ASSIGNMENT_PENDING in one call: CONFIRMED
  // is a transient bookkeeping state (payment succeeded), not something a
  // human needs to act on before a rider can see the shipment, so there's
  // no reason to leave it sitting there. Both transitions are valid moves
  // per shipment-status.transitions.ts, recorded as two separate history
  // rows so the audit trail still shows both actually happened.
  //
  // Deliberately tolerant, not throwing: a shipment might already be past
  // QUOTED (a retried webhook, or cancelled in the meantime) by the time
  // this runs. Either way that's a no-op here, not a failure — a payment
  // that already succeeded shouldn't get an error surfaced to the
  // provider just because the shipment side has nothing left to do.
  //
  // Accepts an optional EntityManager so PaymentsService can run this
  // inside the same DB transaction as the payment save (see Piece 12 in
  // the README) — the payment write and both shipment writes either all
  // commit or all roll back. Falls back to this service's own injected
  // repos when called without one, so it still works standalone (and in
  // the existing unit tests, which mock those repos directly).
   async confirmAfterPayment(shipmentId: string, manager?: EntityManager): Promise<void> {
    const shipmentsRepo = manager ? manager.getRepository(Shipment) : this.shipmentsRepo;
    const historyRepo = manager
      ? manager.getRepository(ShipmentStatusHistory)
      : this.statusHistoryRepo;

    const shipment = await shipmentsRepo.findOne({ where: { id: shipmentId } });
    if (!shipment || !isValidShipmentStatusTransition(shipment.status, ShipmentStatus.CONFIRMED)) {
      return;
    }

    // Built as fresh objects rather than mutating `shipment` in place
    // twice — two separate .save() calls need two distinct snapshots,
    // not the same reference mutated out from under the first call.
    const confirmedShipment = { ...shipment, status: ShipmentStatus.CONFIRMED };
    await shipmentsRepo.save(confirmedShipment);

    // changedBy is null: this transition was driven by a payment
    // provider webhook (or cash acceptance), not a logged-in user action.
    const confirmedEntry = historyRepo.create({
      shipmentId,
      status: ShipmentStatus.CONFIRMED,
      changedBy: null,
      reason: 'Payment completed',
    });
    await historyRepo.save(confirmedEntry);

    // Immediately continue on to ASSIGNMENT_PENDING — see the method
    // comment above for why this isn't left as a separate manual step.
    if (!isValidShipmentStatusTransition(confirmedShipment.status, ShipmentStatus.ASSIGNMENT_PENDING)) {
      return;
    }

    const queuedShipment = { ...confirmedShipment, status: ShipmentStatus.ASSIGNMENT_PENDING };
    await shipmentsRepo.save(queuedShipment);

    const queuedEntry = historyRepo.create({
      shipmentId,
      status: ShipmentStatus.ASSIGNMENT_PENDING,
      changedBy: null,
      reason: 'Ready for rider assignment',
    });
    await historyRepo.save(queuedEntry);
   }

  // A rider claims an ASSIGNMENT_PENDING shipment for themselves. No
  // dispatcher/admin override yet — see the README's "Known
  // simplifications" for Piece 6.
  async assign(shipmentId: string, riderUserId: string): Promise<Shipment> {
    const rider = await this.ridersRepo.findOne({ where: { userId: riderUserId } });
    if (!rider) {
      throw new NotFoundException('No rider profile for this account yet');
    }
    if (rider.status !== RiderStatus.ACTIVE || !rider.isOnline) {
      throw new ForbiddenException(
        'Rider must be ACTIVE and online to accept a shipment',
      );
    }

    // Single conditional UPDATE instead of read-then-write: two riders
    // hitting this at once can't both win, because only one UPDATE can
    // match the WHERE clause (rider_id IS NULL AND status =
    // ASSIGNMENT_PENDING) — the loser's `affected` count comes back 0.
    const result = await this.shipmentsRepo.update(
      { id: shipmentId, status: ShipmentStatus.ASSIGNMENT_PENDING, riderId: IsNull() },
      { status: ShipmentStatus.ASSIGNED, riderId: rider.id, assignedAt: new Date() },
    );

    if (result.affected === 0) {
      // Distinguish "doesn't exist" from "exists but not claimable" so
      // the caller gets a useful error either way.
      const shipment = await this.shipmentsRepo.findOne({ where: { id: shipmentId } });
      if (!shipment) {
        throw new NotFoundException(`Shipment ${shipmentId} not found`);
      }
      throw new ConflictException(
        shipment.riderId
          ? 'This shipment has already been assigned to a rider'
          : `Shipment must be ASSIGNMENT_PENDING to assign (currently ${shipment.status})`,
      );
    }

    // Only reached once, by whichever caller actually won the conditional
    // UPDATE above — safe to write exactly one history row here.
    await this.recordStatusHistory(shipmentId, ShipmentStatus.ASSIGNED, riderUserId, null);

    return this.findByIdOrThrow(shipmentId);
  }

  // POST /shipments/:id/deliver — the assigned rider confirms delivery.
  // Deliberately its own endpoint rather than a PATCH .../status target
  // (see updateStatus above) for the same reason assign() is: it has to
  // atomically claim the transition AND write the proof-of-delivery row,
  // and only the rider who is actually assigned should be able to do it.
  async submitProofOfDelivery(
    shipmentId: string,
    riderUserId: string,
    dto: SubmitProofOfDeliveryDto,
  ): Promise<Shipment> {
    const rider = await this.ridersRepo.findOne({ where: { userId: riderUserId } });
    if (!rider) {
      throw new NotFoundException('No rider profile for this account yet');
    }

    // Single conditional UPDATE, same race-safety pattern as assign():
    // only proceeds if this exact rider is the one currently assigned
    // AND the shipment is still OUT_FOR_DELIVERY. Guards against both a
    // wrong-status call and a rider trying to confirm delivery of
    // someone else's shipment.
    const result = await this.shipmentsRepo.update(
      {
        id: shipmentId,
        status: ShipmentStatus.OUT_FOR_DELIVERY,
        riderId: rider.id,
      },
      { status: ShipmentStatus.DELIVERED, deliveredAt: new Date() },
    );

    if (result.affected === 0) {
      const shipment = await this.shipmentsRepo.findOne({ where: { id: shipmentId } });
      if (!shipment) {
        throw new NotFoundException(`Shipment ${shipmentId} not found`);
      }
      if (shipment.riderId !== rider.id) {
        throw new ForbiddenException(
          'Only the rider assigned to this shipment can confirm delivery',
        );
      }
      throw new ConflictException(
        `Shipment must be OUT_FOR_DELIVERY to confirm delivery (currently ${shipment.status})`,
      );
    }

    const proof = this.proofOfDeliveryRepo.create({
      shipmentId,
      recipientName: dto.recipientName,
      photoUrl: dto.photoUrl ?? null,
      notes: dto.notes ?? null,
      deliveredBy: riderUserId,
    });
    await this.proofOfDeliveryRepo.save(proof);

    await this.recordStatusHistory(
      shipmentId,
      ShipmentStatus.DELIVERED,
      riderUserId,
      `Delivered to ${dto.recipientName}`,
    );

    return this.findByIdOrThrow(shipmentId);
  }

  // GET /shipments/:id/proof-of-delivery — same access rule as the
  // shipment itself (owning customer, assigned rider, or admin).
  async getProofOfDelivery(
    id: string,
    requester: JwtPayload,
  ): Promise<ProofOfDelivery> {
    const shipment = await this.findByIdOrThrow(id);
    await this.assertCanAccess(shipment, requester);

    const proof = await this.proofOfDeliveryRepo.findOne({
      where: { shipmentId: id },
    });
    if (!proof) {
      throw new NotFoundException('No proof of delivery submitted yet for this shipment');
    }

    return proof;
  }

  // POST /shipments/:id/rate-rider — owning customer only, one rating
  // per shipment (riderRating starting NULL is the guard against a
  // second call), only after the delivery is actually done. Updates the
  // Rider rollup (ratingAvg/ratingCount) — those columns existed on the
  // entity already but nothing wrote to them before this endpoint; see
  // MASTER_GAPS_AND_ROADMAP.md ("Customer-rating endpoint").
  async rateRider(id: string, dto: RateRiderDto, requester: JwtPayload): Promise<Shipment> {
    const shipment = await this.findByIdOrThrow(id);

    if (shipment.customerId !== requester.sub) {
      throw new ForbiddenException('Only the customer who placed this shipment can rate the rider');
    }
    if (shipment.status !== ShipmentStatus.DELIVERED && shipment.status !== ShipmentStatus.COMPLETED) {
      throw new ConflictException('Cannot rate a rider before the shipment is delivered');
    }
    if (!shipment.riderId) {
      throw new ConflictException('This shipment has no assigned rider to rate');
    }
    if (shipment.riderRating !== null) {
      throw new ConflictException('This shipment has already been rated');
    }

    shipment.riderRating = dto.rating;
    await this.shipmentsRepo.save(shipment);

    const rider = await this.ridersRepo.findOne({ where: { id: shipment.riderId } });
    if (rider) {
      const previousCount = rider.ratingCount;
      const previousAvg = parseFloat(rider.ratingAvg ?? '0');
      const newCount = previousCount + 1;
      const newAvg = (previousAvg * previousCount + dto.rating) / newCount;
      rider.ratingCount = newCount;
      rider.ratingAvg = newAvg.toFixed(2);
      await this.ridersRepo.save(rider);
    }

    return shipment;
  }

  // Used by PaymentsService to authorize the CASH-collection confirmation
  // endpoint — same rule as who may submit proof of delivery: the rider
  // actually assigned to the shipment, or an admin. Deliberately
  // narrower than assertCanAccess (no customer access) since confirming
  // cash was physically collected isn't something the paying customer
  // attests to.
  async isAssignedRiderOrAdmin(shipmentId: string, requester: JwtPayload): Promise<boolean> {
    if (requester.roles.some((role) => ADMIN_ROLES.includes(role))) {
      return true;
    }
    if (!requester.roles.includes(Role.RIDER)) {
      return false;
    }

    const shipment = await this.shipmentsRepo.findOne({ where: { id: shipmentId } });
    if (!shipment || !shipment.riderId) {
      return false;
    }

    const rider = await this.ridersRepo.findOne({ where: { userId: requester.sub } });
    return !!rider && rider.id === shipment.riderId;
  }

  private async findByIdOrThrow(id: string): Promise<Shipment> {
    const shipment = await this.shipmentsRepo.findOne({ where: { id } });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    return shipment;
  }

  // Owner (the customer who created it), the assigned rider, or an admin.
  private async assertCanAccess(
    shipment: Shipment,
    requester: JwtPayload,
  ): Promise<void> {
    if (shipment.customerId === requester.sub) {
      return;
    }
    if (requester.roles.some((role) => ADMIN_ROLES.includes(role))) {
      return;
    }
    if (shipment.riderId && requester.roles.includes(Role.RIDER)) {
      const rider = await this.ridersRepo.findOne({ where: { userId: requester.sub } });
      if (rider && rider.id === shipment.riderId) {
        return;
      }
    }

    throw new ForbiddenException('You do not have access to this shipment');
  }

  private async recordStatusHistory(
    shipmentId: string,
    status: ShipmentStatus,
    changedBy: string | null,
    reason: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const historyRepo = manager
      ? manager.getRepository(ShipmentStatusHistory)
      : this.statusHistoryRepo;

    const entry = historyRepo.create({
      shipmentId,
      status,
      changedBy,
      reason,
    });

    await historyRepo.save(entry);
  }
}