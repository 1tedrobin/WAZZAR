# Deployment

This describes how to get from "code in this repo" to "running, automatically
updating apps" — the gap tracked as "No automatic deployment pipeline" in
`docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md`. As of 2026-08-22 this is
split into two closed pieces (CI, and the config needed for each app to
deploy) and one piece that needs a one-time account setup outside this repo
(actually connecting hosting).

## 1. Continuous Integration (done, automatic, no setup needed)

`.github/workflows/ci.yml` runs on every push and pull request against
`main`:
- **Backend job:** `npm ci` → `tsc --noEmit` → `eslint` → `npm test` (142
  tests) → `npm run build`.
- **Frontend job (×4, one per app):** `npm ci` → `npm test` → `npm run
  build`.

This works the moment the repo is pushed to GitHub — no secrets, no
account setup. It catches regressions (broken build, failing test, a
lint error) automatically instead of relying on someone testing by hand,
which is exactly the gap this closes. Verified in this pass: every one
of the 8 commands above was run manually, from a clean `npm ci`, for all
5 packages (backend + 4 apps) — all green — so this is a faithful copy
of checks that are already known to pass, not a hopeful first attempt.

**What CI does *not* do:** deploy anything. It only checks that the code
is good. Deployment (below) is separate and currently still manual.

## 2. Backend — Docker

`backend/backend/Dockerfile` (multi-stage: install → build → prod deps
only → minimal runtime image, non-root user) and
`backend/backend/.dockerignore` are new. Build and run:

```bash
cd backend/backend
docker build -t wazzar-backend .
docker run -p 3000:3000 --env-file .env wazzar-backend
```

Or bring up the whole stack (Postgres + backend) with the updated
`backend/docker-compose.yml`:

```bash
cd backend
cp backend/.env.example backend/.env   # then fill in real secrets
docker compose up --build
```

**⚠️ Not verified with a real `docker build`** — this was written and
reviewed carefully, following standard NestJS multi-stage patterns, but
the sandbox this was built in has no Docker daemon available to actually
run `docker build` against. Treat it as a strong first draft: run it for
real before depending on it, and expect to possibly need a small fix
(e.g. Alpine's `node:20-alpine` occasionally needs `python3 make g++`
added if a dependency has native bindings — none currently in
`package.json`, but worth knowing if the build ever fails on an install
step).

This Dockerfile alone doesn't deploy anywhere — it makes the backend
*deployable* to any container host (Fly.io, Render, ECS, a plain VPS
with Docker installed, etc.). Picking a specific host is a decision for
you to make (cost, region — Tanzania/East-Africa latency probably
matters here — and ops complexity all trade off differently), not one
this pass makes for you.

## 3. Frontend apps — Netlify

All 4 apps (`apps/customer`, `apps/admin`, `apps/rider`, `apps/business`)
already have a `netlify.toml` with the correct build command and output
folder — this was already true before this pass, not new. What's
missing is purely account-side, not code:

1. In Netlify, **"Add a new site" → "Import an existing project"**,
   pick this repo.
2. Set **Base directory** to the specific app, e.g. `apps/customer`.
   Netlify reads that app's `netlify.toml` automatically from there.
3. Repeat for each of the other 3 apps as **separate Netlify sites**
   (they're independent deployables, not one site) — 4 sites total.
4. Once connected, Netlify's own git integration auto-builds and
   deploys on every push to `main` — no GitHub Actions involvement
   needed for this part; Netlify's own CI/CD *is* the deployment
   pipeline here.

This is a one-time, no-code setup (a handful of clicks per app), which
is why it isn't automated in this repo — there's nothing to commit for
"click a button in the Netlify dashboard."

## 4. Database — Supabase (or Railway/Render Postgres)

No specific database provider was ever chosen in this repo before
2026-08-22 — the plan was always "some Postgres instance," generically.
Supabase is a reasonable pick (free tier, and its Table Editor lets you
watch rows appear live while testing) but needed one small code change
first: `data-source.ts` had no `ssl` option at all, and Supabase — like
most managed Postgres providers — requires SSL and uses a certificate
`node-postgres` won't validate by default, so a connection attempt would
have failed outright. Fixed by adding an opt-in `DATABASE_SSL` env var
(`true` enables `ssl: { rejectUnauthorized: false }`, unset/false keeps
local and Docker Postgres — which have no SSL — working exactly as
before). See `.env.example`.

**Supabase setup:**

1. Create a free project at supabase.com, set a database password.
2. Project Settings → Database → Connection String → copy the "URI" one
   (`postgresql://...`), filling in the password from step 1.
3. On whichever host runs the backend (see §2 above — Railway and
   Render both work well here, not just Docker), set:
   - `DATABASE_URL` — the string from step 2
   - `DATABASE_SSL=true` — the important one, see above
   - `NODE_ENV=production`
   - `JWT_SECRET` / `JWT_REFRESH_SECRET` — two different random 64-char
     strings (`openssl rand -hex 64`)
   - `CORS_ORIGIN` — leave blank until the 4 Netlify URLs from §3 exist,
     then set it to all four, comma-separated (the server refuses to
     boot in production without this set — see `security-checks.ts`)
4. Once the backend is live, run `npm run db:migrate` once against it
   (from the host's shell/console, or locally with `DATABASE_URL` and
   `DATABASE_SSL=true` set) to create the tables. One-time only.

**Railway/Render Postgres instead of Supabase:** same four steps,
except step 1–2 become "create a Postgres instance on the same
platform as the backend" and it hands you the connection string
directly — no `DATABASE_SSL` needed for Railway's internal Postgres
(same-network, no SSL required), but Render's managed Postgres does
require it, so check `DATABASE_SSL=true` there too.

## What's still open

- No backend host has actually been chosen or configured yet — the
  Dockerfile makes it possible, doesn't make it happen.
- No frontend app has actually been connected to Netlify yet in this
  pass — same distinction: config exists, account setup doesn't yet.
- No database provider has actually been chosen or configured yet
  either — §4 above documents how to (Supabase, or Railway/Render
  Postgres), but nobody has clicked through it for real yet.
- No staging/production split — right now it's "one deploy target" per
  app, not a staging-then-promote flow.
- No database migration step in the deploy flow — `npm run db:migrate`
  (see `backend/backend/package.json`) would need to run against the
  production database as part of a real rollout, and nothing currently
  automates that.
