import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, IsNull, MoreThan, Repository } from 'typeorm';
import {
  PricingConfig,
  SurgeWindow,
} from '../../database/entities/pricing-config.entity';
import { centsFromDecimal, decimalFromCents } from '../../common/money';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { CreatePricingConfigDto } from './dto/create-pricing-config.dto';
import { UpdatePricingConfigDto } from './dto/update-pricing-config.dto';

const COMMISSION_SPLIT_TOLERANCE = 0.01;

export interface PriceQuote {
  pricingConfigId: string;
  basePrice: string;
  distanceCharge: string;
  weightCharge: string;
  subtotal: string;
  surgeMultiplier: string;
  surgeAmount: string;
  price: string;
  commission: string;
  riderPayout: string;
}

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingConfig)
    private readonly configRepo: Repository<PricingConfig>,
  ) {}

  async calculatePrice(dto: CalculatePriceDto): Promise<PriceQuote> {
    const at = dto.at ? new Date(dto.at) : new Date();
    const config = await this.getEffectiveConfig(at);

    const baseCents = centsFromDecimal(config.basePrice);

    const billableDistanceKm = Math.max(
      0,
      dto.distanceKm - Number(config.includedDistanceKm),
    );
    const distanceCents = Math.round(
      billableDistanceKm * centsFromDecimal(config.pricePerKm),
    );

    const weightKg = dto.weightKg ?? 0;
    const billableWeightKg = Math.max(0, weightKg - Number(config.includedWeightKg));
    const weightCents = Math.round(
      billableWeightKg * centsFromDecimal(config.pricePerKg),
    );

    const subtotalCents = baseCents + distanceCents + weightCents;

    const surgeMultiplier =
      dto.surgeMultiplier ?? this.calculateSurgeMultiplier(config, at);
    // Round the surged total once, from the subtotal — not by rounding
    // each component separately — so the multiplier applies to the same
    // number a customer sees as "subtotal" in the breakdown.
    const surgedCents = Math.round(subtotalCents * surgeMultiplier);
    const surgeAmountCents = surgedCents - subtotalCents;

    let totalCents = surgedCents;
    if (config.minPrice != null) {
      totalCents = Math.max(totalCents, centsFromDecimal(config.minPrice));
    }
    if (config.maxPrice != null) {
      totalCents = Math.min(totalCents, centsFromDecimal(config.maxPrice));
    }

    const commissionPercent = Number(config.platformCommissionPercent);
    const commissionCents = Math.round(totalCents * (commissionPercent / 100));
    // Rider gets the remainder rather than its own rounded percentage,
    // so commission + riderPayout always reconciles exactly to the
    // customer's total (no stray cent lost to double-rounding).
    const riderPayoutCents = totalCents - commissionCents;

    return {
      pricingConfigId: config.id,
      basePrice: decimalFromCents(baseCents),
      distanceCharge: decimalFromCents(distanceCents),
      weightCharge: decimalFromCents(weightCents),
      subtotal: decimalFromCents(subtotalCents),
      surgeMultiplier: surgeMultiplier.toFixed(2),
      surgeAmount: decimalFromCents(surgeAmountCents),
      price: decimalFromCents(totalCents),
      commission: decimalFromCents(commissionCents),
      riderPayout: decimalFromCents(riderPayoutCents),
    };
  }

  // Public/no-auth: "what would this cost right now" for the active config.
  async getActiveConfig(): Promise<PricingConfig> {
    return this.getEffectiveConfig(new Date());
  }

  async getAllConfigs(): Promise<PricingConfig[]> {
    return this.configRepo.find({ order: { effectiveFrom: 'DESC' } });
  }

  async createConfig(
    dto: CreatePricingConfigDto,
    adminUserId: string,
  ): Promise<PricingConfig> {
    this.assertValidCommissionSplit(
      dto.platformCommissionPercent,
      dto.riderPayoutPercent,
    );
    this.assertValidSurgeWindows(dto.surgeActiveHours);

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    // Only one config is ever active at a time in Phase 1 — close out
    // whatever was active before inserting the new one, rather than
    // leaving two configs both claiming isActive=true (which would make
    // getEffectiveConfig()'s "most recent effectiveFrom" tiebreak the
    // only thing keeping quotes deterministic).
    await this.configRepo.update(
      { isActive: true },
      { isActive: false, effectiveTo: effectiveFrom },
    );

    const config = this.configRepo.create({
      pricingMode: dto.pricingMode,
      isActive: true,
      basePrice: dto.basePrice.toString(),
      pricePerKm: (dto.pricePerKm ?? 0).toString(),
      includedDistanceKm: (dto.includedDistanceKm ?? 0).toString(),
      pricePerKg: (dto.pricePerKg ?? 0).toString(),
      includedWeightKg: (dto.includedWeightKg ?? 0).toString(),
      platformCommissionPercent: dto.platformCommissionPercent.toString(),
      riderPayoutPercent: dto.riderPayoutPercent.toString(),
      surgeMultiplier: (dto.surgeMultiplier ?? 1).toString(),
      surgeActiveHours: dto.surgeActiveHours ?? null,
      minPrice: dto.minPrice != null ? dto.minPrice.toString() : null,
      maxPrice: dto.maxPrice != null ? dto.maxPrice.toString() : null,
      effectiveFrom,
      effectiveTo: null,
      createdBy: adminUserId,
    });

    return this.configRepo.save(config);
  }

  async updateConfig(
    id: string,
    dto: UpdatePricingConfigDto,
  ): Promise<PricingConfig> {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) {
      throw new NotFoundException(`Pricing config ${id} not found`);
    }

    const nextCommission =
      dto.platformCommissionPercent ?? Number(config.platformCommissionPercent);
    const nextRiderPayout =
      dto.riderPayoutPercent ?? Number(config.riderPayoutPercent);
    if (
      dto.platformCommissionPercent !== undefined ||
      dto.riderPayoutPercent !== undefined
    ) {
      this.assertValidCommissionSplit(nextCommission, nextRiderPayout);
    }
    if (dto.surgeActiveHours !== undefined) {
      this.assertValidSurgeWindows(dto.surgeActiveHours);
    }

    if (dto.pricingMode !== undefined) config.pricingMode = dto.pricingMode;
    if (dto.isActive !== undefined) config.isActive = dto.isActive;
    if (dto.basePrice !== undefined) config.basePrice = dto.basePrice.toString();
    if (dto.pricePerKm !== undefined) config.pricePerKm = dto.pricePerKm.toString();
    if (dto.includedDistanceKm !== undefined) {
      config.includedDistanceKm = dto.includedDistanceKm.toString();
    }
    if (dto.pricePerKg !== undefined) config.pricePerKg = dto.pricePerKg.toString();
    if (dto.includedWeightKg !== undefined) {
      config.includedWeightKg = dto.includedWeightKg.toString();
    }
    if (dto.platformCommissionPercent !== undefined) {
      config.platformCommissionPercent = dto.platformCommissionPercent.toString();
    }
    if (dto.riderPayoutPercent !== undefined) {
      config.riderPayoutPercent = dto.riderPayoutPercent.toString();
    }
    if (dto.surgeMultiplier !== undefined) {
      config.surgeMultiplier = dto.surgeMultiplier.toString();
    }
    if (dto.surgeActiveHours !== undefined) {
      config.surgeActiveHours = dto.surgeActiveHours;
    }
    if (dto.minPrice !== undefined) config.minPrice = dto.minPrice.toString();
    if (dto.maxPrice !== undefined) config.maxPrice = dto.maxPrice.toString();

    return this.configRepo.save(config);
  }

  // The config active at instant `at`: isActive, started by `at`, and
  // (if it has an end) not yet ended. Ties broken by most recent
  // effectiveFrom — matters right after createConfig() runs, in the
  // instant both the old (now effectiveTo = at) and new config could
  // otherwise both match a query for exactly `at`.
  private async getEffectiveConfig(at: Date): Promise<PricingConfig> {
    const config = await this.configRepo.findOne({
      where: [
        {
          isActive: true,
          effectiveFrom: LessThanOrEqual(at),
          effectiveTo: MoreThan(at),
        },
        {
          isActive: true,
          effectiveFrom: LessThanOrEqual(at),
          effectiveTo: IsNull(),
        },
      ],
      order: { effectiveFrom: 'DESC' },
    });

    if (!config) {
      throw new NotFoundException('No active pricing configuration for this time');
    }

    return config;
  }

  private calculateSurgeMultiplier(config: PricingConfig, at: Date): number {
    if (!config.surgeActiveHours || config.surgeActiveHours.length === 0) {
      return 1;
    }

    const hour = at.getHours();
    const inSurgeWindow = config.surgeActiveHours.some(
      ([start, end]) => hour >= start && hour < end,
    );

    return inSurgeWindow ? Number(config.surgeMultiplier) : 1;
  }

  private assertValidCommissionSplit(commission: number, riderPayout: number): void {
    if (Math.abs(commission + riderPayout - 100) > COMMISSION_SPLIT_TOLERANCE) {
      throw new BadRequestException(
        `platformCommissionPercent + riderPayoutPercent must equal 100 (got ${commission} + ${riderPayout})`,
      );
    }
  }

  private assertValidSurgeWindows(windows: SurgeWindow[] | undefined): void {
    if (!windows) return;

    for (const window of windows) {
      const [start, end] = window;
      const valid =
        Array.isArray(window) &&
        window.length === 2 &&
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        start <= 23 &&
        end >= 1 &&
        end <= 24 &&
        end > start;

      if (!valid) {
        throw new BadRequestException(
          `Invalid surge window [${window}] — expected [startHour, endHour) with 0 <= startHour < endHour <= 24`,
        );
      }
    }
  }
}
