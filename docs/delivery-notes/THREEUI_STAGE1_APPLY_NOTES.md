# ThreeUI Stage 1 — Shared setup + Customer Splash hero

Per the task doc's Phase 13 order ("implement in this order... after each
stage: BUILD → TEST → REVIEW → CONTINUE"), this delivers only the first
stage: shared ThreeUI setup + the customer app's splash-screen hero. Nothing
else was touched — rider/business/admin apps are byte-identical to the input
zip.

## Completed
- Added `@designcodeio/threeui` (^1.2.0) + `three` (^0.165.0) to
  `apps/customer/package.json`.
- New `apps/customer/src/visual/threeui/` layer (3 files): `WebGLGuard.jsx`
  (WebGL-support check, `prefers-reduced-motion` check, render-error
  boundary, lazy `Suspense` mount — reusable for every future stage),
  `HeroField.jsx` (isolated `ConstellationField` import so `three`/ThreeUI
  code-splits out of the main bundle), `WazzarHero.jsx` (the screen-facing,
  props-only component).
- Wired `WazzarHero` into `SplashScreen` only: one import line, one render
  line, plus `z-index`/`position:relative` on the existing content so the
  background never sits above the "Get started" button. No other line in
  `SplashScreen` — and nothing outside it — changed.

## Files Changed
- `apps/customer/package.json` — 2 dependencies added.
- `apps/customer/src/App.jsx` — `SplashScreen` only (+1 import at top of file).

## Files Created
- `apps/customer/src/visual/threeui/WebGLGuard.jsx`
- `apps/customer/src/visual/threeui/HeroField.jsx`
- `apps/customer/src/visual/threeui/WazzarHero.jsx`

## Database Changes
None.

## API Changes
None.

## Tests Performed
- `npm install` — clean, 348 packages added, no peer-dep conflicts (`three`
  0.165.0 satisfies the package's declared `>=0.149 <1` peer range).
- `npm run build` (real Vite build, not a dry run) — **1,559 modules
  transformed, built in ~12s, zero errors.**
- `npm test` (existing Vitest smoke suite) — **3/3 passing**, no regressions.
  One pre-existing React `act()` warning in the smoke test is unrelated to
  this change (present in the unmodified `App` component's own effects).
- Manually reviewed: WebGL-unavailable and reduced-motion paths both resolve
  to `fallback={null}` — i.e. today's plain `COLORS.ink` background, so a
  device that can't/shouldn't run the hero sees exactly what it saw before
  this change, never a blank or broken screen.
- Not run: on a real phone/browser (no such environment available here) —
  same caveat every prior pass in this project has carried for GPS/visual
  work.

## Known Limitations
- Only the splash screen changed. `MatchingScreen`'s existing `.spin-slow`
  radar (the natural Stage 2 target — "Searching for rider" in the task doc)
  is untouched.
- No `design-tokens.js` file existed in this snapshot to read a canonical hue
  from — `HeroField.jsx` hard-codes `hue={28}` to match the existing inline
  `COLORS.amber` (`#FF7A1A`) by eye. Worth confirming against a real design
  reference before Stage 2+ reuse the same value.
- Rider/business/admin apps have zero ThreeUI setup yet (by design — see
  Phase 13 ordering).

## Recommended Next Step
Stage 2 (per the doc's own order): customer tracking + the "Searching Rider"
loader on `MatchingScreen`, reusing `WebGLGuard` as-is. Build → test → review
that stage on its own before touching the rider app.
