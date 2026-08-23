/**
 * Seeds an initial active PricingConfig, idempotently.
 *
 * This exists because a fresh database has zero rows in pricing_configs,
 * and PricingService.getEffectiveConfig() throws NotFoundException when
 * none exists — which means POST /pricing/calculate and every path that
 * calls it (customer/business shipment creation, the New Delivery modal
 * in both wired apps) fails immediately on a clean install. There's no
 * bootstrap route for this by design (PricingConfig writes are
 * @Roles(ADMIN, SUPER_ADMIN)-gated, same reasoning as the admin seed),
 * so — like the first admin account — the first pricing config needs an
 * out-of-band script too.
 *
 * Usage:
 *   cd backend
 *   npm run db:seed:pricing
 *
 * All fields are optional env var overrides with workable defaults for
 * local dev — nothing is required to just run it:
 *   SEED_PRICING_MODE                  DISTANCE | WEIGHT | HYBRID, default HYBRID
 *   SEED_PRICING_BASE_PRICE            default 2000        (TZS)
 *   SEED_PRICING_PER_KM                default 500         (TZS/km)
 *   SEED_PRICING_INCLUDED_DISTANCE_KM  default 2
 *   SEED_PRICING_PER_KG                default 300         (TZS/kg)
 *   SEED_PRICING_INCLUDED_WEIGHT_KG    default 1
 *   SEED_PRICING_COMMISSION_PERCENT    default 20           } must sum to 100,
 *   SEED_PRICING_RIDER_PAYOUT_PERCENT  default 80           } same as CreatePricingConfigDto
 *   SEED_PRICING_SURGE_MULTIPLIER      default 1.5
 *   SEED_PRICING_MIN_PRICE             default 1500
 *   SEED_PRICING_MAX_PRICE             unset (no cap)
 *
 * Surge windows default to 07:00-10:00 and 17:00-20:00 (weekday rush
 * hours) — matches the [[startHour, endHour), ...] shape
 * PricingService.calculateSurgeMultiplier() expects.
 *
 * Idempotent: if an active config already exists, the script leaves it
 * alone and exits — it does NOT deactivate/replace it the way
 * PricingService.createConfig() does for an admin-initiated price
 * change. This script's only job is making sure a fresh database isn't
 * stuck with zero configs; it's not a tool for rolling out a new price.
 * Use PUT /pricing/configs/:id or POST /pricing/configs (admin-only) for
 * that once the system is live.
 */
import 'reflect-metadata';
import { dataSourceOptions } from '../data-source';
import { DataSource } from 'typeorm';
import { PricingConfig, PricingMode, SurgeWindow } from '../entities/pricing-config.entity';

const COMMISSION_SPLIT_TOLERANCE = 0.01;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    console.error(`${name} must be a number, got "${raw}". Aborting.`);
    process.exit(1);
  }
  return parsed;
}

async function seedPricing() {
  const modeInput = (process.env.SEED_PRICING_MODE || 'HYBRID').toUpperCase();
  if (!Object.values(PricingMode).includes(modeInput as PricingMode)) {
    console.error(
      `SEED_PRICING_MODE must be one of ${Object.values(PricingMode).join(', ')}, got "${modeInput}". Aborting.`,
    );
    process.exit(1);
  }
  const pricingMode = modeInput as PricingMode;

  const basePrice = envNumber('SEED_PRICING_BASE_PRICE', 2000);
  const pricePerKm = envNumber('SEED_PRICING_PER_KM', 500);
  const includedDistanceKm = envNumber('SEED_PRICING_INCLUDED_DISTANCE_KM', 2);
  const pricePerKg = envNumber('SEED_PRICING_PER_KG', 300);
  const includedWeightKg = envNumber('SEED_PRICING_INCLUDED_WEIGHT_KG', 1);
  const platformCommissionPercent = envNumber('SEED_PRICING_COMMISSION_PERCENT', 20);
  const riderPayoutPercent = envNumber('SEED_PRICING_RIDER_PAYOUT_PERCENT', 80);
  const surgeMultiplier = envNumber('SEED_PRICING_SURGE_MULTIPLIER', 1.5);
  const minPrice = envNumber('SEED_PRICING_MIN_PRICE', 1500);
  const maxPriceRaw = process.env.SEED_PRICING_MAX_PRICE;
  const maxPrice = maxPriceRaw !== undefined && maxPriceRaw !== '' ? Number(maxPriceRaw) : null;

  // Same check as PricingService.assertValidCommissionSplit — fail fast
  // here rather than saving a config that would silently misprice every
  // shipment quoted against it.
  if (
    Math.abs(platformCommissionPercent + riderPayoutPercent - 100) >
    COMMISSION_SPLIT_TOLERANCE
  ) {
    console.error(
      `SEED_PRICING_COMMISSION_PERCENT + SEED_PRICING_RIDER_PAYOUT_PERCENT must equal 100 ` +
        `(got ${platformCommissionPercent} + ${riderPayoutPercent}). Aborting.`,
    );
    process.exit(1);
  }

  const surgeActiveHours: SurgeWindow[] = [
    [7, 10],
    [17, 20],
  ];

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  const configRepo = dataSource.getRepository(PricingConfig);

  try {
    const existingActive = await configRepo.findOne({ where: { isActive: true } });

    if (existingActive) {
      console.log(
        `An active pricing config already exists (${existingActive.id}, ` +
          `effective from ${existingActive.effectiveFrom.toISOString()}) — not modifying it. ` +
          `Use PUT /pricing/configs/${existingActive.id} or POST /pricing/configs to change pricing.`,
      );
      return;
    }

    const config = configRepo.create({
      pricingMode,
      isActive: true,
      basePrice: basePrice.toString(),
      pricePerKm: pricePerKm.toString(),
      includedDistanceKm: includedDistanceKm.toString(),
      pricePerKg: pricePerKg.toString(),
      includedWeightKg: includedWeightKg.toString(),
      platformCommissionPercent: platformCommissionPercent.toString(),
      riderPayoutPercent: riderPayoutPercent.toString(),
      surgeMultiplier: surgeMultiplier.toString(),
      surgeActiveHours,
      minPrice: minPrice != null ? minPrice.toString() : null,
      maxPrice: maxPrice != null ? maxPrice.toString() : null,
      effectiveFrom: new Date(),
      effectiveTo: null,
      createdBy: null,
    });

    const saved = await configRepo.save(config);
    console.log(`Created active pricing config ${saved.id}.`);
    console.log(
      `  ${pricingMode} mode — base ${basePrice}, +${pricePerKm}/km after ${includedDistanceKm}km, ` +
        `+${pricePerKg}/kg after ${includedWeightKg}kg, ${platformCommissionPercent}/${riderPayoutPercent} ` +
        `commission/rider split, ${surgeMultiplier}x surge 07:00-10:00 & 17:00-20:00.`,
    );
    console.log('Done. POST /pricing/calculate and shipment creation will now resolve a price.');
  } finally {
    await dataSource.destroy();
  }
}

seedPricing().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
