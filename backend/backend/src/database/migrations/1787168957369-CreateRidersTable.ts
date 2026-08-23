import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRidersTable1787168957369 implements MigrationInterface {
  name = 'CreateRidersTable1787168957369';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "riders_status_enum" AS ENUM (
        'ONBOARDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "riders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL UNIQUE,
        "vehicle_type" varchar(50),
        "vehicle_registration" varchar(100),
        "license_number" varchar(100),
        "insurance_expires_at" date,
        "documents_verified_at" timestamp,
        "status" "riders_status_enum" NOT NULL DEFAULT 'ONBOARDING',
        "is_online" boolean NOT NULL DEFAULT false,
        "total_earnings" decimal(12,2) NOT NULL DEFAULT 0,
        "rating_avg" decimal(3,2),
        "rating_count" int NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_riders_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_riders_status" ON "riders" ("status");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_riders_online" ON "riders" ("is_online")
        WHERE "is_online" = true;
    `);

    // shipments.rider_id has been a plain (unconstrained) uuid column
    // since the Shipments migration — riders didn't exist yet to
    // reference. Add the FK now that they do (see the comment this
    // resolves in shipment.entity.ts). Existing rows are all NULL here
    // (no assignment endpoint has ever written to rider_id), so this is
    // safe to add without a backfill.
    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD CONSTRAINT "fk_shipments_rider"
        FOREIGN KEY ("rider_id") REFERENCES "riders" ("id") ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipments" DROP CONSTRAINT "fk_shipments_rider";`,
    );
    await queryRunner.query(`DROP TABLE "riders";`);
    await queryRunner.query(`DROP TYPE "riders_status_enum";`);
  }
}
