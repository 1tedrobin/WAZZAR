import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs the new POST /shipments/:id/rate-rider endpoint — see
// MASTER_GAPS_AND_ROADMAP.md ("Customer-rating endpoint"). One rating
// per shipment (rider_rating nullable — NULL means "not rated yet",
// the check that stops a customer rating twice).
export class AddShipmentRiderRating1787310000000 implements MigrationInterface {
  name = 'AddShipmentRiderRating1787310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD COLUMN "rider_rating" smallint,
        ADD CONSTRAINT "chk_shipments_rider_rating_range"
          CHECK ("rider_rating" IS NULL OR ("rider_rating" BETWEEN 1 AND 5));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP CONSTRAINT "chk_shipments_rider_rating_range",
        DROP COLUMN "rider_rating";
    `);
  }
}
