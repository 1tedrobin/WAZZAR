import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRiderLocationsTable1787180512044 implements MigrationInterface {
  name = 'CreateRiderLocationsTable1787180512044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // rider_id is the primary key, not a separate id column — there is
    // only ever one "current location" row per rider, so an upsert keyed
    // on rider_id is exactly what a primary key gives for free.
    await queryRunner.query(`
      CREATE TABLE "rider_locations" (
        "rider_id" uuid PRIMARY KEY,
        "latitude" decimal(10,8) NOT NULL,
        "longitude" decimal(11,8) NOT NULL,
        "accuracy_meters" int,
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_rider_locations_rider"
          FOREIGN KEY ("rider_id") REFERENCES "riders" ("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rider_locations";`);
  }
}
