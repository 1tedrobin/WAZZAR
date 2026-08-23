import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShipmentStatusesTable1787169347432 implements MigrationInterface {
  name = 'CreateShipmentStatusesTable1787169347432';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto already enabled by CreateShipmentsTable, but this migration
    // should be able to run standalone against a fresh DB too.
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "shipment_statuses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "shipment_id" uuid NOT NULL,
        "status" varchar(50) NOT NULL,
        "changed_by" uuid,
        "changed_at" timestamp NOT NULL DEFAULT now(),
        "reason" text,
        CONSTRAINT "fk_shipment_statuses_shipment"
          FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_shipment_statuses_shipment" ON "shipment_statuses" ("shipment_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "shipment_statuses";`);
  }
}
