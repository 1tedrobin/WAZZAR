import { MigrationInterface, QueryRunner } from 'typeorm';

// Normalized, customer/dispatcher-facing tracking timeline for a Leg.
// See TrackingEvent entity for how this relates to tracking_channels
// (above).
export class CreateTrackingEventsTable1787500000000 implements MigrationInterface {
  name = 'CreateTrackingEventsTable1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "tracking_events_event_type_enum" AS ENUM (
        'LOCATION_UPDATE', 'STATUS_CHANGE', 'HUB_HANDOFF'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "tracking_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "leg_id" uuid NOT NULL REFERENCES "legs" ("id") ON DELETE CASCADE,
        "event_type" "tracking_events_event_type_enum" NOT NULL,
        "metadata" jsonb NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_tracking_events_leg" ON "tracking_events" ("leg_id", "created_at" ASC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tracking_events";`);
    await queryRunner.query(`DROP TYPE "tracking_events_event_type_enum";`);
  }
}
