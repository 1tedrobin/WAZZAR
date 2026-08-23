import { MigrationInterface, QueryRunner } from 'typeorm';

// Third of the 4 originally-mock business screens, and the most
// involved: a schedule-definition row on its own is just another CRUD
// table (same shape as CreateBusinessCustomersTable), but it only
// becomes "scheduled deliveries" once something actually reads these
// rows on a timer and creates real shipments — see
// ScheduledDeliveriesCronService for that half.
//
// days_of_week and the two location columns are jsonb rather than a
// real Postgres integer[]/composite type — same reasoning as
// shipments.pickup_location/dropoff_location already being jsonb (see
// CreateShipmentsTable): one less TypeORM/driver array-type edge case,
// and none of these columns are ever filtered on directly in SQL.
export class CreateScheduledDeliveriesTable1787340000000
  implements MigrationInterface
{
  name = 'CreateScheduledDeliveriesTable1787340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "scheduled_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "pickup_location" jsonb NOT NULL,
        "dropoff_location" jsonb NOT NULL,
        "package_weight_kg" decimal(8,2),
        "package_description" text,
        "days_of_week" jsonb NOT NULL,
        "time_of_day" varchar(5) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "next_run_at" timestamptz NOT NULL,
        "last_run_at" timestamptz,
        "last_run_error" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Every list query is "give me this business's own schedules" —
    // same as business_customers.
    await queryRunner.query(`
      CREATE INDEX "idx_scheduled_deliveries_business_id" ON "scheduled_deliveries" ("business_id");
    `);

    // The cron job's own query: "every active schedule due by now" —
    // this is the index that keeps a once-a-minute tick cheap as the
    // table grows, since it's a straight range scan on active rows
    // instead of a full-table filter.
    await queryRunner.query(`
      CREATE INDEX "idx_scheduled_deliveries_due" ON "scheduled_deliveries" ("active", "next_run_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "scheduled_deliveries";`);
  }
}
