# WAZZAR — START HERE

> **Consolidated (2026-08-22):** This repo previously had three overlapping pre-build "here's everything delivered" documents — this file, `WAZZAR_COMPLETE_PROJECT_SUMMARY.md`, and `WAZZAR_MASTER_INDEX.md` — all written Aug 18–19, before any backend or frontend wiring existed, and all carrying the same "design intent, not current status" disclaimer. All three had been superseded by `docs/delivery-notes/` as the real current-status source since. The other two were deleted; this file was kept (as the shortest, most legible entry point) and rewritten to just point at what's actually current, instead of re-describing a pre-build snapshot that's now two correction-passes out of date.

## Where to actually look

**What's built, right now:**
- `README.md` (repo root) — what's here, how the monorepo is laid out
- `backend/README.md` — piece-by-piece backend build log, the real API surface
- `docs/delivery-notes/*.md` — dated notes on each merged piece of work (payments, dispatcher role, business/rider app wiring, latest test run)
- `apps/admin/README_ADMIN_WIRING.md`, `apps/business/WIRING_NOTES.md` — what's real vs. placeholder in each frontend app

**The architecture and product reference for new work:**
- `docs/planning/WAZZAR_SYSTEM_ARCHITECTURE.md` — corrected against the real backend (2026-08-22); includes the Guiding Principles (simple/secure, scale-when-needed, the Wire Pattern, in-house infrastructure control) that new work should follow
- `docs/planning/legacy-v1/WAZZAR_Master_Blueprint.docx` — corrected against the real backend (2026-08-22); the intended product reference going forward, including the canonical 4-phase roadmap (1 Single-city → 2 Intercity/Trunk → 3 Business Platform → 4 Regional)

**Forward design, not built yet:**
- `docs/planning/WAZZAR_Unified_Model_Updated.md` — Phase 2 (intercity/hub) design, consistently scoped as forward-looking
- `docs/planning/WAZZAR_APP_REFACTORING_GUIDE.md` — target-state guide for breaking up the monolithic `App.jsx` files; the refactor it describes hasn't started yet

**Historical record — not a build reference:**
- `docs/audits/WAZZAR_DOCS_CORRECTIONS_AUDIT.md`, `docs/audits/DOCS_CORRECTIONS_APPLIED.md` — the audit trail of doc-vs-code corrections applied across this repo
- `docs/planning/WAZZAR_BLUEPRINT_AUDIT.md` — a self-consistency audit of the *original, uncorrected* Blueprint text; frozen on purpose so it doesn't misrepresent what the original document said
- `docs/planning/WAZZAR_APP_AUDIT.md` — a point-in-time audit of the pre-backend React prototype (Aug 19), before any of the four apps were wired to a real backend

**Business/ops, live but not engineering docs:**
- `docs/legal/*.docx` — Terms of Service, Privacy Policy, Rider Partner Agreement (still have placeholder fields, not launch-ready)
- `docs/planning/legacy-v1/WAZZAR_Rider_Ops_Playbook.docx` — field-ops playbook for the Dar es Salaam launch; meant to be updated as real Phase 1 data comes in
