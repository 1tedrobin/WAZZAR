# Analytics Dashboard for Businesses (Phase 3) — 2026-09-02

A business can now see a real, backend-computed analytics dashboard —
delivery/spend trends, completion rate, average delivery time, average
rider rating, a status breakdown, and top delivery destinations —
over any date range of its own full shipment history. Third of Phase
3's four items to ship (after API subscriptions and advanced
invoicing — see the two other delivery notes in this folder). CSV bulk
send remains not started.

This is a genuinely new capability, not an extension of an existing
endpoint: previously the only "analytics" a business had was
OverviewPage's client-side `statsFor()`/`weeklyChartData()`, computed
from whatever single page of `GET /shipments` happened to be loaded
(`limit=100` by default) — accurate for "this week" but silently wrong
for anything longer, since it was never actually querying the business's
full history.

## What's new

**Backend**
- `analytics` module: `GET /business/analytics/summary` — JWT-
  authenticated, BUSINESS role, scoped to the caller's own shipments.
  Optional `periodStart`/`periodEnd` query params (must be given
  together); defaults to the last 30 days.
- `AnalyticsService.getSummary()` queries the business's shipments in
  range directly from the database (not a cached/paginated slice) and
  computes:
  - totals: shipment count, completed, cancelled, completion rate,
    total spend (mirrors OverviewPage's existing "non-cancelled
    shipment price" definition), average delivery time, average rider
    rating;
  - a daily series (shipments + spend per day, zero-filled for days
    with no activity, for charting);
  - a status breakdown (grouped by the real `ShipmentStatus` enum,
    sorted by count);
  - top 5 destinations (grouped by the first segment of the dropoff
    address — the same address-shortening trick
    `InvoicesService.buildDescription` uses).
- No new tables — pure aggregation over the existing `shipments` table,
  using the existing `common/money.ts` cents helpers for the spend
  total to avoid float drift. **Update (2026-09-03):** the daily
  series' per-day spend accumulation originally added the day's prices
  as floats with a round-after-each-add pattern, not the cents-based
  approach the totals calculation used — inconsistent with this
  module's own stated principle even though it didn't produce wrong
  numbers in testing. Fixed during the full-system audit to accumulate
  in integer cents throughout, same as the rest of the module; a
  regression test with float-drift-prone amounts (0.10/0.20/0.30-style
  values) was added to `analytics.service.spec.ts`.
- 11 unit tests (range validation/defaulting, completion-rate/
  spend/delivery-time/rating math including the "no data" null cases,
  daily-series zero-seeding, bucketing, and exact cents accumulation,
  status and destination grouping). Full suite green (261 passing,
  22/22 suites, 0 TypeScript errors as of the 2026-09-03 audit — see
  `FULL_SYSTEM_AUDIT_2026-09-03.md` for the one pre-existing failure that was
  fixed along the way).

**Frontend (business app)**
- New "Analytics" nav item / page: date-range picker (defaults to the
  last 30 days, with a one-click reset), five stat cards, a combined
  bar+line chart (deliveries per day as bars, spend per day as a
  line), a status-breakdown bar list, and a top-destinations bar list.
- `AnalyticsCharts.jsx`: the chart component split into its own lazy-
  loaded chunk, same reasoning and pattern as `DeliveriesChart.jsx`
  (Overview) and the admin app's `RevenueChart.jsx` — `recharts` is
  the one dependency that trips this app's bundle-size warning, so it
  only loads when the Analytics page is actually opened (unlike
  `DeliveriesChart`, which preloads on login since Overview is the
  default landing page).
- `api.js`: `getAnalyticsSummary({ periodStart, periodEnd })`.
- `npm run build` and the existing smoke test suite (4/4) both pass;
  the new chunk shows up as its own `AnalyticsCharts-*.js` file in the
  build output, confirming the lazy-load split worked.

## Known limitations, documented rather than glossed over

- Aggregation happens in JS over shipments pulled into memory, not a
  SQL `GROUP BY` — fine at a single business's current shipment
  volume, but would need to move to database-side aggregation if a
  business's per-period shipment count ever grows into the thousands
  (see `AnalyticsService.getSummary`'s comment).
- Top-destination grouping is a plain string match on the first
  comma-separated segment of the dropoff address, not a geocoded
  ward/district boundary — "Mikocheni B" and "Mikocheni" would count
  as two different destinations if both appear verbatim.
- No comparison to a prior period ("vs. last month") — every number
  is absolute for the selected range, not a delta.
- No CSV/PDF export of the analytics view itself (payment history and
  invoices both have their own export paths already; analytics
  doesn't yet).
- No per-rider or per-recipient breakdown — only date, status, and
  destination groupings exist today.
