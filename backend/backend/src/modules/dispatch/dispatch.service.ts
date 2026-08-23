import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Rider, RiderStatus } from '../../database/entities/rider.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { ShipmentStatusHistory } from '../../database/entities/shipment-status-history.entity';
import { Coordinates, haversineDistanceMeters } from '../tracking/eta.util';

export interface DispatchQueue {
  pendingShipments: Shipment[];
  onlineRiders: Rider[];
}

// A rider_locations row older than this is treated the same as no row at
// all for ranking purposes — an isOnline rider whose app has stopped
// pinging (killed in the background, dead connection, etc.) shouldn't
// still show up as "right next to the pickup" on a stale coordinate.
// Arbitrary — there's no telemetry yet on real-world ping cadence to tune
// this against; 5 minutes is a guess at "clearly stopped reporting", not
// a measured value.
const RECENT_PING_THRESHOLD_MS = 5 * 60 * 1000;

// Dispatch — the piece flagged in the backend README's "Known
// simplifications" for Piece 6: a dispatcher/admin override on top of
// rider self-claim, plus candidate ranking.
@Injectable()
export class DispatchService {
  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    @InjectRepository(Rider)
    private readonly ridersRepo: Repository<Rider>,
    @InjectRepository(ShipmentStatusHistory)
    private readonly statusHistoryRepo: Repository<ShipmentStatusHistory>,
    @InjectRepository(RiderLocation)
    private readonly locationsRepo: Repository<RiderLocation>,
  ) {}

  // Dashboard read: everything waiting to be dispatched, and everyone
  // currently dispatchable. No pagination yet — fine at MVP scale, worth
  // revisiting once either list can realistically grow past a couple
  // hundred rows.
  async getQueue(): Promise<DispatchQueue> {
    const [pendingShipments, onlineRiders] = await Promise.all([
      this.shipmentsRepo.find({
        where: { status: ShipmentStatus.ASSIGNMENT_PENDING },
        order: { createdAt: 'ASC' },
      }),
      this.ridersRepo.find({
        where: { status: RiderStatus.ACTIVE, isOnline: true },
      }),
    ]);

    return { pendingShipments, onlineRiders };
  }

  // Ranked candidate riders for a specific shipment. Shipment must exist
  // and be ASSIGNMENT_PENDING — candidates for a shipment that isn't
  // dispatchable yet (or already claimed) aren't a meaningful concept.
  // Ranked nearest-pickup-first using each rider's last-known
  // rider_locations ping; riders with no recent ping fall back to the
  // rating/seniority heuristic and are listed after every located rider
  // (an unknown distance is never assumed to be "close").
  async getCandidates(shipmentId: string): Promise<Rider[]> {
    const shipment = await this.findShipmentOrThrow(shipmentId);

    if (shipment.status !== ShipmentStatus.ASSIGNMENT_PENDING) {
      throw new ConflictException(
        `Shipment must be ASSIGNMENT_PENDING to list candidates (currently ${shipment.status})`,
      );
    }

    const pool = await this.ridersRepo.find({
      where: { status: RiderStatus.ACTIVE, isOnline: true },
    });

    if (pool.length === 0) {
      return [];
    }

    const locations = await this.locationsRepo.find({
      where: { riderId: In(pool.map((rider) => rider.id)) },
    });
    const locationByRiderId = new Map(locations.map((loc) => [loc.riderId, loc]));

    return this.rankCandidates(pool, locationByRiderId, shipment.pickupLocation);
  }

  // Dispatcher/admin manually assigns a specific rider — the override
  // Piece 6's README explicitly called out as missing. Same race-safe
  // conditional UPDATE as the rider self-claim path in
  // shipments.service.ts's assign(), so a dispatcher and a self-claiming
  // rider can't both win the same shipment.
  async assign(
    shipmentId: string,
    riderId: string,
    dispatcherUserId: string,
    reason?: string,
  ): Promise<Shipment> {
    const rider = await this.ridersRepo.findOne({ where: { id: riderId } });
    if (!rider) {
      throw new NotFoundException(`Rider ${riderId} not found`);
    }
    if (rider.status !== RiderStatus.ACTIVE || !rider.isOnline) {
      throw new ForbiddenException('Rider must be ACTIVE and online to be dispatched a shipment');
    }

    return this.assignInternal(
      shipmentId,
      rider,
      dispatcherUserId,
      reason ?? `Dispatched by admin to rider ${riderId}`,
    );
  }

  // System picks the top-ranked candidate and assigns it. Thin wrapper
  // around getCandidates() + assignInternal() — no separate matching
  // logic to keep in sync.
  async autoAssign(
    shipmentId: string,
    dispatcherUserId: string,
    reason?: string,
  ): Promise<Shipment> {
    const candidates = await this.getCandidates(shipmentId);

    if (candidates.length === 0) {
      throw new ConflictException('No online, active riders available to auto-assign');
    }

    const chosen = candidates[0];

    return this.assignInternal(
      shipmentId,
      chosen,
      dispatcherUserId,
      reason ?? `Auto-assigned to rider ${chosen.id}`,
    );
  }

  // Nearest-pickup-first. Riders with a recent rider_locations ping are
  // sorted by haversine distance to the shipment's pickup point (ties
  // broken by the rating heuristic below); riders with no ping, or one
  // older than RECENT_PING_THRESHOLD_MS, are ranked among themselves by
  // the rating heuristic and appended after every located rider — an
  // unknown distance never outranks a known one, however good the rating.
  //
  // Still not real routing (straight-line, same caveat as
  // tracking/eta.util.ts's ETA estimate) and still ranks against the
  // pickup point even post-assignment flows might eventually want
  // dropoff-aware logic — fine for "who do we offer this to first",
  // not a road-network-accurate distance.
  private rankCandidates(
    pool: Rider[],
    locationByRiderId: Map<string, RiderLocation>,
    pickupLocation: Coordinates,
  ): Rider[] {
    const now = Date.now();
    const located: Array<{ rider: Rider; distanceMeters: number }> = [];
    const unlocated: Rider[] = [];

    for (const rider of pool) {
      const location = locationByRiderId.get(rider.id);
      const isRecent =
        !!location && now - location.updatedAt.getTime() <= RECENT_PING_THRESHOLD_MS;

      if (location && isRecent) {
        located.push({
          rider,
          distanceMeters: haversineDistanceMeters(
            { latitude: Number(location.latitude), longitude: Number(location.longitude) },
            pickupLocation,
          ),
        });
      } else {
        unlocated.push(rider);
      }
    }

    located.sort((a, b) => {
      if (a.distanceMeters !== b.distanceMeters) {
        return a.distanceMeters - b.distanceMeters;
      }
      return this.rankByRatingHeuristic(a.rider, b.rider);
    });

    const rankedUnlocated = [...unlocated].sort((a, b) => this.rankByRatingHeuristic(a, b));

    return [...located.map((entry) => entry.rider), ...rankedUnlocated];
  }

  // The original v1 heuristic — highest rating first (unrated riders
  // last), then most-rated (a proxy for experience), then longest-
  // tenured. Now used as a distance tie-breaker and as the sort for
  // riders rankCandidates() can't place a distance on.
  private rankByRatingHeuristic(a: Rider, b: Rider): number {
    const ratingA = a.ratingAvg !== null ? Number(a.ratingAvg) : -1;
    const ratingB = b.ratingAvg !== null ? Number(b.ratingAvg) : -1;
    if (ratingB !== ratingA) return ratingB - ratingA;

    if (b.ratingCount !== a.ratingCount) return b.ratingCount - a.ratingCount;

    return a.createdAt.getTime() - b.createdAt.getTime();
  }

  private async assignInternal(
    shipmentId: string,
    rider: Rider,
    dispatcherUserId: string,
    reason: string,
  ): Promise<Shipment> {
    // Same conditional UPDATE pattern as ShipmentsService.assign(): only
    // one caller's WHERE clause can match, so a dispatcher assigning at
    // the same moment a rider self-claims can't both succeed.
    const result = await this.shipmentsRepo.update(
      { id: shipmentId, status: ShipmentStatus.ASSIGNMENT_PENDING, riderId: IsNull() },
      { status: ShipmentStatus.ASSIGNED, riderId: rider.id, assignedAt: new Date() },
    );

    if (result.affected === 0) {
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

    await this.recordStatusHistory(shipmentId, dispatcherUserId, reason);

    return this.findShipmentOrThrow(shipmentId);
  }

  private async findShipmentOrThrow(id: string): Promise<Shipment> {
    const shipment = await this.shipmentsRepo.findOne({ where: { id } });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }
    return shipment;
  }

  private async recordStatusHistory(
    shipmentId: string,
    changedBy: string,
    reason: string,
  ): Promise<void> {
    const entry = this.statusHistoryRepo.create({
      shipmentId,
      status: ShipmentStatus.ASSIGNED,
      changedBy,
      reason,
    });

    await this.statusHistoryRepo.save(entry);
  }
}
