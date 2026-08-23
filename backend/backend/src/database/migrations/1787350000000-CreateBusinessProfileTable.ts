import { MigrationInterface, QueryRunner } from 'typeorm';

// Business account profile table. Replaces client-side localStorage
// storage of business name, category, and default pickup location.
// One row per business account (one-to-one on users table via businessId).
//
// Previously the frontend stored this in `localStorage` under
// `wazzar_business_profile_<userId>`. This migration moves it to the
// backend so it persists and syncs across devices. Existing deployments
// with no profile are fine — the frontend treats NULL as "not set, fill
// in the Settings screen on first use."
export class CreateBusinessProfileTable1787350000000 implements MigrationInterface {
  name = 'CreateBusinessProfileTable1787350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "business_profiles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
        "business_name" varchar(150) NOT NULL,
        "category" varchar(100),
        "pickup_latitude" float,
        "pickup_longitude" float,
        "pickup_address" varchar(500),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Index for quick lookup by business_id (used in controller/service).
    await queryRunner.query(`
      CREATE INDEX "idx_business_profiles_business_id" ON "business_profiles" ("business_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "business_profiles";`);
  }
}
