# CSV Bulk Send (Phase 3) — 2026-09-03

A business can now upload a CSV of pickup/dropoff rows and create many
real shipments in one go, instead of one at a time through the New
Delivery form. Fourth and final Phase 3 item to ship — Phase 3 is now
complete as originally scoped (see the other three delivery notes in
this folder: `API_SUBSCRIPTIONS.md`, `ADVANCED_INVOICING.md`,
`ANALYTICS_DASHBOARD.md`).

## What's new

**Backend**
- `bulk-shipments` module: `GET /business/bulk-shipments/template`
  (downloads a starting-point CSV), `POST /business/bulk-shipments`
  (multipart upload, field name `file`) — JWT-authenticated, BUSINESS
  role.
- `BulkShipmentsService.importCsv()`: parses the CSV (new `csv-parse`
  dependency, chosen over hand-rolling a parser since business
  addresses routinely contain commas that need real quoted-field
  handling), then processes each row **sequentially** — not
  `Promise.all` — for two reasons: it respects
  `GeocodingService`'s underlying Nominatim rate limit (~1 req/sec,
  see `GEOCODE_DELAY_MS`), and each row's price quote reflects
  `PricingConfig` at the moment that row is processed, same as if it
  had been submitted individually.
- Each row either supplies `pickup_lat`/`pickup_lng` (and the dropoff
  equivalents) directly, or falls back to geocoding the address text
  via the existing `GeocodingModule`. Every row becomes one real call
  to `ShipmentsService.create()` — the same pricing/state-machine path
  a single manual order goes through, not a parallel bulk-insert
  shortcut.
- **Best-effort, not all-or-nothing**: one bad row (ungeocodable
  address, invalid coordinates, non-numeric weight, missing required
  field) is caught and reported, not allowed to abort the rest of the
  batch. The response is `{ totalRows, created: [...], failed: [{row,
  error}] }`.
- Hard cap of **100 rows per upload** (`MAX_BULK_ROWS`) — documented as
  a direct consequence of Nominatim's rate limit, not an arbitrary UX
  choice: a 100-row file where every address needs geocoding already
  takes several minutes end-to-end. A business with more volume should
  fill in the lat/lng columns and skip geocoding entirely.
- 8 new unit tests (direct lat/lng rows with zero geocoding calls,
  geocoding fallback, per-row failure isolation, missing-required-
  field rejection, the empty-CSV and over-`MAX_BULK_ROWS` cases,
  non-numeric weight rejection, template header correctness). Full
  suite green (261 passing, 22/22 suites, 0 TypeScript errors as of
  the 2026-09-03 audit — see `FULL_SYSTEM_AUDIT_2026-09-03.md` for the one
  pre-existing failure that was fixed along the way).

**Frontend (business app)**
- "Bulk send" button on the Orders page, next to "New delivery".
- `BulkSendModal`: download the CSV template, choose a `.csv` file,
  upload, see a results screen (created/failed counts, plus a
  scrollable list of every failed row's reason). Refreshes the orders
  list automatically when at least one shipment was created.
- `api.js`: `uploadBulkShipments(file)` (multipart `FormData`, not
  routed through the JSON-only `request()` helper) and
  `downloadBulkShipmentsTemplate()` (blob download, same technique as
  the existing invoice-PDF and payment-history-CSV exports).
- `npm run build` and the existing smoke test suite (4/4) both pass.

## Known limitations, documented rather than glossed over

- 100-row cap per upload, driven by Nominatim's rate limit — see
  above. No batching/chunking across multiple uploads is automated;
  a business with a larger list has to split the file themselves.
- No progress indication mid-upload beyond a static "this can take a
  minute" message — the frontend can't show a live per-row progress
  bar, since the backend returns one response only after the entire
  batch finishes (no streaming/SSE).
- No CSV row preview/validation before committing — a business only
  finds out a row is bad after `POST /business/bulk-shipments` has
  already run and created every row that *did* succeed. There's no
  "dry run" mode.
- Geocoding accuracy is only as good as free Nominatim — an ambiguous
  or poorly-formatted address (see `GeocodingService`, still untested
  against the live API per the Phase 1 critical-path gaps in this same
  doc) can resolve to the wrong location or fail outright.
- No saved import history — once a `POST /business/bulk-shipments`
  response is shown, there's no way to look up a past import's results
  again (the created shipments themselves remain visible on the Orders
  page, but the created/failed report itself isn't persisted).
