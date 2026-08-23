import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Rider } from '../../database/entities/rider.entity';
import { RiderLocation } from '../../database/entities/rider-location.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { JwtPayload } from '../auth/jwt-payload.interface';
import { UpdateRiderLocationDto } from './dto/update-rider-location.dto';
import { canAccessShipment } from './tracking-access.util';
import { buildTrackingSnapshot, TrackingSnapshot } from './tracking-snapshot.util';
import { TrackingGateway } from './tracking.gateway';

// Shipment states worth pushing rider-location updates for. Deliberately
// excludes CREATED/QUOTED/CONFIRMED/ASSIGNMENT_PENDING (no rider attached
// yet) and the terminal states (DELIVERED/COMPLETED/CANCELLED — nothing
// left to track).
const ACTIVELY_TRACKED_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.PICKUP_IN_PROGRESS,
  ShipmentStatus.PICKED_UP,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.OUT_FOR_DELIVERY,
];

@Injectable()
export class TrackingService {
  constructor(
    @InjectRepository(RiderLocation)
    private readonly locationsRepo: Repository<RiderLocation>,
    @InjectRepository(Rider)
    private readonly ridersRepo: Repository<Rider>,
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
    private readonly gateway: TrackingGateway,
  ) {}

  // POST /rider/location — a rider pings their current GPS position.
  // Upserts the rider's single rider_locations row, then pushes a fresh
  // `tracking:update` to every shipment currently being carried by them.
  async updateLocation(
    riderUserId: string,
    dto: UpdateRiderLocationDto,
  ): Promise<RiderLocation> {
    const rider = await this.ridersRepo.findOne({ where: { userId: riderUserId } });
    if (!rider) {
      throw new NotFoundException('No rider profile for this account yet');
    }

    // Mirrors the "must be online" rule RidersService already applies to
    // accepting shipments — an offline rider isn't being dispatched to,
    // so there's no reason for their app to be pushing pings either.
    if (!rider.isOnline) {
      throw new ForbiddenException('Go online before sending location updates');
    }

    let location = await this.locationsRepo.findOne({ where: { riderId: rider.id } });
    if (!location) {
      location = this.locationsRepo.create({ riderId: rider.id });
    }
    location.latitude = dto.latitude.toString();
    location.longitude = dto.longitude.toString();
    location.accuracyMeters = dto.accuracyMeters ?? null;

    const saved = await this.locationsRepo.save(location);

    await this.broadcastToActiveShipments(rider.id, saved);

    return saved;
  }

  // GET /shipments/:id/tracking — same access rule as GET /shipments/:id
  // (owning customer, assigned rider, or admin). HTTP snapshot alongside
  // the WebSocket stream, for a client that just wants a one-off read.
  async getShipmentTracking(
    shipmentId: string,
    requester: JwtPayload,
  ): Promise<TrackingSnapshot> {
    const shipment = await this.shipmentsRepo.findOne({ where: { id: shipmentId } });
    if (!shipment) {
      throw new NotFoundException(`Shipment ${shipmentId} not found`);
    }

    const callerRider = await this.ridersRepo.findOne({ where: { userId: requester.sub } });
    if (!canAccessShipment(shipment, requester, callerRider)) {
      throw new ForbiddenException('You do not have access to this shipment');
    }

    const location = shipment.riderId
      ? await this.locationsRepo.findOne({ where: { riderId: shipment.riderId } })
      : null;

    return buildTrackingSnapshot(shipment, location);
  }

  private async broadcastToActiveShipments(
    riderId: string,
    location: RiderLocation,
  ): Promise<void> {
    const activeShipments = await this.shipmentsRepo.find({
      where: { riderId, status: In(ACTIVELY_TRACKED_STATUSES) },
    });

    for (const shipment of activeShipments) {
      this.gateway.broadcastToShipment(shipment.id, buildTrackingSnapshot(shipment, location));
    }
  }
}
