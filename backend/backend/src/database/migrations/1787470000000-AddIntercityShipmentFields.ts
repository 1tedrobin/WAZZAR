import { MigrationInterface, QueryRunner } from 'typeorm';

// Additive — see Shipment.shipmentType/legCount/currentLeg for the
// entity-side notes. Every existing row gets shipment_type='LOCAL' (the
// column default), leg_count/current_leg NULL — no behavior change for
// any Phase 1 shipment, nothing to backfill.
export class AddIntercityShipmentFields1787470000000 implements MigrationInterface {
  name = 'AddIntercityShipmentFields1787470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "shipments_shipment_type_enum" AS ENUM ('LOCAL', 'INTERCITY');
    `);

    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD COLUMN "shipment_type" "shipments_shipment_type_enum" NOT NULL DEFAULT 'LOCAL',
        ADD COLUMN "leg_count" int,
        ADD COLUMN "current_leg" int;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP COLUMN "current_leg",
        DROP COLUMN "leg_count",
        DROP COLUMN "shipment_type";
    `);
    await queryRunner.query(`DROP TYPE "shipments_shipment_type_enum";`);
  }
}
