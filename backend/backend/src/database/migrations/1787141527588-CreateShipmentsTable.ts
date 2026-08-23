import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShipmentsTable1787141527588 implements MigrationInterface {
  name = 'CreateShipmentsTable1787141527588';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TYPE "shipments_status_enum" AS ENUM (
        'CREATED', 'QUOTED', 'CONFIRMED', 'ASSIGNMENT_PENDING', 'ASSIGNED',
        'PICKUP_IN_PROGRESS', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY',
        'DELIVERED', 'COMPLETED', 'CANCELLED'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "shipments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id" uuid NOT NULL,
        "rider_id" uuid,
        "status" "shipments_status_enum" NOT NULL DEFAULT 'CREATED',
        "pickup_location" jsonb NOT NULL,
        "dropoff_location" jsonb NOT NULL,
        "package_weight_kg" decimal(8,2),
        "package_description" text,
        "price" decimal(12,2),
        "commission" decimal(12,2),
        "rider_payout" decimal(12,2),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "assigned_at" timestamp,
        "picked_up_at" timestamp,
        "delivered_at" timestamp,
        "completed_at" timestamp
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_shipments_customer" ON "shipments" ("customer_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_rider" ON "shipments" ("rider_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_status" ON "shipments" ("status");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_shipments_created" ON "shipments" ("created_at" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shipments";`);
    await queryRunner.query(`DROP TYPE "shipments_status_enum";`);
  }
}
