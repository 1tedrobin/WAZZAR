import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessProfile } from '../../database/entities/business-profile.entity';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

@Injectable()
export class BusinessProfileService {
  constructor(
    @InjectRepository(BusinessProfile)
    private repo: Repository<BusinessProfile>,
  ) {}

  /**
   * Get a business's profile, or create a minimal one if it doesn't exist.
   * This ensures every business account that logs in has a profile to read/write.
   */
  async getOrCreateProfile(
    businessId: string,
  ): Promise<BusinessProfile> {
    let profile = await this.repo.findOne({
      where: { businessId },
    });

    if (!profile) {
      profile = this.repo.create({
        businessId,
        businessName: `Business ${businessId.slice(0, 8)}`,
        category: null,
        pickupLatitude: null,
        pickupLongitude: null,
        pickupAddress: null,
      });
      await this.repo.save(profile);
    }

    return profile;
  }

  /**
   * Get an existing profile; throw 404 if not found.
   * Used when the frontend explicitly requests the profile.
   */
  async getProfile(businessId: string): Promise<BusinessProfile> {
    const profile = await this.repo.findOne({
      where: { businessId },
    });

    if (!profile) {
      throw new NotFoundException('Business profile not found');
    }

    return profile;
  }

  /**
   * Update a profile. Creates one if it doesn't exist.
   */
  async updateProfile(
    businessId: string,
    dto: UpdateBusinessProfileDto,
  ): Promise<BusinessProfile> {
    let profile = await this.repo.findOne({
      where: { businessId },
    });

    if (!profile) {
      profile = this.repo.create({
        businessId,
        businessName: dto.businessName || `Business ${businessId.slice(0, 8)}`,
        category: dto.category ?? null,
        pickupLatitude: dto.pickupLatitude ?? null,
        pickupLongitude: dto.pickupLongitude ?? null,
        pickupAddress: dto.pickupAddress ?? null,
      });
    } else {
      if (dto.businessName !== undefined) profile.businessName = dto.businessName;
      if (dto.category !== undefined) profile.category = dto.category;
      if (dto.pickupLatitude !== undefined) profile.pickupLatitude = dto.pickupLatitude;
      if (dto.pickupLongitude !== undefined) profile.pickupLongitude = dto.pickupLongitude;
      if (dto.pickupAddress !== undefined) profile.pickupAddress = dto.pickupAddress;
    }

    return this.repo.save(profile);
  }
}
