# Advanced Invoicing (Phase 3) — 2026-09-02

A business can now generate a real invoice/statement over a date
range of its own completed payments, with a downloadable PDF — beyond
the raw, ungrouped payment-history list + client-side CSV export that
previously existed. Second of Phase 3's four items to ship (after
API subscriptions — see `API_SUBSCRIPTIONS.md`). CSV bulk send and the
business analytics dashboard remain not started.

## What's new

**Backend**
- `Invoice` + `InvoiceLineItem` entities and `CreateInvoicesTable`
  migration (`invoices`, `invoice_line_items` tables).
- `invoices` module: `POST/GET /business/invoices`,
  `GET /business/invoices/:id`, `GET /business/invoices/:id/pdf` — JWT-
  authenticated, BUSINESS role, scoped to the caller's own invoices
  (same ownership pattern as `business-customers`/`api-keys`).
- `InvoicesService.generate()`: given `{periodStart, periodEnd,
  taxRatePercent?}`, finds the business's COMPLETED payments in that
  date range that aren't already on a prior invoice (a
  `payment_id`-unique index on `invoice_line_items` is what enforces
  this), snapshots each into a frozen line item
  (`description`/`amount`/`deliveredAt` copied at generation time, not
  joined live — see the entity comment for why: a later refund or
  correction on the payment can never silently change a total already
  handed to a business's accountant or client), and computes
  subtotal/tax/total using the existing `common/money.ts` cents
  helpers to avoid float drift. Assigns a sequential per-business
  invoice number (`INV-2026-0007`) — documented as best-effort, not
  strictly race-proof under concurrent generation for the same
  business (see the method's comment).
- `GET /business/invoices/:id/pdf` streams a real PDF built with
  `pdfkit` (new dependency) — header (business name, invoice #,
  period), a line-item table, and a totals block with tax shown only
  when a rate was set.
- 10 new unit tests (date-range validation, no-eligible-payments
  rejection, exclusion of already-invoiced payments, cents-exact
  subtotal/tax/total math, description building, invoice numbering,
  list/findOne ownership scoping). Full suite green (261 passing,
  22/22 suites, 0 TypeScript errors as of the 2026-09-03 audit — see
  `FULL_SYSTEM_AUDIT_2026-09-03.md` for the one pre-existing failure that was
  fixed along the way).

**Frontend (business app)**
- Billing page gets a new "Invoices" section below the existing
  payment history: `GenerateInvoiceModal` (date range, defaulting to
  month-to-date, plus an optional tax rate), a table of past invoices,
  and a one-click PDF download per row.
- `api.js`: `listInvoices`, `generateInvoice`, `getInvoice`,
  `downloadInvoicePdf` (fetches the PDF as a Blob with the bearer
  token attached by hand, since the generic `request()` helper always
  JSON-parses — same technique the existing CSV export uses for
  triggering a browser download).
- `npm run build` and the existing smoke test suite (4/4) both pass.

## Known limitations, documented rather than glossed over

- No draft/void workflow — `generate()` produces a final invoice
  immediately; there's no "preview before committing" step, and no way
  to cancel/void a generated invoice short of it just sitting unpaid
  (WAZZAR payments are already collected per-delivery before a
  shipment completes, so an invoice here is a record of money already
  received, not an outstanding bill — but that also means there's no
  "mark as paid" concept to build).
- Invoice numbering is best-effort per business, not backed by a DB
  sequence or advisory lock — see `InvoicesService.nextInvoiceNumber`'s
  comment. Fine at today's volume; would need hardening if a business
  ever generates invoices concurrently (e.g. two staff members, or an
  automated monthly job, hitting the endpoint at the same moment).
- The PDF is plain — no logo, letterhead, or per-business branding.
- No email delivery — the PDF is a direct download only, not sent
  anywhere on the business's behalf.
- No scheduled/automatic monthly invoice generation — every invoice is
  generated on demand, not by a cron job (unlike
  `scheduled-deliveries`, which does have one).
