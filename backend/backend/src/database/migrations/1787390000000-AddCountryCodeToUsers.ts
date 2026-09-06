import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4 locale config, first piece: a `country_code` column on users so
// the system knows which market a customer belongs to, without requiring
// every request to carry an explicit currency. Defaults every existing
// row to 'TZ' — zero behavior change until a user actually registers
// with a different country. See src/common/market.ts for the registry.
export class AddCountryCodeToUsers1787390000000 implements MigrationInterface {
  name = 'AddCountryCodeToUsers1787390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "country_code_enum" AS ENUM ('TZ', 'KE', 'UG', 'RW');
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "country_code" "country_code_enum" NOT NULL DEFAULT 'TZ';
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_users_country_code" ON "users" ("country_code");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_country_code";`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "country_code";`);
    await queryRunner.query(`DROP TYPE "country_code_enum";`);
  }
}
