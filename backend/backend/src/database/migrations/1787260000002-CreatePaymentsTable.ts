import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentsTable1787260000002 implements MigrationInterface {
  name = 'CreatePaymentsTable1787260000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TYPE "payments_method_enum" AS ENUM ('MPESA', 'STRIPE', 'CASH');
    `);

    await queryRunner.query(`
      CREATE TYPE "payments_status_enum" AS ENUM (
        'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED',
        'PARTIALLY_REFUNDED', 'PENDING_CASH_COLLECTION'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "shipment_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "method" "payments_method_enum" NOT NULL,
        "status" "payments_status_enum" NOT NULL DEFAULT 'PENDING',
        "amount" decimal(12,2) NOT NULL,
        "external_id" varchar(255) UNIQUE,
        "provider" varchar(50),
        "error_message" text,
        "refunded_amount" decimal(12,2) NOT NULL DEFAULT 0,
        "refund_reason" text,
        "metadata" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "completed_at" timestamp,
        "failed_at" timestamp,
        CONSTRAINT "fk_payments_shipment"
          FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_payments_customer"
          FOREIGN KEY ("customer_id") REFERENCES "users" ("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_payments_shipment" ON "payments" ("shipment_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_payments_customer" ON "payments" ("customer_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_payments_status" ON "payments" ("status");
    `);
    // external_id already has a UNIQUE constraint (which Postgres backs
    // with an index), but that index doesn't cover the common webhook
    // lookup pattern of "find the PROCESSING payment for this id" as
    // tightly as a plain btree on the column alone in all query plans —
    // cheap enough to add explicitly and keep the intent obvious.
    await queryRunner.query(`
      CREATE INDEX "idx_payments_external_id" ON "payments" ("external_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payments";`);
    await queryRunner.query(`DROP TYPE "payments_status_enum";`);
    await queryRunner.query(`DROP TYPE "payments_method_enum";`);
  }
}
