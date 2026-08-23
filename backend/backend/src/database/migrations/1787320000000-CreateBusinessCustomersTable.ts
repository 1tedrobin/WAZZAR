import { MigrationInterface, QueryRunner } from 'typeorm';

// New table for the business app's "Customers" screen — previously
// pure mock data (see docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md,
// "4 mock screens with no backend feature"). Deliberately scoped as a
// simple per-business address book (name/phone/address/notes a
// business saves for recipients they ship to repeatedly), NOT a link
// to real platform CUSTOMER accounts — a business's "customer" here is
// someone they deliver to, who may not even have a WAZZAR account.
//
// Known limitation, documented rather than silently glossed over: the
// old mock data showed "orders" and "lastOrder" columns (a running
// count/date derived from shipment history). Shipments currently have
// no recipient-phone field to match against an address-book entry by,
// so those derived stats are NOT part of this table or the API it
// backs — see BusinessCustomersService for exactly what's returned.
// Linking shipments to address-book entries is a natural follow-up,
// not done here.
export class CreateBusinessCustomersTable1787320000000 implements MigrationInterface {
  name = 'CreateBusinessCustomersTable1787320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "business_customers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(150) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "address" varchar(255) NOT NULL,
        "notes" varchar(500),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Every list query is "give me this business's address book" —
    // this is the one index that matters for this table.
    await queryRunner.query(`
      CREATE INDEX "idx_business_customers_business_id" ON "business_customers" ("business_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "business_customers";`);
  }
}
