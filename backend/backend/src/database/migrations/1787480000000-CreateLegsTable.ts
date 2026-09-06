import { MigrationInterface, QueryRunner } from 'typeorm';

// Individual segments of an INTERCITY shipment. See Leg entity for the
// leg_type/rider_id/carrier_id design notes (two nullable FKs instead of
// one polymorphic assigned_to column).
export class CreateLegsTable1787480000000 implements MigrationInterface {
  name = 'CreateLegsTable1787480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "legs_leg_type_enum" AS ENUM ('LOCAL', 'TRUNK');
    `);
    await queryRunner.query(`
      CREATE TYPE "legs_status_enum" AS ENUM (
        'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "legs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "shipment_id" uuid NOT NULL REFERENCES "shipments" ("id") ON DELETE CASCADE,
        "leg_type" "legs_leg_type_enum" NOT NULL,
        "sequence" int NOT NULL,
        "from_location" jsonb NOT NULL,
        "to_location" jsonb NOT NULL,
        "from_hub_id" uuid REFERENCES "hubs" ("id") ON DELETE SET NULL,
        "to_hub_id" uuid REFERENCES "hubs" ("id") ON DELETE SET NULL,
        "status" "legs_status_enum" NOT NULL DEFAULT 'PENDING',
        "rider_id" uuid REFERENCES "riders" ("id") ON DELETE SET NULL,
        "carrier_id" uuid REFERENCES "carriers" ("id") ON DELETE SET NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "assigned_at" timestamp,
        "completed_at" timestamp,
        CONSTRAINT "uq_legs_shipment_sequence" UNIQUE ("shipment_id", "sequence")
      );
    `);

    // Every real query is "this shipment's legs, in order" or "the
    // dispatch queue: pending legs at/around a given hub" — the two
    // indexes LegsService actually needs.
    await queryRunner.query(`
      CREATE INDEX "idx_legs_shipment" ON "legs" ("shipment_id", "sequence");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_legs_status" ON "legs" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "legs";`);
    await queryRunner.query(`DROP TYPE "legs_status_enum";`);
    await queryRunner.query(`DROP TYPE "legs_leg_type_enum";`);
  }
}
