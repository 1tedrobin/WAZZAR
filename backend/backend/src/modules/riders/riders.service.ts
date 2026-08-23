import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  DocumentReviewStatus,
  Rider,
  RiderDocumentType,
  RiderStatus,
} from '../../database/entities/rider.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';
import { CreateRiderProfileDto } from './dto/create-rider-profile.dto';
import { ReviewRiderDocumentDto } from './dto/review-rider-document.dto';

// Maps each reviewable document type to the entity column holding its
// uploaded URL — used so reviewDocument() can tell an admin they're
// reviewing a document that was never actually submitted.
const DOCUMENT_URL_FIELD: Record<RiderDocumentType, keyof Rider> = {
  [RiderDocumentType.ID]: 'idDocumentUrl',
  [RiderDocumentType.LICENSE]: 'licenseDocumentUrl',
  [RiderDocumentType.VEHICLE_REGISTRATION]: 'vehicleRegistrationDocumentUrl',
  [RiderDocumentType.INSURANCE]: 'insuranceDocumentUrl',
};

@Injectable()
export class RidersService {
  constructor(
    @InjectRepository(Rider)
    private readonly ridersRepo: Repository<Rider>,
    @InjectRepository(Shipment)
    private readonly shipmentsRepo: Repository<Shipment>,
  ) {}

  async createProfile(userId: string, dto: CreateRiderProfileDto): Promise<Rider> {
    const existing = await this.ridersRepo.findOne({ where: { userId } });
    if (existing) {
      throw new ConflictException('A rider profile already exists for this account');
    }

    const rider = this.ridersRepo.create({
      userId,
      vehicleType: dto.vehicleType,
      vehicleRegistration: dto.vehicleRegistration,
      licenseNumber: dto.licenseNumber,
      insuranceExpiresAt: dto.insuranceExpiresAt ?? null,
      idDocumentUrl: dto.idDocumentUrl ?? null,
      licenseDocumentUrl: dto.licenseDocumentUrl ?? null,
      vehicleRegistrationDocumentUrl: dto.vehicleRegistrationDocumentUrl ?? null,
      insuranceDocumentUrl: dto.insuranceDocumentUrl ?? null,
      status: RiderStatus.ONBOARDING,
    });

    return this.ridersRepo.save(rider);
  }

  async findByUserId(userId: string): Promise<Rider> {
    const rider = await this.ridersRepo.findOne({ where: { userId } });
    if (!rider) {
      throw new NotFoundException('No rider profile for this account yet');
    }
    return rider;
  }

  // GET /riders/:id — admin-only lookup by rider id (as opposed to
  // findByUserId, which is the self-service "me" route). Needed so an
  // admin can actually see a rider's document URLs and per-document
  // review state before approving/rejecting one — there is still no
  // GET /riders list endpoint, so admins reach this by an id sourced
  // elsewhere (dispatch queue, support contact, onboarding record).
  async findById(id: string): Promise<Rider> {
    const rider = await this.ridersRepo.findOne({ where: { id } });
    if (!rider) {
      throw new NotFoundException(`Rider ${id} not found`);
    }
    return rider;
  }

  async setOnline(userId: string): Promise<Rider> {
    const rider = await this.findByUserId(userId);

    // Only a verified (ACTIVE) rider can go online — an ONBOARDING rider
    // whose documents haven't been checked yet shouldn't be dispatchable.
    if (rider.status !== RiderStatus.ACTIVE) {
      throw new ForbiddenException(
        `Cannot go online while rider status is ${rider.status} — needs admin verification first`,
      );
    }

    rider.isOnline = true;
    return this.ridersRepo.save(rider);
  }

  async setOffline(userId: string): Promise<Rider> {
    const rider = await this.findByUserId(userId);
    rider.isOnline = false;
    return this.ridersRepo.save(rider);
  }

  // GET /riders/me/earnings — computed straight from Shipment.riderPayout
  // on this rider's DELIVERED/COMPLETED shipments, not from
  // Rider.totalEarnings (that column exists on the entity but nothing
  // currently writes to it — see the NOTE on the column itself). Reading
  // from Shipment keeps a single source of truth instead of introducing
  // a second, easily-out-of-sync running total.
  async getEarnings(userId: string): Promise<{
    totalEarnings: string;
    deliveries: Array<{ shipmentId: string; payout: string | null; deliveredAt: Date | null }>;
  }> {
    const rider = await this.findByUserId(userId);

    const shipments = await this.shipmentsRepo.find({
      where: { riderId: rider.id, status: In([ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED]) },
      order: { deliveredAt: 'DESC' },
    });

    const totalCents = shipments.reduce(
      (sum, s) => sum + Math.round(parseFloat(s.riderPayout ?? '0') * 100),
      0,
    );

    return {
      totalEarnings: (totalCents / 100).toFixed(2),
      deliveries: shipments.map((s) => ({
        shipmentId: s.id,
        payout: s.riderPayout,
        deliveredAt: s.deliveredAt ?? null,
      })),
    };
  }

  // Get a rider's public profile for customers tracking delivery.
  // Only returns non-sensitive fields (name, vehicle, rating).
  // Unauthenticated — any customer can look up their assigned rider.
  async getPublicProfile(riderId: string): Promise<{
    id: string;
    name: string;
    vehicleType: string | null;
    ratingAvg: number | null;
    ratingCount: number;
    isOnline: boolean;
  }> {
    const rider = await this.ridersRepo.findOne({
      where: { id: riderId },
      relations: ['user'],
    });

    if (!rider) {
      throw new NotFoundException(`Rider ${riderId} not found`);
    }

    return {
      id: rider.id,
      name: rider.user?.fullName || 'Rider',
      vehicleType: rider.vehicleType,
      ratingAvg: rider.ratingAvg ? Number(rider.ratingAvg) : null,
      ratingCount: rider.ratingCount,
      isOnline: rider.isOnline,
    };
  }

  // Admin-only (gated by @Roles(Role.ADMIN, Role.SUPER_ADMIN) on the
  // controller route). Flips the whole application ACTIVE in one step;
  // deliberately doesn't require every document to be individually
  // APPROVED via reviewDocument() first — an admin can still verify
  // holistically. Use reviewDocument() alongside this for per-document
  // record-keeping (e.g. flagging one doc as rejected/expired) without
  // blocking the overall verification on it.
  async verify(riderId: string): Promise<Rider> {
    const rider = await this.ridersRepo.findOne({ where: { id: riderId } });
    if (!rider) {
      throw new NotFoundException(`Rider ${riderId} not found`);
    }

    if (rider.status === RiderStatus.SUSPENDED) {
      throw new ConflictException('A suspended rider cannot be verified directly');
    }

    rider.status = RiderStatus.ACTIVE;
    rider.documentsVerifiedAt = new Date();
    return this.ridersRepo.save(rider);
  }

  // PATCH /riders/:id/documents/:documentType — admin-only. Sits alongside
  // verify() rather than replacing it: this records a decision on one
  // document (e.g. reject just an expired insurance doc) without by
  // itself changing the rider's overall status — an admin still uses
  // verify() to flip the whole application ACTIVE once they're satisfied.
  async reviewDocument(
    riderId: string,
    documentType: RiderDocumentType,
    dto: ReviewRiderDocumentDto,
  ): Promise<Rider> {
    const rider = await this.ridersRepo.findOne({ where: { id: riderId } });
    if (!rider) {
      throw new NotFoundException(`Rider ${riderId} not found`);
    }

    if (dto.status === DocumentReviewStatus.REJECTED && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required when rejecting a document');
    }

    const urlField = DOCUMENT_URL_FIELD[documentType];
    if (!rider[urlField]) {
      throw new BadRequestException(
        `Rider has not uploaded a ${documentType.toLowerCase().replace('_', ' ')} document yet`,
      );
    }

    rider.documentReviews = {
      ...rider.documentReviews,
      [documentType]: {
        status: dto.status,
        reason: dto.status === DocumentReviewStatus.REJECTED ? dto.reason!.trim() : null,
        reviewedAt: new Date().toISOString(),
      },
    };

    return this.ridersRepo.save(rider);
  }
}
