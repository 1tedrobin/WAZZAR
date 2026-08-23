import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePricingConfigsTable1787260000001 implements MigrationInterface {
  name = 'CreatePricingConfigsTable1787260000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto already enabled by CreateShipmentsTable, but this migration
    // should be able to run standalone against a fresh DB too.
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TYPE "pricing_configs_pricing_mode_enum" AS ENUM (
        'DISTANCE', 'WEIGHT', 'HYBRID'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "pricing_configs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "pricing_mode" "pricing_configs_pricing_mode_enum" NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "base_price" decimal(12,2) NOT NULL,
        "price_per_km" decimal(12,2) NOT NULL DEFAULT 0,
        "included_distance_km" decimal(8,2) NOT NULL DEFAULT 0,
        "price_per_kg" decimal(12,2) NOT NULL DEFAULT 0,
        "included_weight_kg" decimal(8,2) NOT NULL DEFAULT 0,
        "platform_commission_percent" decimal(5,2) NOT NULL,
        "rider_payout_percent" decimal(5,2) NOT NULL,
        "surge_multiplier" decimal(5,2) NOT NULL DEFAULT 1.00,
        "surge_active_hours" jsonb,
        "min_price" decimal(12,2),
        "max_price" decimal(12,2),
        "effective_from" timestamp NOT NULL,
        "effective_to" timestamp,
        "metadata" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "created_by" uuid,
        CONSTRAINT "chk_pricing_configs_commission_split"
          CHECK ("platform_commission_percent" + "rider_payout_percent" = 100)
      );
    `);

    // Partial index: fast lookup of "which config is active right now" —
    // the query PricingService.getEffectiveConfig() runs on every quote.
    await queryRunner.query(`
      CREATE INDEX "idx_pricing_configs_active" ON "pricing_configs" ("effective_from" DESC)
        WHERE "is_active" = true;
    `);

    await queryRunner.query(`
      INSERT INTO "pricing_configs" (
        "pricing_mode", "is_active", "base_price", "price_per_km",
        "included_distance_km", "price_per_kg", "included_weight_kg",
        "platform_commission_percent", "rider_payout_percent",
        "surge_multiplier", "surge_active_hours", "min_price", "max_price",
        "effective_from"
      ) VALUES (
        'HYBRID', true, 5000, 500,
        1, 1000, 0.5,
        20, 80,
        1.5, '[[8,11],[17,21]]', 2000, 50000,
        now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pricing_configs";`);
    await queryRunner.query(`DROP TYPE "pricing_configs_pricing_mode_enum";`);
  }
}
