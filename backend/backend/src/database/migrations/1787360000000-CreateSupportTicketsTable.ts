import { MigrationInterface, QueryRunner } from 'typeorm';

// Fills the last of the three admin pages the frontend has been
// carrying as an honest NOT_WIRED stub (see README_ADMIN_WIRING.md) —
// customers and businesses are still genuinely out of scope, but
// support/ticketing is the one an admin needs day-one to operate the
// platform at all, so it's built first of the three.
//
// Two tables, not one: a ticket's mutable header (status/priority/
// assignment) and its append-only message thread change at different
// rates and are read differently (list view needs only the header;
// detail view needs the full thread) — same split shipments/
// shipment_status_history already uses.
export class CreateSupportTicketsTable1787360000000
  implements MigrationInterface
{
  name = 'CreateSupportTicketsTable1787360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    // raised_by_role / author_role deliberately get their own enum types
    // (not a reference to the existing user_roles_role_enum) — same
    // per-table-enum convention as business_staff_role_enum vs. the
    // platform Role enum. Keeps this migration independent of whatever
    // values user_roles_role_enum grows later (e.g. DISPATCHER, which
    // can never actually raise or reply to a ticket as itself today).
    await queryRunner.query(`
      CREATE TYPE "support_tickets_raised_by_role_enum" AS ENUM ('CUSTOMER', 'RIDER', 'BUSINESS', 'DISPATCHER', 'ADMIN', 'SUPER_ADMIN');
    `);
    await queryRunner.query(`
      CREATE TYPE "support_tickets_category_enum" AS ENUM ('DELIVERY_ISSUE', 'PAYMENT_ISSUE', 'ACCOUNT_ISSUE', 'OTHER');
    `);
    await queryRunner.query(`
      CREATE TYPE "support_tickets_priority_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
    `);
    await queryRunner.query(`
      CREATE TYPE "support_tickets_status_enum" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
    `);
    await queryRunner.query(`
      CREATE TYPE "support_ticket_messages_author_role_enum" AS ENUM ('CUSTOMER', 'RIDER', 'BUSINESS', 'DISPATCHER', 'ADMIN', 'SUPER_ADMIN');
    `);

    await queryRunner.query(`
      CREATE TABLE "support_tickets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "raised_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "raised_by_role" "support_tickets_raised_by_role_enum" NOT NULL,
        "shipment_id" uuid,
        "subject" varchar(200) NOT NULL,
        "category" "support_tickets_category_enum" NOT NULL DEFAULT 'OTHER',
        "priority" "support_tickets_priority_enum" NOT NULL DEFAULT 'MEDIUM',
        "status" "support_tickets_status_enum" NOT NULL DEFAULT 'OPEN',
        "assigned_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "resolved_at" timestamp,
        "closed_at" timestamp
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "support_ticket_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
        "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "author_role" "support_ticket_messages_author_role_enum" NOT NULL,
        "message" text NOT NULL,
        "is_internal_note" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Ticket-owner's "my tickets" list — GET /support/tickets.
    await queryRunner.query(`
      CREATE INDEX "idx_support_tickets_raised_by" ON "support_tickets" ("raised_by_user_id");
    `);

    // Admin inbox's default view — GET /support/admin/tickets filtered
    // by status, newest first within a status.
    await queryRunner.query(`
      CREATE INDEX "idx_support_tickets_status" ON "support_tickets" ("status", "created_at");
    `);

    // Loading a ticket's thread — GET /support/tickets/:id and the admin
    // equivalent both do "every message for this ticket, oldest first".
    await queryRunner.query(`
      CREATE INDEX "idx_support_ticket_messages_ticket_id" ON "support_ticket_messages" ("ticket_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "support_ticket_messages";`);
    await queryRunner.query(`DROP TABLE "support_tickets";`);
    await queryRunner.query(`DROP TYPE "support_ticket_messages_author_role_enum";`);
    await queryRunner.query(`DROP TYPE "support_tickets_status_enum";`);
    await queryRunner.query(`DROP TYPE "support_tickets_priority_enum";`);
    await queryRunner.query(`DROP TYPE "support_tickets_category_enum";`);
    await queryRunner.query(`DROP TYPE "support_tickets_raised_by_role_enum";`);
  }
}
