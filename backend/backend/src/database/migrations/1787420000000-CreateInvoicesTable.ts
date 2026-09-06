import { MigrationInterface, QueryRunner } from 'typeorm';

// New tables backing Phase 3's "advanced invoicing" feature — a
// business can generate a real invoice/statement over a date range of
// its own COMPLETED payments (previously only a raw, ungrouped
// payment-history list + a client-side CSV export existed — see
// BillingPage/downloadPaymentHistoryCsv in apps/business). See
// docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md's Phase 3 section.
//
// invoice_line_items snapshots amount/description at generation time
// rather than joining payments/shipments live — see
// InvoiceLineItem entity for why. The unique index on payment_id is
// what prevents the same payment from ever appearing on two invoices.
export class CreateInvoicesTable1787420000000 implements MigrationInterface {
  name = 'CreateInvoicesTable1787420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "invoice_number" varchar(40) NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "subtotal_amount" decimal(12,2) NOT NULL,
        "tax_rate_percent" decimal(5,2) NOT NULL DEFAULT 0,
        "tax_amount" decimal(12,2) NOT NULL DEFAULT 0,
        "total_amount" decimal(12,2) NOT NULL,
        "currency" varchar(3) NOT NULL DEFAULT 'TZS',
        "shipment_count" integer NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "invoice_line_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
        "shipment_id" uuid NOT NULL REFERENCES "shipments"("id") ON DELETE RESTRICT,
        "payment_id" uuid NOT NULL REFERENCES "payments"("id") ON DELETE RESTRICT,
        "description" varchar(255) NOT NULL,
        "amount" decimal(12,2) NOT NULL,
        "delivered_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

    // Every list/ownership check is "this business's own invoices".
    await queryRunner.query(`
      CREATE INDEX "idx_invoices_business_id" ON "invoices" ("business_id");
    `);
    // A business's invoice numbers only need to be unique to that
    // business (INV-2026-0001 can recur across different businesses).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_invoices_business_id_invoice_number" ON "invoices" ("business_id", "invoice_number");
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_invoice_line_items_invoice_id" ON "invoice_line_items" ("invoice_id");
    `);
    // The mechanism preventing a payment from landing on two invoices.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_invoice_line_items_payment_id" ON "invoice_line_items" ("payment_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "invoice_line_items";`);
    await queryRunner.query(`DROP TABLE "invoices";`);
  }
}
