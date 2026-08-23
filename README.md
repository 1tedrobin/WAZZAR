# WAZZAR

Logistics / parcel delivery platform for the Tanzanian market — boda-boda riders, M-Pesa payments, Dar es Salaam geography. Two-sided marketplace: customers create shipments, riders fulfill them, admins run dispatch and finance.

This repository is organized as a monorepo: one real backend, four independent frontend apps, and the project's planning/delivery documentation, reorganized on 2026-08-20 from five delivery ZIPs (`07_ARCHIVE/original-zips/`) per `docs/delivery-notes/` and the audit that produced this structure. A second backend build (business tools, geocoding, uploads, security hardening) was merged in on 2026-08-22 from a sixth ZIP, and a third pass the same day added scheduled/recurring deliveries and a real M-Pesa webhook fix (both archived in `07_ARCHIVE/original-zips/`) — see `docs/delivery-notes/SESSION_HANDOFF_2026-08-22.md` for the fastest current-status entry point, or `docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md` for the full dated log.

## What's here

```text
WAZZAR/
├── apps/
│   ├── customer/     React + Vite — wired to the real backend
│   ├── admin/         React + Vite — wired to the real backend
│   ├── rider/          React + Vite — wired to the real backend
│   └── business/       React + Vite — wired to the real backend (customers/staff address book + roster included)
├── backend/            NestJS + TypeORM + Postgres, Dockerfile + docker-compose
├── .github/workflows/   CI workflow (added 2026-08-22)
├── docs/
│   ├── planning/       Pre-build spec/architecture docs — design intent, not current status,
│   │                   EXCEPT WAZZAR_Master_Blueprint.docx and WAZZAR_SYSTEM_ARCHITECTURE.md
│   │                   (see "Building new features" below) — both checked/corrected against real code
│   ├── delivery-notes/ Piece-by-piece build notes — accurate, current status
│   ├── audits/         Audit trail of doc-vs-code corrections applied across this repo
│   └── legal/           Terms of Service, Privacy Policy, Rider Partner Agreement (drafts)
└── 07_ARCHIVE/
    ├── original-zips/      The 5 ZIPs this repo was assembled from, plus WAZZAR-complete-2026-08-22-pass2.zip and -pass3.zip (two further merges the same day, same source filename — kept distinct so neither overwrites the other), untouched
    └── original-versions/  Superseded mock-data versions of customer/admin apps
```

**Status at a glance:** backend covers auth, shipments (incl. rider rating and scheduled/recurring deliveries), riders (incl. document uploads), live tracking, dispatch, proof of delivery, pricing, payments, business customer/staff management, and address geocoding. All four frontend apps are wired to it. Payment providers (M-Pesa, Stripe) default to a mock/fake-data path and switch to live calls once real credentials are configured — see `docs/delivery-notes/PAYMENTS_GOING_LIVE.md`; the M-Pesa webhook DTO was also fixed to match Safaricom's real Daraja callback shape (it previously expected a flattened shape that a real payment would never have sent). **Verified for real on 2026-08-22** (backend + all four apps: `npm install`, full test suites, and production builds all actually run, not just reviewed) — see `docs/delivery-notes/VERIFICATION_2026-08-22.md`. That pass caught and fixed one real, serious bug: an unterminated comment in the business app's `App.jsx` was silently swallowing 83 lines of real code — including the entire sidebar navigation — in the actual production build, not just tests. Fixed; all five now build and test clean. See `docs/delivery-notes/` for exactly what's real vs. planned, page by page, and `docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md` for what's still open.

## Building new features

`docs/planning/legacy-v1/WAZZAR_Master_Blueprint.docx` is the reference for new build work — product scope, the shipment state machine, database design, payments, and technical architecture. It was checked line-by-line against the actual backend code and corrected on 2026-08-22 (entity naming, state machine, module architecture, payment methods, and roles all now match `backend/backend/src/`), so unlike the rest of `docs/planning/` it can be built from directly rather than treated as stale pre-build intent.

For what's already been built (as opposed to what to build next), still check `backend/README.md` and `docs/delivery-notes/` first — the Blueprint describes the target, those describe current reality. If the two ever disagree, the code and delivery notes win; flag the Blueprint section for a follow-up correction rather than building against a doc that's drifted again.

## Applications

| App | Port (dev) | Wired? |
|---|---|---|
| `apps/customer` | 5173 (Vite default) | Yes |
| `apps/admin` | 5174 | Yes |
| `apps/rider` | 5173 (Vite default — will collide with customer if run together) | Yes |
| `apps/business` | 5173 (Vite default — will collide if run together) | Yes |

Each app builds and deploys independently via Netlify (`netlify.toml` in each app folder).

## Backend

NestJS API server, Postgres via TypeORM (migration-based, no auto-sync). Full module and endpoint list, plus a piece-by-piece build history and documented "known simplifications" at each stage, live in `backend/README.md` — treat that file as the single source of truth for backend status.

## Local development

```bash
# 1. Start Postgres
cd backend
docker-compose up -d

# 2. Install and run the backend
cd backend
npm install
cp .env.example .env    # fill in JWT secrets — see comments in the file
npm run db:migrate
npm run dev              # http://localhost:3000

# 3. In a separate terminal, run a frontend app
cd apps/customer          # or apps/admin, apps/rider, apps/business
npm install
cp .env.example .env.local   # point VITE_API_URL at the backend if not localhost:3000
npm run dev
```

The backend has no admin self-signup — see `apps/admin/README_ADMIN_WIRING.md` for how to create the first admin account via manual SQL.

## Environment variables

Every app and the backend ship a `.env.example` with safe placeholders — no real secrets exist anywhere in this repository. Copy each `.env.example` to `.env` (or `.env.local` for the Vite apps) and fill in real values locally; never commit the filled-in file (already covered by the root `.gitignore`).

## Testing

The backend has 15 spec files covering dispatch, tracking (ETA + access control), shipment status transitions, payments (including provider-selection logic and the M-Pesa callback parser), pricing, riders, business customers, business staff, and scheduled deliveries (both the service and its recurrence-calculation util):

```bash
cd backend
npm install
npm test
```

Each frontend app now has a basic smoke test (`src/test/App.smoke.test.jsx`) added 2026-08-22. No deeper frontend test coverage exists yet.

**Actually run on 2026-08-22:** all 15 backend spec files (191 tests) and all four frontend smoke test suites pass for real — `npm install` and `npm test` were both actually executed, not just reviewed. See `docs/delivery-notes/VERIFICATION_2026-08-22.md` for the full run log, including one real bug this caught: an unterminated comment in `apps/business/src/App.jsx` was silently eating 83 lines of real code (including the whole sidebar), fixed the same pass.

## Deployment

- **Frontends:** Netlify (`netlify.toml` present in each app). Set `VITE_API_URL` to the deployed backend URL.
- **Backend:** needs a real Postgres instance, JWT/webhook secrets generated and stored securely (not the local dev defaults in `.env.example`), migrations run (including the new `CreateScheduledDeliveriesTable` migration), and `CORS_ORIGIN` set — the server now refuses to boot in production without it (`security-checks.ts`). A `Dockerfile` and a `docker-compose.yml` backend service exist for containerized deploys, though the Dockerfile itself has never been run through a real `docker build` (everything else has — see `docs/delivery-notes/VERIFICATION_2026-08-22.md`). M-Pesa/Stripe stay on their mock/fake-data path until real credentials are set — see `docs/delivery-notes/PAYMENTS_GOING_LIVE.md`. The M-Pesa webhook fix and the scheduled-deliveries cron job have both been verified against their real test suites (24 tests between them, all passing) — see `docs/delivery-notes/VERIFICATION_2026-08-22.md` for what "verified" means here versus tested against a live Daraja/Postgres instance, which still hasn't happened.
- A CI workflow now exists (`.github/workflows/ci.yml`).

## Backup strategy

1. **Git** — this repository, once committed, is the primary history.
2. **`07_ARCHIVE/original-zips/`** — the exact ZIPs this repo was built from, preserved untouched as a recovery point independent of Git.
3. **Off-site** — push this repo to a private remote (GitHub or equivalent) once initialized.
4. **Database backups** — not yet needed (no production data exists), but decide on a `pg_dump` schedule before real customer/shipment data exists.

## Update workflow

- Backend changes: follow the existing "piece" pattern in `backend/README.md` — a "Definition of done" checklist and a "Known simplifications" note per change, same style used through Piece 14.
- Frontend wiring: when wiring `apps/rider` or `apps/business` to the backend, follow the pattern already used in `apps/admin` — a dedicated `api.js` plus a `README_*_WIRING.md` that says plainly what's real vs. unavailable, rather than stubbing unwired pages with fake data.
- Planning docs in `docs/planning/` describe original/Phase 2 intent and may drift from what's actually built — `backend/README.md` and `docs/delivery-notes/` are the current-status source of truth.
