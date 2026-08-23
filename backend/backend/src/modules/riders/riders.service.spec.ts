import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { RidersService } from './riders.service';
import { CreateRiderProfileDto } from './dto/create-rider-profile.dto';
import { ReviewRiderDocumentDto } from './dto/review-rider-document.dto';
import {
  DocumentReviewStatus,
  Rider,
  RiderDocumentType,
  RiderStatus,
} from '../../database/entities/rider.entity';
import { Shipment, ShipmentStatus } from '../../database/entities/shipment.entity';

// Minimal fake of the slice of Repository<T> this service actually
// calls — same pattern as shipments.service.spec.ts.
function mockRepo() {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'rider-1', ...x })),
    findOne: jest.fn(),
    find: jest.fn(),
  };
}

const USER_ID = 'a5f3c111-0000-4000-8000-000000000001';
const RIDER_ID = 'b5f3c111-0000-4000-8000-000000000002';

function baseRider(overrides: Partial<Rider> = {}): Rider {
  return {
    id: RIDER_ID,
    userId: USER_ID,
    vehicleType: 'Motorcycle',
    vehicleRegistration: 'T 482 ABC',
    licenseNumber: 'DL-0294831',
    insuranceExpiresAt: null,
    status: RiderStatus.ACTIVE,
    isOnline: false,
    ratingAvg: null,
    ratingCount: 0,
    totalEarnings: '0.00',
    documentsVerifiedAt: null,
    idDocumentUrl: 'https://cdn.example.com/id.jpg',
    licenseDocumentUrl: 'https://cdn.example.com/license.jpg',
    vehicleRegistrationDocumentUrl: 'https://cdn.example.com/reg.jpg',
    insuranceDocumentUrl: 'https://cdn.example.com/insurance.jpg',
    documentReviews: {},
    createdAt: new Date(),
    ...overrides,
  } as Rider;
}

describe('RidersService', () => {
  let service: RidersService;
  let ridersRepo: ReturnType<typeof mockRepo>;
  let shipmentsRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    ridersRepo = mockRepo();
    shipmentsRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidersService,
        { provide: getRepositoryToken(Rider), useValue: ridersRepo },
        { provide: getRepositoryToken(Shipment), useValue: shipmentsRepo },
      ],
    }).compile();

    service = module.get(RidersService);
  });

  describe('createProfile', () => {
    const dto: CreateRiderProfileDto = {
      vehicleType: 'Motorcycle',
      vehicleRegistration: 'T 482 ABC',
      licenseNumber: 'DL-0294831',
    };

    it('creates a new ONBOARDING profile when none exists yet', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await service.createProfile(USER_ID, dto);

      expect(ridersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          vehicleType: dto.vehicleType,
          vehicleRegistration: dto.vehicleRegistration,
          licenseNumber: dto.licenseNumber,
          status: RiderStatus.ONBOARDING,
        }),
      );
      expect(ridersRepo.save).toHaveBeenCalled();
    });

    it('defaults insuranceExpiresAt to null when not provided', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await service.createProfile(USER_ID, dto);

      expect(ridersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ insuranceExpiresAt: null }),
      );
    });

    it('rejects a second profile for the same account', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());

      await expect(service.createProfile(USER_ID, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(ridersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findByUserId', () => {
    it('returns the rider profile when one exists', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());

      const result = await service.findByUserId(USER_ID);

      expect(result.id).toBe(RIDER_ID);
      expect(ridersRepo.findOne).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    });

    it('throws NotFoundException when no profile exists', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(service.findByUserId(USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('setOnline', () => {
    it('sets isOnline true for an ACTIVE rider', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ status: RiderStatus.ACTIVE }));

      await service.setOnline(USER_ID);

      expect(ridersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isOnline: true }),
      );
    });

    it('refuses to go online while status is ONBOARDING', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ status: RiderStatus.ONBOARDING }));

      await expect(service.setOnline(USER_ID)).rejects.toThrow(ForbiddenException);
      expect(ridersRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to go online while SUSPENDED', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ status: RiderStatus.SUSPENDED }));

      await expect(service.setOnline(USER_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setOffline', () => {
    it('sets isOnline false regardless of status', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ status: RiderStatus.ONBOARDING, isOnline: true }));

      await service.setOffline(USER_ID);

      expect(ridersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isOnline: false }),
      );
    });
  });

  describe('getEarnings', () => {
    it('sums riderPayout across DELIVERED/COMPLETED shipments for this rider', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());
      shipmentsRepo.find.mockResolvedValue([
        { id: 'ship-1', riderPayout: '4000.00', deliveredAt: new Date('2026-08-01') },
        { id: 'ship-2', riderPayout: '3500.50', deliveredAt: new Date('2026-08-02') },
      ]);

      const result = await service.getEarnings(USER_ID);

      expect(shipmentsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            riderId: RIDER_ID,
            status: In([ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED]),
          },
        }),
      );
      expect(result.totalEarnings).toBe('7500.50');
      expect(result.deliveries).toHaveLength(2);
      expect(result.deliveries[0]).toEqual({
        shipmentId: 'ship-1',
        payout: '4000.00',
        deliveredAt: new Date('2026-08-01'),
      });
    });

    it('treats a null riderPayout as zero rather than throwing', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());
      shipmentsRepo.find.mockResolvedValue([
        { id: 'ship-1', riderPayout: null, deliveredAt: null },
      ]);

      const result = await service.getEarnings(USER_ID);

      expect(result.totalEarnings).toBe('0.00');
      expect(result.deliveries[0].deliveredAt).toBeNull();
    });

    it('returns a zero total with no deliveries when the rider has none yet', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());
      shipmentsRepo.find.mockResolvedValue([]);

      const result = await service.getEarnings(USER_ID);

      expect(result.totalEarnings).toBe('0.00');
      expect(result.deliveries).toEqual([]);
    });
  });

  describe('verify', () => {
    it('flips an ONBOARDING rider to ACTIVE and stamps documentsVerifiedAt', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ status: RiderStatus.ONBOARDING }));

      const result = await service.verify(RIDER_ID);

      expect(ridersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: RiderStatus.ACTIVE }),
      );
      expect(result.documentsVerifiedAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException for an unknown rider id', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(service.verify('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('refuses to verify a SUSPENDED rider directly', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ status: RiderStatus.SUSPENDED }));

      await expect(service.verify(RIDER_ID)).rejects.toThrow(ConflictException);
      expect(ridersRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the rider profile when one exists', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());

      const result = await service.findById(RIDER_ID);

      expect(result.id).toBe(RIDER_ID);
      expect(ridersRepo.findOne).toHaveBeenCalledWith({ where: { id: RIDER_ID } });
    });

    it('throws NotFoundException for an unknown rider id', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reviewDocument', () => {
    const approveDto: ReviewRiderDocumentDto = { status: DocumentReviewStatus.APPROVED };
    const rejectDto: ReviewRiderDocumentDto = {
      status: DocumentReviewStatus.REJECTED,
      reason: 'Photo is blurry, resubmit',
    };

    it('approves a document and stamps reviewedAt', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());

      const result = await service.reviewDocument(RIDER_ID, RiderDocumentType.LICENSE, approveDto);

      const review = result.documentReviews[RiderDocumentType.LICENSE];
      expect(review?.status).toBe(DocumentReviewStatus.APPROVED);
      expect(review?.reason).toBeNull();
      expect(review?.reviewedAt).not.toBeNull();
    });

    it('rejects a document and stores the reason', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());

      const result = await service.reviewDocument(RIDER_ID, RiderDocumentType.INSURANCE, rejectDto);

      const review = result.documentReviews[RiderDocumentType.INSURANCE];
      expect(review?.status).toBe(DocumentReviewStatus.REJECTED);
      expect(review?.reason).toBe('Photo is blurry, resubmit');
    });

    it('throws BadRequestException when rejecting without a reason', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider());

      await expect(
        service.reviewDocument(RIDER_ID, RiderDocumentType.INSURANCE, {
          status: DocumentReviewStatus.REJECTED,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(ridersRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the document was never uploaded', async () => {
      ridersRepo.findOne.mockResolvedValue(baseRider({ insuranceDocumentUrl: null }));

      await expect(
        service.reviewDocument(RIDER_ID, RiderDocumentType.INSURANCE, approveDto),
      ).rejects.toThrow(BadRequestException);
      expect(ridersRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown rider id', async () => {
      ridersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reviewDocument('unknown-id', RiderDocumentType.ID, approveDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('leaves other documents’ review state untouched', async () => {
      const rider = baseRider({
        documentReviews: {
          [RiderDocumentType.ID]: {
            status: DocumentReviewStatus.APPROVED,
            reason: null,
            reviewedAt: '2026-08-01T00:00:00.000Z',
          },
        },
      });
      ridersRepo.findOne.mockResolvedValue(rider);

      const result = await service.reviewDocument(RIDER_ID, RiderDocumentType.LICENSE, approveDto);

      expect(result.documentReviews[RiderDocumentType.ID]?.status).toBe(DocumentReviewStatus.APPROVED);
      expect(result.documentReviews[RiderDocumentType.LICENSE]?.status).toBe(DocumentReviewStatus.APPROVED);
    });
  });
});
