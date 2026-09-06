import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 2 (Intercity/Trunk Network) — physical transfer points a Leg
// hands off at. First table of the Phase 2 build; see
// docs/delivery-notes/PHASE2_INTERCITY_FOUNDATION.md for the full pass.
export class CreateHubsTable1787430000000 implements MigrationInterface {
  name = 'CreateHubsTable1787430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "hubs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "city" varchar(100) NOT NULL,
        "latitude" decimal(10,8) NOT NULL,
        "longitude" decimal(11,8) NOT NULL,
        "address" text NOT NULL,
        "capacity_kg" int,
        "manager_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Every hub lookup for planning an intercity leg is "which hub(s)
    // serve this city" — the one index that matters at this scale.
    await queryRunner.query(`
      CREATE INDEX "idx_hubs_city" ON "hubs" ("city");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "hubs";`);
  }
}
