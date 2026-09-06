# ThreeUI Visual Enhancement — Phase 1 Implementation Map

Inspected 2026-09-06, against `WAZZAR-merged-2026-09-05.zip` (supersedes all
prior merges — see `docs/delivery-notes/BRANCH_MERGE_2026-09-05.md`).

## What actually exists today (read before Phase 3+)

- **Structure**: 4 independent Vite/React apps (`apps/customer`, `apps/rider`,
  `apps/business`, `apps/admin`), no shared workspace/monorepo tooling, no
  `packages/` link between them — each was built and deployed to Netlify
  separately. Each app is (almost) a **single `App.jsx`** file (1,659–2,416
  lines) containing every screen component, plus one `api.js`.
- **Design tokens**: no separate `design-tokens.js` file exists in this zip
  (the prior merge's Phase B delivery mentioned one; not present in this
  snapshot — worth flagging to the user, not re-created speculatively). Colors
  live in an inline `const COLORS = {...}` object at the top of each App.jsx —
  same warm paper/ink/amber/teal palette across all 4 apps, confirmed
  byte-similar in tone (not re-diffed byte-for-byte this pass).
- **Motion system**: a single inline `<style>` block at the bottom of each
  App.jsx already defines the animation vocabulary: `.spin-slow` (2.6s),
  `.pulse-ring` (2.2s), `.route-thread` (1.6s dash), `.pop-in` (0.5s),
  `.locate-spin` (0.8s) — and a `@media (prefers-reduced-motion: reduce)`
  block that already kills all of them. Any new ThreeUI motion must respect
  this existing reduced-motion switch, not add a second one.
- **Map**: customer app's `LiveMap` component loads real Leaflet from cdnjs
  at runtime (not an npm dependency) with a graceful pure-SVG
  `FallbackMapSvg` if the CDN/tiles are unreachable. This is the "existing map
  implementation" Phase 3 says to keep — confirmed real, not a placeholder.
- **No animation or 3D library currently installed** in any of the 4 apps
  (no framer-motion, no three, no @designcodeio/threeui). `@designcodeio/threeui`
  is a real, currently-published npm package (v1.2.0, MIT, peer deps
  `react >=18 <20` / `react-dom >=18 <20` / `three >=0.149 <1`) — verified via
  registry + its public GitHub repo, not assumed from the task doc alone.

## File → Screen → Component → Purpose → ThreeUI enhancement

| App | File | Screen/Component | Purpose | Enhancement target |
|---|---|---|---|---|
| customer | App.jsx:535 | `SplashScreen` | Brand first-impression, static, no competing content | **Stage 1 (done)** — atmospheric background |
| customer | App.jsx:1047 | `MatchingScreen` | "Finding your rider" — has existing `.spin-slow` radar icon over live map | Stage 2 — loader enhancement, must not cover/replace `LiveMap` |
| customer | App.jsx:1081 | `TrackingScreen` | Live tracking, has existing map + route + rider marker | Stage 3 — route accents/ETA transitions only, map untouched |
| customer | App.jsx:1167 | `DeliveredScreen` | Success + rating | Stage 3/4 — success transition |
| customer | App.jsx:621 | `HomeScreenFull` | Category grid + order list, information-dense | **Do not add 3D here** — Phase 3's own "don't look like a gaming site" rule; this screen is functional/operational, not a hero moment |
| rider | App.jsx:743 | `HomeScreen` | Online/offline toggle, job feed | Stage 5 — subtle status indicator only, keep fast |
| rider | App.jsx:977 | `RequestScreen` | New job offer | Stage 5 — route reveal, accept interaction |
| rider | App.jsx:1104 | `VerifyPickupScreen` | OTP confirm | Stage 5 — confirmation animation |
| rider | App.jsx:1037 | `NavigateScreen` | In-transit | Stage 5 — route progress, no heavy WebGL (operational screen) |
| rider | App.jsx:1208 | `CompleteScreen` | Delivery complete + cash collection UI | Stage 5 — success transition |
| business | App.jsx | Dashboard (KPI cards, `AnalyticsCharts.jsx`, `DeliveriesChart.jsx`) | Analytics, invoicing, bulk-send | Stage 8 — KPI card motion only; explicitly exclude tables/forms/invoices/payment/bulk-upload per doc |
| admin | App.jsx:677 | `DispatchPage` | Live ops / intercity dispatch (Phase 2 hubs/carriers) | Stage 6/7 — primary Command Center target |
| admin | App.jsx:890 | `DeliveriesPage` | Delivery detail list | Keep functional UI; motion on state transitions only |
| admin | App.jsx:1068 | `RidersPage` | Rider roster | No 3D — operational density |
| admin | App.jsx:2277 | `AnalyticsPage` | Admin-side analytics | Stage 8-adjacent — chart/gauge treatment, not decorative 3D |

## Recommended architecture (per apps/customer, replicate per app)

```
apps/<app>/src/
  App.jsx              ← unchanged except a 1-line import + 1-line render per screen
  visual/
    threeui/
      WebGLGuard.jsx    ← shared safety wrapper (WebGL check, reduced-motion,
                           error boundary, Suspense) — write once, reuse everywhere
      HeroField.jsx     ← isolated `@designcodeio/threeui` import (lazy-loaded)
      WazzarHero.jsx    ← screen-facing component, props-only, no data fetching
```

Visual components never import `api.js` or fetch data themselves — they take
props (as the task doc's own `<TrackingMotion>` example specifies).

## Package changes required

`@designcodeio/threeui` (`^1.2.0`) + `three` (`^0.165.0`, inside the package's
supported `>=0.149 <1` peer range) added to whichever app's `package.json`
actually gets a visual component — not all 4 apps at once, per app as its
stage comes up.
