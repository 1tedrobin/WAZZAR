import { MigrationInterface, QueryRunner } from 'typeorm';

// Raw tracking-ping ingestion log for a Leg. See TrackingChannel entity
// for how this relates to tracking_events (below).
export class CreateTrackingChannelsTable1787490000000 implements MigrationInterface {
  name = 'CreateTrackingChannelsTable1787490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "tracking_channels_channel_type_enum" AS ENUM (
        'GPS_LIVE', 'LATRA_TRACKING', 'PARTNER_SCAN', 'SMS_WEBHOOK', 'DISPATCHER_MANUAL'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "tracking_channels" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "leg_id" uuid NOT NULL REFERENCES "legs" ("id") ON DELETE CASCADE,
        "channel_type" "tracking_channels_channel_type_enum" NOT NULL,
        "source" varchar(100),
        "event_data" jsonb NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "processed_at" timestamp
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_tracking_channels_leg" ON "tracking_channels" ("leg_id", "created_at" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tracking_channels";`);
    await queryRunner.query(`DROP TYPE "tracking_channels_channel_type_enum";`);
  }
}
