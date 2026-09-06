import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4 multi-currency core, first piece: a `currency` column on every
// table that stores a money amount, all defaulting to 'TZS' so Phase 1
// behavior (single-currency, Dar es Salaam) is completely unaffected —
// existing rows backfill to 'TZS' and every new row defaults to it unless
// something explicitly asks for a different currency. See
// src/common/currency.ts for the registry this enum must stay in sync
// with (add new currencies there AND with a follow-up migration that
// runs `ALTER TYPE ... ADD VALUE`, never by editing this one).
//
// pricing_configs also gets its "only one active config at a time"
// invariant rescoped to (currency), not global — see the updated partial
// index below and PricingService.createConfig(), which now only
// deactivates other active configs in the SAME currency. Without this, a
// KES pricing config would deactivate the TZS one on creation, which
// would break Phase 1 the moment a second market's pricing is added.
export class AddCurrencyToMoneyTables1787380000000 implements MigrationInterface {
  name = 'AddCurrencyToMoneyTables1787380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "currency_code_enum" AS ENUM ('TZS', 'KES', 'UGX', 'RWF');
    `);

    await queryRunner.query(`
      ALTER TABLE "pricing_configs"
        ADD COLUMN "currency" "currency_code_enum" NOT NULL DEFAULT 'TZS';
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD COLUMN "currency" "currency_code_enum" NOT NULL DEFAULT 'TZS';
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD COLUMN "currency" "currency_code_enum" NOT NULL DEFAULT 'TZS';
    `);

    // Replace the old global "one active config" partial index with one
    // scoped per currency — matches the rescoped invariant described
    // above. Old index name kept unavailable (dropped) so nothing
    // silently keeps relying on the global version.
    await queryRunner.query(`
      DROP INDEX "idx_pricing_configs_active";
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pricing_configs_active_by_currency"
        ON "pricing_configs" ("currency", "effective_from" DESC)
        WHERE "is_active" = true;
    `);

    // Payments and shipments are usually looked up per-market too (e.g.
    // a reconciliation report scoped to one currency) — cheap to add now
    // alongside the column rather than as a follow-up migration once
    // Phase 4 traffic actually exists.
    await queryRunner.query(`
      CREATE INDEX "idx_payments_currency" ON "payments" ("currency");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_currency" ON "shipments" ("currency");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_shipments_currency";`);
    await queryRunner.query(`DROP INDEX "idx_payments_currency";`);
    await queryRunner.query(`DROP INDEX "idx_pricing_configs_active_by_currency";`);
    await queryRunner.query(`
      CREATE INDEX "idx_pricing_configs_active" ON "pricing_configs" ("effective_from" DESC)
        WHERE "is_active" = true;
    `);

    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "currency";`);
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN "currency";`);
    await queryRunner.query(`ALTER TABLE "pricing_configs" DROP COLUMN "currency";`);

    await queryRunner.query(`DROP TYPE "currency_code_enum";`);
  }
}
