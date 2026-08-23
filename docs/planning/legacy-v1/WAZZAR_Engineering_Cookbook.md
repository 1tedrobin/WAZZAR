# WAZZAR Engineering Cookbook
### A working playbook for a 6-developer team (5 builders + 1 integration/merge lead)

> **⚠ NOT CURRENT (labeled 2026-08-22):** This describes an aspirational team structure for later, not who's actually building WAZZAR right now. Keep it as a reference for when the team grows to this size, but don't treat the branching/PR/conflict-resolution process below as the current workflow.

This is the practical companion to the *WAZZAR Master Blueprint*. The blueprint says **what** to build; this cookbook says **how six people build it together** without stepping on each other.

---

## 1. Team Structure

Six people, one shared `main` branch, one person who owns it.

| # | Role | Owns | Primary stack |
|---|------|------|----------------|
| 1 | **Integration Lead (Merge Owner)** | `main` branch health, CI/CD, release cuts, cross-service API contracts, infra | Full-stack visibility, no single feature |
| 2 | Frontend Engineer — Customer | Customer app | React + Vite |
| 3 | Frontend Engineer — Rider | Rider app | React + Vite |
| 4 | Backend Engineer — Delivery Engine | Shipments, Dispatch, Pricing services | Node.js / TypeScript (NestJS), PostgreSQL, Redis |
| 5 | Backend Engineer — Platform Services | Auth, Riders, Payments, Health services | Node.js / TypeScript (NestJS) |
| 6 | Frontend Engineer — Dashboards | Admin dashboard, Business dashboard | React + Vite |

**Actual Stack** (implemented as of current phase):

- **Frontend (All Surfaces):** React + TypeScript + Vite — Customer app, Rider app, Admin dashboard, Business dashboard all as browser-based web apps.
- **Backend:** Node.js + TypeScript (NestJS, modular monolith), PostgreSQL as the system of record, Redis for live state.
- **Infra:** Docker containers, GitHub Actions for CI/CD, GitHub for source control and PRs.

---

## 2. Repository Layout

One monorepo, not five separate repos. At six people, a monorepo keeps API contract changes, shared types, and cross-service PRs atomic — a backend dev changing a payload shape and a mobile dev consuming it land in the *same* PR history instead of two repos silently drifting apart.

```
WAZZAR/
├── apps/
│   ├── customer/               # React + Vite
│   ├── rider/                  # React + Vite
│   ├── admin/                  # React + Vite
│   └── business/               # React + Vite
├── backend/
│   └── backend/
│       └── src/
│           └── modules/
│               ├── auth/
│               ├── shipments/
│               ├── riders/
│               ├── dispatch/
│               ├── tracking/
│               ├── payments/
│               ├── pricing/
│               └── health/
├── packages/
│   ├── api-types/              # shared TypeScript types
│   └── config/                 # shared lint/tsconfig/CI config
├── infra/
│   ├── docker/
│   └── ci/
└── docs/
    └── adr/                    # architecture decision records
```

Every service exposes an OpenAPI spec. `api-types` is generated from those specs and consumed by all four web dashboards — this is the main mechanism that keeps five people's work compatible without constant Slack threads. (No Flutter or native mobile app exists in this repo — all four surfaces are React + Vite web apps; see the corrected stack table above.)

---

## 3. Branching Strategy

**Trunk-based, short-lived branches.** No long-lived `develop` branch — with only one integrator, a second long-lived branch just doubles the merge conflicts they have to referee later. `main` is always deployable.

```
main ─●───●───●───●───●───●───●──▶  (protected, Integration Lead merges only)
       \   \   \   \   \   \
        ●   ●   ●   ●   ●   ●        feature branches, each < 3 days old
```

**Branch naming:** `<type>/<initials>-<short-description>`

```
feat/mc-price-estimate-screen
fix/be-matching-timeout-bug
chore/fd-shared-lint-config
```

Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs` — matches the commit convention below (Conventional Commits), so PR titles and changelogs generate themselves.

**Rules for builders (roles #2–#6):**
- Branch off latest `main`, not off someone else's feature branch.
- Keep branches alive **under 3 days**. Longer than that, the diff grows and the Integration Lead's review gets slower and riskier for everyone else's queue.
- Rebase on `main` before opening a PR — conflict resolution is the *author's* job, not the Integration Lead's. The Lead reviews and merges; they don't untangle other people's merge conflicts as a default service.

---

## 4. The Integration Lead's Job, Concretely

This role exists to solve one problem: five people shipping in parallel without breaking each other's work or drifting the architecture apart. Concretely, they:

1. **Own `main`.** No one else has merge rights on the protected branch.
2. **Run two merge windows a day** (e.g. 11:00 and 16:00) — batches the PR queue instead of context-switching on every ping. Anything CI-green and reviewed by the window gets merged; anything not ready waits for the next one.
3. **Review for cross-cutting concerns**, not line-by-line style (that's the peer reviewer's job — see below): does this change break another service's contract, does it match the architecture in the blueprint, does it introduce a security or data issue.
4. **Keep `api-types` in sync** — when a backend PR changes an API shape, the Lead confirms the generated types are regenerated and consuming apps aren't silently broken before merging.
5. **Cut releases** — tags `main`, triggers the production deploy, writes the changelog (auto-generated from Conventional Commits, lightly edited).
6. **Maintain the ADR log** (`docs/adr/`) — any architecture decision that affects more than one service gets a short record, so decisions don't live only in one person's head.

**Escalation valve:** if the Integration Lead becomes a bottleneck (queue backing up past a day), a designated backup reviewer (rotates weekly among the 5 builders) can merge *small, low-risk* PRs (docs, config, single-service bugfixes) — anything touching a shared contract still waits for the Lead.

---

## 5. Pull Request Process (for builders)

1. Self-review the diff before requesting review — catch the obvious stuff yourself.
2. Open PR against `main` using the PR template (below). CI runs automatically.
3. Request one peer review from another builder — cheap, catches logic/style issues fast, doesn't wait on the Lead's queue.
4. Once CI is green and peer-approved, it enters the Integration Lead's merge queue.
5. Lead merges via **squash merge** — keeps `main` history one commit per feature, readable, bisectable.

**PR template:**

```markdown
## What
[one or two sentences]

## Why
[linked ticket / blueprint section]

## How tested
[unit tests added? manual test steps? screenshots for UI changes?]

## Contract changes?
[ ] No API/schema changes
[ ] Yes — api-types regenerated and consuming apps checked
```

**Size guidance:** aim under ~400 changed lines. Bigger than that, split it — smaller diffs merge faster and cause fewer conflicts for the other four people working in parallel.

---

## 6. CI/CD Pipeline

| Trigger | Runs |
|---|---|
| Every PR (any branch) | Lint, type-check, unit tests, build |
| Merge to `main` | Above + integration tests + auto-deploy to **staging** |
| Release tag (Integration Lead only) | Deploy to **production**, manual approval gate |

Nothing merges with a red CI run — no exceptions, including the Lead's own commits.

---

## 7. Testing Expectations

- **Unit tests are required** for new business logic — the matching algorithm's scoring, the pricing formula, delivery state-machine transitions. Not chasing 100% coverage everywhere; concentrated on the logic that's expensive to get wrong.
- **Integration tests** cover the flows that cross services (create delivery → match → track → pay) — owned jointly by whoever touches that path, reviewed by the Integration Lead.
- **E2E tests** on the two mobile apps for the critical path (request → track → deliver) run before every release, not on every PR — too slow to gate day-to-day merges.

---

## 8. Definition of Done

A ticket isn't done until:

- [ ] Code merged to `main`
- [ ] CI green (lint, tests, build)
- [ ] No new contract breaks for other services/apps
- [ ] Docs updated if an API or schema changed
- [ ] Linked ticket closed

---

## 9. Weekly Rhythm

| Cadence | Ritual | Length |
|---|---|---|
| Daily | Standup — blockers, what's merging today | 15 min |
| Daily | Two merge windows (11:00 / 16:00) | Integration Lead's queue-processing time |
| Weekly | Architecture sync — all 6, surface contract changes before they become PR conflicts | 30 min |
| Weekly | Demo / review against the blueprint's MVP checklist | 30 min |
| Per sprint (1 week) | Sprint planning, pulled from the blueprint's Phase 1 (30-day) scope | 30 min |

One-week sprints keep the blueprint's 30-day pilot plan to roughly four sprints — short enough that a stuck task surfaces fast instead of hiding until sprint end.

---

## 10. Onboarding a New Developer Mid-Project

1. Repo access + read `docs/adr/` end to end (fastest way to absorb *why*, not just *what*).
2. Local environment via `infra/docker` — one command should bring up all services + a seeded database.
3. Shadow one merge window with the Integration Lead before opening their own first PR.
4. First ticket: something small and self-contained (a single service, no contract changes) — proves the workflow before they touch anything cross-cutting.

---

## 11. Conflict Resolution

- **Technical disagreement between builders** (e.g. two valid approaches to a service boundary) → Integration Lead is the tiebreaker; decision gets logged as an ADR so it doesn't get re-litigated later.
- **Process friction** (Lead is a bottleneck, review turnaround too slow, scope creep) → escalates outside the dev team to whoever's steering the product.

---

## 12. Sprint 1 — Concrete Starting Tasks

Pulled directly from the blueprint's MVP "Must Have" list (Section 19), mapped to the five builders so week one has zero ambiguity about who starts where:

**Actual Build Sequence (Current Status, updated 2026-08-22):**

Customer, Admin, and Business apps are wired to the live backend; Rider app wiring landed alongside the Business app in the same merge pass (see `docs/delivery-notes/README_BUSINESS_RIDER_MERGE.md`).

| App | Status | Stack |
|---|---|---|
| Customer app | Wired to backend | React + Vite |
| Admin app | Wired to backend (API integration layer complete) | React + Vite |
| Rider app | Wired to backend | React + Vite |
| Business app | Wired to backend | React + Vite |

Backend: Single NestJS modular monolith in `backend/backend/src/modules/` with auth, shipments, riders, dispatch, tracking, payments, pricing, health modules live.


## Note: Second Build Cookbook
A separate build cookbook exists at docs/planning/WAZZAR_BUILD_COOKBOOK.md with React Native stack guidance. Ensure you are reading the correct cookbook for your phase.
