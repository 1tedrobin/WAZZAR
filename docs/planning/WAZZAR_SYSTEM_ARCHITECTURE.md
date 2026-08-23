# WAZZAR — SYSTEM ARCHITECTURE

> **⚠ STATUS NOTE (added 2026-08-20):** This document is pre-build planning/specification, written before the backend or any frontend wiring existed. It describes *design intent*, not current implementation status. For what's actually built today, see `backend/README.md` (piece-by-piece build log) and `docs/delivery-notes/` — those are kept current; this document is not. Treat this as a reference for original/Phase 2 direction, not a checklist of what exists.
>
> **Update (2026-08-22):** Checked and corrected against the real backend — the Phase 1 auth flow (dropped the OTP/SMS step, which was never built), the Integrated Services table (Maps/SMS/Email/Push were falsely marked Phase 1; only mocked payments actually exist), and the Phase 1 module/folder structure (aligned to the 8 real modules in `backend/backend/src/modules/`, and the `common/`/`database/` trees to what's actually there) are now accurate.
>
> **Update (2026-08-22, pass 2):** Full sweep found and corrected four more sections that hadn't been re-verified: the **Schema Overview** (was listing `businesses`/`ratings`/`notifications` tables that don't exist anywhere in the code, wrong `payments.method` enum, missing `DISPATCHER` role, and omitting the real `pricing_configs`/`proof_of_delivery` tables); the **Key Endpoints** list (every route had a nonexistent `/api/v1/` prefix, and it listed a `/user/profile` module and a full `/admin/*` API that were never built, while omitting most real routes); the **WebSocket tracking** section (real implementation is a Socket.IO namespace with subscribe/unsubscribe, not a raw per-shipment connection); and the **auth flow** (tokens are returned in the JSON body, not `httpOnly` cookies; there's no `/auth/logout` endpoint or failed-login logging). The rest of this large document (Foundations covering matching, pricing, tracking, etc. in detail) still hasn't been re-verified line-by-line — its Phase 2+ sections are forward design intent, and any remaining Phase 1 claims elsewhere should be spot-checked against the code before relying on them.

> **Update (2026-08-22, pass 3 — architectural direction, not a correction):** Added explicit Guiding Principles to the Overview (simple/secure, scale-when-needed not preemptively, the Wire Pattern for optional integrations, in-house/self-hosted control over vendor lock-in) per founder direction. Consolidated the Phase 2+ microservices list from 11 one-per-noun services down to 6 domain-level services (citing Uber's own DOMA consolidation as precedent for why fewer, coarser services beat many small ones). Generalized the existing Payments adapter pattern into the formal Wire Pattern, with a `NoOpNotificationProvider` example showing every not-yet-integrated service (SMS, email, push, etc.) should get a real interface and no-op default now, not just when a vendor is chosen — so integrating or dropping one later is a config change, not a rewrite. Reordered Foundation 5's deployment options so self-hosted, vendor-neutral infrastructure (Postgres/Redis containers, S3-compatible storage) is the default recommendation, with AWS/GCP repositioned as an operational choice once there's a team to run them, not an architectural dependency.

> **Update (2026-08-22, pass 4 — post-merge re-verification):** A second backend build (`WAZZAR-complete.zip`) was merged into this repo, adding real `business-customers`, `business-staff`, `geocoding`, and `uploads` modules; rider document uploads; shipment rider ratings; rate limiting; `helmet()`; production-locked CORS; real webhook signature verification; and credential-gated (still mock-by-default) Stripe/M-Pesa. Because pass 2 had explicitly documented several of these as *not* built, re-checked and updated the Schema Overview, Key Endpoints, Integrated Services, Security (Foundation 14), and Phase 1 module-tree sections against the merged code so this document doesn't go stale the moment it was fixed. See `docs/audits/DOCS_CORRECTIONS_APPLIED.md` for the full merge record.

> **Update (2026-08-22, pass 5 — third merge, same day):** A `scheduled-deliveries` module was merged in — recurring deliveries backed by a real `@nestjs/schedule` cron job, not just CRUD — plus a real bug fix to the M-Pesa webhook DTO, which previously expected a flattened payload shape that doesn't match Safaricom's real Daraja callback. Updated the Schema Overview, Key Endpoints, and Phase 1 module tree accordingly. **Neither addition had been run for real yet as of this pass** — see pass 6 below.

> **Update (2026-08-22, pass 6 — actually run, not just reviewed):** Ran `npm install` and the full test suite for real on the backend and all four frontend apps — see `docs/delivery-notes/VERIFICATION_2026-08-22.md`. Backend: 191 tests across 15 suites, all passing, including the two flagged as never-run in pass 5. This surfaced one serious, previously-invisible bug: an unterminated `/* ` comment in `apps/business/src/App.jsx` had been silently deleting 83 lines of real code — including the entire sidebar navigation — from both the test path and the actual production build, without any build error, because the file remained syntactically valid JS throughout. Fixed. All five build/test targets are now genuinely green, not just reviewed-and-assumed-fine.

**Date:** August 18, 2026  
**Version:** 1.0  
**Status:** Foundation Architecture

---

## OVERVIEW

This document maps the WAZZAR Master Blueprint to a complete technical system architecture across all 16 Foundations.

Each Foundation is:
- **Defined** — What it does, why it matters
- **Scoped** — Phase 1 (MVP) vs. Phase 2+ (Future)
- **Architected** — How it's built, key components
- **Integrated** — How it connects to other Foundations

### Guiding Principles (added 2026-08-22)

Four rules every Foundation below is built against:

1. **Simple and secure over clever.** The smallest system that's actually safe — real backend enforcement of auth/authorization, no shortcuts on data handling — beats a more elaborate one. Complexity is added when a real requirement forces it, not in anticipation of one (see the Master Blueprint's own "Do NOT Overengineer" principle).
2. **Easy to scale later, not scaled prematurely.** Phase 1 stays a monolith with clean internal module boundaries specifically so it *can* split into services later without a rewrite — see "Microservices" below. Scaling work happens when Phase 1 hits a real bottleneck, not before.
3. **The Wire Pattern for every optional integration.** Maps, SMS, Email, Push, Analytics, Error Tracking, Video KYC, and any future payment/carrier provider are never called directly from business logic. Each gets a small interface ("the wire") defined once, with a no-op/mock implementation as the default. Plugging in a real provider means implementing that interface and flipping a config value — nothing else in the codebase changes. Removing a provider means reverting to the no-op implementation — nothing breaks, nothing needs to be ripped out. See "The Wire Pattern" under Foundation 2 for the concrete shape of this.
4. **In-house control over vendor lock-in.** Prefer self-hosted, standard building blocks (Postgres, Redis, S3-compatible storage, Docker) that WAZZAR fully owns and can move between hosts without a rewrite, over managed services that couple the architecture to one vendor's proprietary tooling. Managed cloud services are a legitimate operational choice once there's a team to justify outsourcing ops to — they are not something the core architecture should depend on. See "Deployment Platform Options" under Foundation 5.

---

## FOUNDATION 1: FRONTEND (Web)

### Purpose

Provide a customer-facing web application where users can:
- Create shipments
- Track deliveries
- Manage account
- View history
- Contact support
- Pay for services

### Technology Stack

| Component | Choice | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript | Type safety, component reusability, large ecosystem |
| Build tool | Vite | Fast build times, modern ES modules, excellent DX |
| Routing | React Router v6 | Industry standard, good TS support |
| State management | Zustand or Jotai | Simpler than Redux for this scope, TypeScript native |
| UI Component Library | Shadcn/ui (Radix) | Headless, accessible, Tailwind-based |
| Styling | Tailwind CSS | Utility-first, responsive, design consistency |
| HTTP Client | Axios + React Query | Excellent caching, error handling, offline support |
| Maps | Google Maps API or Mapbox | Real-time tracking, routing, distance calculation |
| Form handling | React Hook Form + Zod | Lightweight, type-safe validation |
| Icons | Heroicons or Feather | Clean, lightweight SVG icons |

### Architecture

```
web/
├── public/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── layout/
│   │   ├── shipment/
│   │   ├── tracking/
│   │   ├── account/
│   │   └── common/
│   ├── pages/               # Page-level components (Route targets)
│   │   ├── home/
│   │   ├── create-shipment/
│   │   ├── track/
│   │   ├── account/
│   │   └── admin/
│   ├── hooks/               # Custom React hooks
│   │   ├── useAuth
│   │   ├── useShipments
│   │   ├── useTracking
│   │   └── usePayment
│   ├── services/            # API communication (calls Backend Foundation)
│   │   ├── api-client.ts    # Axios instance, interceptors
│   │   ├── auth.ts
│   │   ├── shipments.ts
│   │   ├── tracking.ts
│   │   └── payments.ts
│   ├── store/               # Zustand or Jotai stores
│   │   ├── auth.ts
│   │   ├── shipment.ts
│   │   └── ui.ts
│   ├── types/               # TypeScript interfaces (shared with backend types package)
│   ├── utils/               # Utility functions
│   ├── styles/              # Global styles, Tailwind config
│   └── App.tsx              # Root component, routing
└── vite.config.ts
```

### Phase 1 Screens

| Screen | Purpose | API Calls |
|---|---|---|
| Login/Signup | User authentication | POST /auth/register, POST /auth/login |
| Home | Browse, quick actions | GET /user/profile |
| Create Shipment | Initiate new delivery | POST /shipments, GET /pricing |
| Shipment Confirmation | Show price, payment options | (state only) |
| Payment | Pay for shipment | POST /payments |
| Track Shipment | Live tracking map | GET /shipments/{id}, WebSocket /tracking/{id} |
| History | Past shipments | GET /shipments?page=... |
| Account | Profile, settings | GET/PUT /user/profile |
| Admin Dashboard | Monitor system (basic) | GET /admin/stats, GET /admin/orders |

### Error Handling

- **Loading state:** Skeleton screens, spinners
- **Success state:** Toast notifications, redirect
- **Error state:** Error boundary, retry button
- **Empty state:** Helpful message, CTA
- **Offline state:** Cached data shown; sync on reconnect

### Performance Targets

- **Initial load:** < 2 seconds (Lighthouse target)
- **API response:** < 200ms p95
- **Interactive TTI:** < 3 seconds
- **Map load:** < 1 second
- **Tracking update:** < 500ms (WebSocket latency)

### Security Considerations

- **Token storage:** HttpOnly cookies (not localStorage)
- **API security:** CORS configured, rate limiting headers
- **Input validation:** Zod schemas on client
- **XSS prevention:** React auto-escapes, Markdown sanitization if needed
- **CSRF:** Token in headers (automatic with httpOnly cookies)

---

## FOUNDATION 2: BACKEND

### Purpose

- **Business logic engine** for all WAZZAR operations
- **API server** serving web, mobile, admin clients
- **Data validation** and authorization
- **Integration point** for payments, location, notifications

### Technology Stack

| Component | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 18+ | Async I/O, JavaScript ecosystem, good for I/O-heavy apps |
| Language | TypeScript | Type safety, catches errors at compile time |
| Framework | NestJS | Modular architecture, dependency injection, built-in testing support |
| Database Driver | TypeORM or Prisma | Type-safe ORM, migrations, seed support |
| API Documentation | OpenAPI / Swagger | Automated API docs, schema validation |
| Logging | Winston | Structured logging, multiple transports |
| Error tracking | Sentry (Phase 2) | Catch production errors, alerting |

### Microservices (Phase 1 → Monolith, Phase 2+ → Services)

**Phase 1 (Monolith with Service Layer):**

As actually built (checked against `backend/backend/src/modules/` on 2026-08-22, updated same day after a second backend build was merged in), the module set is larger than the previous check found — `business-customers`, `business-staff`, `geocoding`, and `uploads` are now real modules, alongside two root-level security files:

```
backend/
├── src/
│   ├── modules/
│   │   ├── auth/               # Authentication (phone + password, JWT, role guards)
│   │   ├── riders/              # Rider profiles, verification, live location
│   │   ├── shipments/           # Shipment lifecycle — creation, 12-state status machine, rider rating
│   │   ├── pricing/              # Fare calculation
│   │   ├── payments/              # M-Pesa/Stripe processing — mock by default, real when credentials set
│   │   ├── dispatch/               # Rider matching/assignment queue
│   │   ├── tracking/                # Live GPS ingestion, ETA, WebSocket streaming
│   │   ├── health/                   # Service health checks
│   │   ├── business-customers/         # A business's own saved-recipient address book (added 2026-08-22)
│   │   ├── business-staff/               # Business staff roster, not a login system (added 2026-08-22)
│   │   ├── geocoding/                      # Address search via OpenStreetMap Nominatim (added 2026-08-22)
│   │   ├── uploads/                          # File uploads — local disk, served at /uploads/ (added 2026-08-22)
│   │   └── scheduled-deliveries/               # Recurring deliveries + a real @nestjs/schedule cron job (added 2026-08-22, later same day)
│   │   # Still not built: users (folded into auth/riders), notifications, ratings,
│   │   # dedicated admin module — these remain Phase 2 targets below
│   ├── common/                 # As built: just money.ts (a shared currency helper) so far —
│   │   └── money.ts            # guards/decorators/interceptors/filters/pipes are still Phase 2 targets
│   ├── database/
│   │   ├── entities/          # TypeORM entities (database models)
│   │   ├── migrations/        # Database version control
│   │   ├── seeds/             # Development data
│   │   └── data-source.ts     # TypeORM config (no separate config/ or types/ folders exist yet)
│   ├── app.module.ts
│   ├── main.ts                # App entry point — now also wires helmet(), rawBody, static /uploads serving
│   ├── cors-origin.ts          # Resolves the CORS_ORIGIN env var into an allow-list (added 2026-08-22)
│   └── security-checks.ts       # Refuses to boot in production with unsafe/missing config (added 2026-08-22)
├── .env.example
└── package.json
```

**Phase 2+ (Domain Services — not one-service-per-noun):**

> **Revised (2026-08-22):** Previously listed 11 separate services (auth, user, shipment, matching, pricing, location, payment, notification, tracking, hub, admin) — roughly the granularity Uber's own engineering org moved away from. Uber decomposed its monolith into thousands of microservices by ~2018 and found it made the system harder to reason about and operate, not easier; their public post-mortem (DOMA — Domain-Oriented Microservice Architecture, ~2020) consolidated back down to a handful of domain-level services. WAZZAR should split by domain, not by noun, and only when Phase 1 actually hits a scaling bottleneck a single service can't handle — not preemptively (Guiding Principle 2 above).

```
services/
├── identity-service/       # auth, users, roles, rider profiles & verification
├── logistics-service/      # shipments, legs, proof of delivery
├── dispatch-service/       # matching, assignment, rider location/tracking
├── pricing-service/        # fare calculation, pricing configs
├── payments-service/       # payment processing, settlement, refunds
└── notifications-service/  # SMS, push, email, in-app — the Wire Pattern integrations live here
```

Each domain service owns its own database schema and is only ever called through its API — never a direct database read from another service. Split further only when a specific service's load genuinely can't be handled by scaling that one service horizontally.

### API Structure (Phase 2+ illustrative — not current)

**RESTful endpoints organized by domain**, matching the consolidated services above. Phase 1's real routes (no `/api/v1` prefix, no `/user` or `/admin` modules) are documented in Foundation 4 → "Key Endpoints (Phase 1)" — this block is forward design for the domain-service split, not a description of what exists today:

```
/api/v1/identity/
  POST   /auth/register
  POST   /auth/login
  POST   /auth/refresh
  GET    /me
  GET    /riders/{id}
  PATCH  /riders/{id}/verify

/api/v1/logistics/
  POST   /shipments
  GET    /shipments/{id}
  GET    /shipments/{id}/history
  GET    /shipments/{id}/proof-of-delivery

/api/v1/dispatch/
  GET    /queue
  POST   /shipments/{id}/assign
  POST   /rider/location
  GET    /shipments/{id}/tracking

/api/v1/pricing/
  POST   /calculate
  GET    /configs

/api/v1/payments/
  POST   /initiate
  GET    /{id}/status
  POST   /webhooks/{provider}

/api/v1/notifications/
  GET    /history
```

### Database Models (TypeORM Entities)

**Phase 1 (Local Delivery):**

- `User` — Customers, Riders, Admins, Businesses
- `UserRole` — Define role (customer, rider, admin, business)
- `Shipment` — Parcel/delivery record
- `ShipmentStatus` — History of status changes
- `Rider` — Rider profile (extended User)
- `RiderLocation` — Current/historical rider location
- `Payment` — Payment transaction
- `Rating` — Shipment rating
- `Notification` — Notification log

**Phase 2+ (Intercity):**

- `Leg` — Individual leg within shipment
- `Hub` — Physical transfer points
- `PartnerOperator` — Bus company
- `Carrier` — Bus/vehicle
- `TrackingChannel` — Tracking source (GPS, PARTNER_SCAN, Latra, etc.)
- `TrackingEvent` — Historical tracking data
- `Dispatcher` — Hub staff

### Business Logic

**Matching Service:**

```typescript
// Pseudocode
async findNearestRider(pickup: Location): Promise<Rider[]> {
  const availableRiders = await db.riders.findAvailable()
  const sorted = availableRiders.sort(
    (a, b) => distance(a.location, pickup) - distance(b.location, pickup)
  )
  return sorted.slice(0, 5) // Return 5 nearest
}

async cascadeOffer(shipmentId, riders: Rider[]) {
  for (const rider of riders) {
    const offered = await notificationService.sendOffer(rider, shipmentId)
    if (offered) {
      const accepted = await waitForAcceptance(shipmentId, timeout: 30s)
      if (accepted) return rider
    }
  }
  // No rider accepted, retry or escalate
}
```

**Pricing Service:**

```typescript
async calculatePrice(
  origin: Location,
  destination: Location,
  weight: number,
  demandMultiplier: number = 1.0
): Promise<Price> {
  const distance = calculateDistance(origin, destination)
  const basePrice = 3000 // TZS
  const distanceRate = 500 // per km
  const weightRate = 100 // per kg
  const distanceCost = distance * distanceRate
  const weightCost = weight * weightRate
  const total = (basePrice + distanceCost + weightCost) * demandMultiplier
  return { basePrice, distanceCost, weightCost, total, demandMultiplier }
}
```

**Payment Service:**

```typescript
async initiatePayment(
  shipmentId: string,
  amount: number,
  method: 'mobile_money' | 'card' | 'cash'
): Promise<Payment> {
  const payment = await db.payments.create({
    shipmentId,
    amount,
    method,
    status: 'PENDING'
  })

  if (method === 'mobile_money') {
    const result = await mpesaProvider.charge(amount, customerPhone)
    payment.externalId = result.transactionId
    payment.status = 'PROCESSING' // Wait for callback
  } else if (method === 'card') {
    const result = await stripeProvider.charge(amount, cardToken)
    payment.externalId = result.paymentIntentId
    payment.status = 'PROCESSING'
  } else if (method === 'cash') {
    payment.status = 'PENDING_CASH_COLLECTION'
  }

  await db.payments.save(payment)
  return payment
}

// Webhook handler for M-Pesa callback
async handleMPesaCallback(event: MPesaEvent) {
  const payment = await db.payments.findOne({ externalId: event.transactionId })
  if (event.resultCode === 0) {
    payment.status = 'COMPLETED'
    await shipmentService.updateStatus(payment.shipmentId, 'CONFIRMED')
  } else {
    payment.status = 'FAILED'
  }
  await db.payments.save(payment)
}
```

### Error Handling

- **Input validation:** Pipes in NestJS, Zod/Joi schemas
- **Database errors:** Transaction rollback, retry logic
- **External service failures:** Retry with exponential backoff, circuit breaker
- **Authorization errors:** 403 Forbidden, clear message
- **Not found errors:** 404, with helpful information
- **Server errors:** 500, logged to Sentry, user sees generic message

### Security

- **Authentication:** JWT tokens in httpOnly cookies or Authorization header
- **Authorization:** Role-based access control via guards
- **Input validation:** All requests validated with schemas
- **Rate limiting:** Per-user or per-IP rate limits on sensitive endpoints (login, payment)
- **CORS:** Configured for allowed origins only
- **Secrets:** Environment variables, never in code
- **Logging:** All important actions logged (user creation, payment, dispute)
- **SQL injection:** Parameterized queries via TypeORM
- **HTTPS:** All traffic encrypted

---

## FOUNDATION 3: DATABASE

### Purpose

Persistent storage for all WAZZAR data (users, shipments, payments, tracking).

### Technology: PostgreSQL

**Why PostgreSQL:**
- ACID compliance (critical for payments/shipments)
- JSON support (flexible data like shipment metadata, tracking events)
- Full-text search (future feature: search by parcel description)
- PostGIS (optional, for geographic queries)
- Scalability (handles millions of shipments)
- Open source, excellent tooling

### Schema Overview (Phase 1)

> **Corrected (2026-08-22):** This section previously listed `businesses`, `ratings`, and `notifications` tables — none of these exist anywhere in the codebase (no entity, no migration, no module). It also showed `payments.method` as `MOBILE_MONEY/CARD/CASH/INVOICE` (real enum: `MPESA/STRIPE/CASH`) and `user_roles.role` without `DISPATCHER` (added by the `AddDispatcherRole` migration). Below reflects the 9 tables that actually exist, per `backend/backend/src/database/entities/` and `src/database/migrations/`.

**Core Tables:**

```sql
-- Users (all roles: customer, rider, admin, business)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  profile_photo_url TEXT,
  status ENUM('ACTIVE', 'SUSPENDED', 'DELETED'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- User roles (one user can have multiple roles)
CREATE TABLE user_roles (
  user_id UUID NOT NULL,
  role ENUM('CUSTOMER', 'RIDER', 'BUSINESS', 'DISPATCHER', 'ADMIN', 'SUPER_ADMIN'),
  verified_at TIMESTAMP,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Rider-specific data
CREATE TABLE riders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  vehicle_type VARCHAR(50), -- 'motorcycle', 'bodaboda'
  vehicle_registration VARCHAR(100),
  license_number VARCHAR(100),
  insurance_expires_at DATE,
  documents_verified_at TIMESTAMP,
  status ENUM('ONBOARDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED'),
  total_earnings DECIMAL(12, 2) DEFAULT 0,
  rating_avg DECIMAL(3, 2),
  rating_count INT DEFAULT 0,
  created_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Current rider location (live) — upserted per rider, not a history table
CREATE TABLE rider_locations (
  rider_id UUID PRIMARY KEY,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  accuracy_meters INT,
  updated_at TIMESTAMP,
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);

-- Shipments (orders)
CREATE TABLE shipments (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL,
  rider_id UUID,
  status ENUM('CREATED', 'QUOTED', 'CONFIRMED', 'ASSIGNMENT_PENDING', 'ASSIGNED', 'PICKUP_IN_PROGRESS', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'),
  pickup_location JSONB, -- { latitude, longitude, address, instruction }
  dropoff_location JSONB,
  package_weight_kg DECIMAL(8, 2),
  package_description TEXT,
  price DECIMAL(12, 2),
  commission DECIMAL(12, 2), -- WAZZAR cut
  rider_payout DECIMAL(12, 2),
  created_at TIMESTAMP,
  assigned_at TIMESTAMP,
  picked_up_at TIMESTAMP,
  delivered_at TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(id),
  FOREIGN KEY (rider_id) REFERENCES riders(id),
  INDEX idx_customer (customer_id),
  INDEX idx_rider (rider_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at DESC)
);

-- Shipment status history (audit) — table name is shipment_statuses, not shipment_status_history
CREATE TABLE shipment_statuses (
  id UUID PRIMARY KEY,
  shipment_id UUID NOT NULL,
  status VARCHAR(50),
  changed_by UUID,
  changed_at TIMESTAMP DEFAULT NOW(),
  reason TEXT,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id),
  INDEX idx_shipment (shipment_id)
);

-- Proof of delivery — one row per shipment (shipment_id is the primary key,
-- not a separate id), written on OUT_FOR_DELIVERY -> DELIVERED
CREATE TABLE proof_of_delivery (
  shipment_id UUID PRIMARY KEY,
  recipient_name VARCHAR(255) NOT NULL,
  photo_url TEXT,
  notes TEXT,
  delivered_by UUID NOT NULL,
  created_at TIMESTAMP,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);

-- Pricing configs — time-versioned; only one is_active = true at a time
CREATE TABLE pricing_configs (
  id UUID PRIMARY KEY,
  pricing_mode ENUM('DISTANCE', 'WEIGHT', 'HYBRID'),
  is_active BOOLEAN DEFAULT true,
  base_price DECIMAL(12, 2),
  price_per_km DECIMAL(12, 2) DEFAULT 0,
  included_distance_km DECIMAL(8, 2) DEFAULT 0,
  price_per_kg DECIMAL(12, 2) DEFAULT 0,
  included_weight_kg DECIMAL(8, 2) DEFAULT 0,
  platform_commission_percent DECIMAL(5, 2),
  rider_payout_percent DECIMAL(5, 2),
  surge_multiplier DECIMAL(5, 2) DEFAULT 1.0,
  surge_active_hours JSONB,
  min_price DECIMAL(12, 2),
  max_price DECIMAL(12, 2),
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_by UUID
);

-- Payments — MPESA and STRIPE are both mocked providers as of Phase 1, no live SDKs
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  shipment_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  method ENUM('MPESA', 'STRIPE', 'CASH'),
  status ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'PENDING_CASH_COLLECTION'),
  amount DECIMAL(12, 2),
  external_id VARCHAR(255) UNIQUE, -- provider's transaction/checkout id; null until provider call succeeds, always null for CASH
  provider VARCHAR(50),
  error_message TEXT,
  refunded_amount DECIMAL(12, 2) DEFAULT 0,
  refund_reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id),
  FOREIGN KEY (customer_id) REFERENCES users(id),
  INDEX idx_shipment (shipment_id)
);
```

**Updated (2026-08-22, post-merge):** A second backend build (business-customers, business-staff, geocoding, uploads modules; rider document uploads; shipment rider ratings) was merged into this codebase. Two of the three "not yet built" items below are partially addressed:

```sql
-- Rider profile documents (added via AddRiderDocumentUrls migration) —
-- append to the riders table above:
--   id_document_url, license_document_url,
--   vehicle_registration_document_url, insurance_document_url
--   (all VARCHAR(500), nullable — populated by POST /uploads, then
--   passed back here)

-- Shipment rider rating (added via AddShipmentRiderRating migration) —
-- append to the shipments table above:
--   rider_rating SMALLINT NULL  (NULL = not rated yet; also the guard
--   against rating the same shipment twice — set once via
--   POST /shipments/:id/rate-rider)

-- Business customers — a business's own saved-recipient address book,
-- NOT linked to real platform CUSTOMER accounts (recipients may not
-- have a WAZZAR account at all)
CREATE TABLE business_customers (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL, -- the owning business account; every
                              -- query is scoped to this so one business
                              -- can never see another's address book
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES users(id)
);

-- Business staff — a roster, not a login/invite system. New entries
-- always land PENDING; nobody gets an actual WAZZAR account from this
CREATE TABLE business_staff (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role VARCHAR(100),
  status ENUM('PENDING', 'ACTIVE'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES users(id)
);
-- Scheduled/recurring deliveries (added 2026-08-22, third merge) —
-- a schedule definition; ScheduledDeliveriesCronService reads active
-- rows on a timer and creates a real Shipment when next_run_at is due
CREATE TABLE scheduled_deliveries (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL, -- owning business account, same scoping
                              -- pattern as business_customers/business_staff
  name VARCHAR(150) NOT NULL,
  pickup_location JSONB NOT NULL,
  dropoff_location JSONB NOT NULL,
  package_weight_kg DECIMAL(8, 2),
  package_description TEXT,
  days_of_week JSONB NOT NULL,
  time_of_day VARCHAR(5) NOT NULL,
  active BOOLEAN DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_run_error TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES users(id)
);
```

**Still not built:** a `ratings` table for customer-facing rider reviews (shipment-level rider *rating*, above, exists now — a dedicated ratings/reviews table with comments does not) and a `notifications` log table. There is still no single `businesses` table with `api_key`/`monthly_shipment_limit`-style fields as originally envisioned — `business_customers` and `business_staff` are narrower, scoped-to-an-existing-user-account tables, not that.

### Phase 2 (Intercity) Tables

```sql
-- Legs (individual segments within a shipment)
CREATE TABLE legs (
  id UUID PRIMARY KEY,
  shipment_id UUID NOT NULL,
  leg_type ENUM('LOCAL', 'TRUNK'),
  sequence INT, -- 1, 2, 3...
  from_location JSONB, -- hub or customer location
  to_location JSONB,
  status VARCHAR(50),
  assigned_to UUID, -- rider_id for LOCAL, carrier_id for TRUNK
  created_at TIMESTAMP,
  completed_at TIMESTAMP,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);

-- Shipments (replaces/extends single-leg Deliveries)
CREATE TABLE shipments_v2 (
  -- Same as shipments above, but with
  leg_count INT,
  current_leg INT
);

-- Hubs (intercity transfer points)
CREATE TABLE hubs (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  city VARCHAR(100),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  address TEXT,
  capacity_kg INT,
  manager_id UUID,
  created_at TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id)
);

-- Partner Operators (bus companies)
CREATE TABLE partner_operators (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(255),
  api_key VARCHAR(255) UNIQUE,
  latra_api_key VARCHAR(255), -- Encrypted
  status ENUM('ACTIVE', 'SUSPENDED'),
  created_at TIMESTAMP
);

-- Carriers (buses/vehicles)
CREATE TABLE carriers (
  id UUID PRIMARY KEY,
  partner_operator_id UUID NOT NULL,
  vehicle_type ENUM('BUS', 'TRUCK', 'VAN'),
  registration VARCHAR(100),
  capacity_kg INT,
  routes JSONB, -- [{ from_city, to_city }]
  schedule JSONB, -- departure times, frequency
  status ENUM('ACTIVE', 'INACTIVE'),
  FOREIGN KEY (partner_operator_id) REFERENCES partner_operators(id)
);

-- Tracking Channels (tracking sources for trunk legs)
CREATE TABLE tracking_channels (
  id UUID PRIMARY KEY,
  leg_id UUID NOT NULL,
  channel_type ENUM('GPS_LIVE', 'LATRA_TRACKING', 'PARTNER_SCAN', 'SMS_WEBHOOK', 'DISPATCHER_MANUAL'),
  source VARCHAR(50), -- 'rider_gps', 'latra_api', 'partner_scan_qr', ...
  event_data JSONB, -- location, status, timestamp, metadata
  created_at TIMESTAMP,
  processed_at TIMESTAMP,
  FOREIGN KEY (leg_id) REFERENCES legs(id)
);

-- Tracking Events (audit trail)
CREATE TABLE tracking_events (
  id UUID PRIMARY KEY,
  leg_id UUID NOT NULL,
  event_type VARCHAR(50), -- 'location_update', 'status_change', 'hub_handoff'
  metadata JSONB,
  created_at TIMESTAMP,
  FOREIGN KEY (leg_id) REFERENCES legs(id)
);

-- Dispatchers (hub operations staff)
CREATE TABLE dispatchers (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  assigned_hub_ids UUID[], -- array of hub IDs
  created_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Indexes Strategy

**Priority (Phase 1):**

```sql
CREATE INDEX idx_shipments_customer_created ON shipments(customer_id, created_at DESC);
CREATE INDEX idx_shipments_rider_status ON shipments(rider_id, status);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_payments_shipment ON payments(shipment_id);
CREATE INDEX idx_riders_active ON riders(status) WHERE status = 'ACTIVE';
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_ratings_rated ON ratings(rated_id);
```

**Secondary (Phase 2):**

```sql
CREATE INDEX idx_tracking_channels_leg ON tracking_channels(leg_id, created_at DESC);
CREATE INDEX idx_tracking_events_leg ON tracking_events(leg_id);
CREATE INDEX idx_legs_shipment ON legs(shipment_id);
```

### Caching Layer (Redis)

**Live data in Redis (not persistent):**

```
rider:{rider_id}:location → { lat, lng, timestamp }
shipment:{shipment_id}:tracking → { status, rider_location, eta, last_update }
active:riders:count → integer
active:shipments:count → integer
demand:multiplier:current → float
```

### Data Retention & Archival

- **Active shipments:** Forever (reference data)
- **Rider locations:** 7 days (live tracking, then deleted)
- **Payment logs:** 7 years (tax/audit)
- **Notifications:** 90 days (delete after)
- **Ratings:** Forever (reputation data)

---

## FOUNDATION 4: API

### Purpose

Define the contract between backend and all clients (web, mobile, admin).

### Specification Format: OpenAPI 3.0

Complete API documented in `/api/openapi.yaml` (generated from code, not manual).

### Key Endpoints (Phase 1)

> **Corrected (2026-08-22):** This section previously prefixed every route with `/api/v1/` — the backend has no global prefix (`main.ts` never calls `setGlobalPrefix`), so real routes are plain `/auth/register`, `/shipments`, etc. It also listed a `/user/profile` module and an `/admin/*` API that don't exist, several endpoints under the wrong path or method, and omitted most of what's actually built. Below reflects the real routes, per each module's `*.controller.ts`.

**Authentication** (`/auth`):

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
GET    /auth/me
```

Not implemented: logout, forgot-password, reset-password. (`auth.service.ts` has a TODO noting refresh tokens aren't persisted/blacklisted anywhere yet, so logout can't be made real until that lands.)

**Shipments** (`/shipments`):

```
POST   /shipments                         # Create
GET    /shipments                         # List (filtered by status, paginated, scoped to caller)
GET    /shipments/available               # Open shipments a rider can pick up
GET    /shipments/{id}                    # Get one
GET    /shipments/{id}/history            # Status change audit trail
PATCH  /shipments/{id}/status             # Validated state-machine transition
POST   /shipments/{id}/assign             # Admin/dispatcher assigns a rider
POST   /shipments/{id}/deliver            # Rider submits proof of delivery
GET    /shipments/{id}/proof-of-delivery  # Read back proof of delivery
```

Not implemented: cancel (`DELETE`), rate/review — there's no ratings module.

**Riders** (`/riders`, plural):

```
POST   /riders                            # Self-onboard
GET    /riders/me                         # Own profile
GET    /riders/me/earnings
POST   /riders/availability/online
POST   /riders/availability/offline
PATCH  /riders/{id}/verify                # Admin verifies documents
```

Not implemented: withdraw, active-shipments (use `GET /shipments?status=...` scoped to the caller instead).

**Dispatch** (`/dispatch`):

```
GET    /dispatch/queue                    # Pending shipments + online riders
GET    /dispatch/shipments/{id}/candidates
POST   /dispatch/shipments/{id}/assign
POST   /dispatch/shipments/{id}/auto-assign
```

**Pricing** (`/pricing`):

```
POST   /pricing/calculate
GET    /pricing/active
GET    /pricing/configs
POST   /pricing/configs
PUT    /pricing/configs/{id}
```

**Payments** (`/payments`):

```
POST   /payments/initiate
GET    /payments/history
GET    /payments/{id}/status
GET    /payments/reconcile/{date}
POST   /payments/{id}/refund
POST   /payments/{id}/collect-cash
POST   /payments/webhooks/mpesa
POST   /payments/webhooks/stripe
```

**Tracking:**

```
POST   /rider/location                    # Rider pushes a GPS ping
GET    /shipments/{id}/tracking           # HTTP snapshot: rider location, status, ETA
```

**Added 2026-08-22 (merged from a second backend build):**

```
# Shipment rider rating (customer rates the rider after delivery)
POST   /shipments/{id}/rate-rider

# Business address book — scoped server-side to the calling business
POST   /business/customers
GET    /business/customers
PATCH  /business/customers/{id}
DELETE /business/customers/{id}

# Business staff roster — not a login/invite system, see "Not built" below
POST   /business/staff
GET    /business/staff
PATCH  /business/staff/{id}
DELETE /business/staff/{id}

# Geocoding — real integration (OpenStreetMap Nominatim, no API key), see Integrated Services below
GET    /geocode/search?q={query}

# File uploads — local-disk storage, served back at /uploads/{filename}
POST   /uploads
```

**Added 2026-08-22, later the same day (third merge):**

```
# Scheduled/recurring deliveries — scoped server-side to the calling
# business; backed by a real cron job, not just CRUD (see Foundation 3's
# scheduled_deliveries table and the Integrated Services note below)
POST   /business/scheduled-deliveries
GET    /business/scheduled-deliveries
PATCH  /business/scheduled-deliveries/{id}
DELETE /business/scheduled-deliveries/{id}
```

**Not built:** any `/user/profile` endpoints, and the entire `/admin/*` API (stats, admin-scoped shipment/user/payment listing, dispute resolution) — there's no admin module in the codebase. Business staff invites don't send email or create a real login — a roster entry only.

### Real-Time Tracking (WebSocket)

> **Corrected (2026-08-22):** The actual implementation (`tracking.gateway.ts`) is a Socket.IO namespace, not a raw WebSocket connection per shipment — a client connects once with a bearer token, then emits `subscribe`/`unsubscribe` per shipment it wants updates for, each shipment getting its own server-side room. The code comment there confirms this was deliberately adapted from this doc's original single-connection design.

```
Socket.IO namespace: /tracking  (connect with an Authorization bearer token)
client emits:  subscribe   { shipmentId }
client emits:  unsubscribe { shipmentId }
```

Server pushes a location update on every rider GPS ping (not a fixed interval):

```json
{
  "shipmentId": "uuid",
  "riderLocation": { "lat": -6.792, "lng": 39.208 },
  "status": "IN_TRANSIT",
  "etaSeconds": 1200,
  "lastUpdated": "2026-08-18T15:30:45Z"
}
```

### Request/Response Examples

**Create Shipment (POST /shipments):**

Request:

```json
{
  "pickupLocation": {
    "address": "46 Morogoro Road, Dar es Salaam",
    "latitude": -6.792,
    "longitude": 39.208,
    "instruction": "Call when arriving"
  },
  "dropoffLocation": {
    "address": "Samora Avenue, Dar es Salaam",
    "latitude": -6.801,
    "longitude": 39.215,
    "instruction": "Leave at reception"
  },
  "package": {
    "description": "Documents",
    "weightKg": 0.5
  }
}
```

Response (201 Created):

```json
{
  "shipmentId": "uuid",
  "status": "QUOTED",
  "price": {
    "basePrice": 3000,
    "distancePrice": 1200,
    "weightPrice": 50,
    "demandMultiplier": 1.0,
    "total": 4250,
    "currency": "TZS"
  },
  "estimatedPickupTime": 300,
  "estimatedDeliveryTime": 1200
}
```

### Error Responses

**400 Bad Request:**

```json
{
  "error": "INVALID_REQUEST",
  "message": "Pickup location is required",
  "details": {
    "field": "pickupLocation",
    "reason": "MISSING"
  }
}
```

**401 Unauthorized:**

```json
{
  "error": "UNAUTHORIZED",
  "message": "No authentication token provided"
}
```

**403 Forbidden:**

```json
{
  "error": "PERMISSION_DENIED",
  "message": "You don't have permission to cancel this shipment"
}
```

**404 Not Found:**

```json
{
  "error": "NOT_FOUND",
  "message": "Shipment not found",
  "shipmentId": "uuid"
}
```

**429 Too Many Requests:**

```json
{
  "error": "RATE_LIMITED",
  "message": "You have made too many requests. Try again in 60 seconds",
  "retryAfter": 60
}
```

### Authentication

**JWT Token in Authorization Header:**

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Token Expiry:**

- Access token: 15 minutes
- Refresh token: 7 days
- Refresh endpoint: POST /auth/refresh (no /api/v1 prefix — see Key Endpoints correction above)

### Rate Limiting

- **Public endpoints:** 100 req/min per IP
- **Authenticated endpoints:** 1000 req/min per user
- **Payment endpoints:** 10 req/min per user (fraud prevention)

---

## FOUNDATION 5: SERVER / INFRASTRUCTURE

### Purpose

Define where WAZZAR runs and how it scales.

### Phase 1 Architecture (Single Deployment)

Every box below is something WAZZAR runs and controls directly — standard, portable building blocks (Postgres, Redis, S3-compatible storage, plain Node.js processes) rather than a vendor's proprietary managed product. That's deliberate: it's what lets the whole stack move from one host to another (or from a VPS to Kubernetes later) without a rewrite. See Guiding Principle 4 above.

```
┌─────────────────────────────────────┐
│ CDN (Cloudflare or similar)          │
│ (Static assets, caching)             │
└────────────────┬────────────────────┘
                 ↓
        ┌────────────────┐
        │ API Gateway    │
        │ (Rate limit,   │
        │  CORS, SSL)    │
        └────────┬───────┘
                 ↓
┌─────────────────────────────────────┐
│ Application Servers (NestJS)         │
│ • 2–4 instances (Node.js)            │
│ • Behind load balancer               │
│ • Auto-scaling on CPU/memory         │
└────────┬────────────────────────────┘
         ↓
    ┌────────────┐         ┌─────────────┐
    │ PostgreSQL │         │ Redis       │
    │ (self-run  │         │ (Session,   │
    │  container)│         │  Location)  │
    └────────────┘         └─────────────┘
         ↑
    ┌────────────────────────────────────┐
    │ File Storage (S3-compatible, e.g.   │
    │ MinIO — not locked to one vendor)   │
    │ (Profiles, receipts, verification) │
    └────────────────────────────────────┘
```

### Deployment Platform Options

> **Reordered (2026-08-22)** to match Guiding Principle 4 (in-house control over vendor lock-in) — self-hosted is the default recommendation, not a fallback. AWS/GCP remain reasonable choices once there's an ops team to justify outsourcing infrastructure to, but the architecture itself is written to not depend on either.

**Option 1: Self-hosted (Recommended)**

- **Compute:** A VPS or small Kubernetes cluster (e.g. Hetzner, DigitalOcean, or on-premise) running Docker containers — the same containers work unmodified on any host
- **Database:** PostgreSQL (self-managed container or managed instance from any provider — TypeORM doesn't care which)
- **Cache:** Redis (self-managed container)
- **Storage:** S3-compatible object storage (MinIO, self-hosted, or any S3-compatible provider) — never code against a proprietary storage SDK
- **Load balancing:** Nginx or Caddy
- **CI/CD:** Any standard runner (GitHub Actions, self-hosted) building a Docker image — not tied to one platform's pipeline product
- **Monitoring:** Self-hosted Grafana + Prometheus, or a lightweight hosted equivalent
- **Secrets:** `.env` files in development, a self-hosted secrets store (e.g. Vault) or the host platform's basic secret storage in production — never build against one vendor's proprietary secrets API

**Option 2: Managed cloud (AWS or GCP) — when ops capacity justifies it**

- **AWS:** EC2/ECS, RDS PostgreSQL, ElastiCache Redis, S3, CloudFront, ALB, CodePipeline, CloudWatch, Secrets Manager
- **GCP:** Cloud Run/Compute Engine, Cloud SQL, Memorystore, Cloud Storage, Cloud CDN, Cloud Load Balancing, Cloud Build, Cloud Monitoring
- Fine as an operational choice — but nothing in the application code should end up depending on a vendor-specific API (e.g. call S3 through the generic S3-compatible client, not an AWS-only SDK feature) so a move off either platform later is a config change, not a rewrite.

### Environments

**Development:**

- Laptop/local machine
- SQLite or local PostgreSQL
- Mocked external services
- Hot reload enabled

**Staging:**

- AWS/GCP staging account
- Real PostgreSQL instance
- Real (test) payment provider account
- Real SMS provider (test account)
- Mirrors production closely

**Production:**

- AWS/GCP production account
- Managed PostgreSQL (multi-AZ)
- Managed Redis (high availability)
- Real payment providers
- Real SMS providers
- Monitoring, logging, alerting enabled
- Backups automated, tested

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/wazzar_db

# Redis
REDIS_URL=redis://host:6379

# JWT
JWT_SECRET=<64-char random string>
JWT_EXPIRY_SECONDS=900

# Payment providers
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
STRIPE_SECRET_KEY=...

# SMS provider
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...

# Maps
GOOGLE_MAPS_API_KEY=...

# File storage
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=wazzar-uploads

# Notifications
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...

# Logging
SENTRY_DSN=...

# App
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
```

### Scaling Strategy (Phase 2+)

**Vertical scaling (Phase 1):**
- Larger app server instances
- Higher PostgreSQL compute

**Horizontal scaling (Phase 2+):**
- Multiple app server instances (auto-scaling group)
- PostgreSQL read replicas for read-heavy queries
- Redis cluster for caching
- Message queue (RabbitMQ, AWS SQS) for async jobs
- Microservices (each service independent scalability)

---

## FOUNDATION 6: AUTHENTICATION & AUTHORIZATION

### Purpose

Secure user identity and control who can do what.

### Authentication Flow (Phase 1)

> **Corrected (2026-08-22):** This section previously described tokens as delivered via `httpOnly` cookies and included a working logout flow with fraud-detection logging on failed login. Neither matches the real backend: `auth.service.ts` returns `{ accessToken, refreshToken }` in the JSON response body (no cookie handling anywhere in the codebase), there's no `/auth/logout` endpoint, and failed logins aren't logged. `auth.service.ts` itself has a TODO explaining why: refresh tokens aren't persisted or blacklisted anywhere, so there's nothing to invalidate on logout yet.

**Signup:**

```
1. User enters phone, password, and optionally email (email is not required — `RegisterDto` marks it `@IsOptional()`)
2. Backend validates input (unique phone, valid email, strong password)
3. Backend hashes password (bcrypt)
4. Backend creates user, status is verified immediately — **no OTP/SMS step in Phase 1** (the real backend has no SMS integration; this was originally planned but is not implemented)
5. Generate JWT tokens
6. Return { accessToken, refreshToken } in the JSON response body
7. Frontend stores tokens and sends accessToken as an Authorization: Bearer header on subsequent requests
```

**Login:**

```
1. User enters phone, password
2. Backend fetches user by phone
3. Backend verifies password (bcrypt) — same error for "no such user" and "wrong password", so the response never leaks which one it was
4. If verified:
   - Generate JWT tokens
   - Return { accessToken, refreshToken } in the JSON response body
5. If not verified:
   - Return 401 "Invalid phone or password" (no failed-attempt logging exists yet)
```

**Token Refresh:**

```
1. Access token expires
2. Frontend detects expiry
3. Frontend calls POST /auth/refresh with refresh token
4. Backend validates refresh token
5. Backend generates new access token
6. Return new accessToken in the JSON response body
7. Frontend retries original request
```

**Logout:** Not implemented. There's no `/auth/logout` endpoint and no server-side store of issued refresh tokens to revoke — a client can only discard its local copy of the tokens, which doesn't invalidate them for anyone who already has them. Needs a `refresh_tokens` table (or Redis) before real logout / "sign out of all devices" is possible.

### Authentication with Google OAuth — not built (design intent only)

No Google OAuth code exists anywhere in the backend (confirmed: no `google` reference in `src/`) — `backend/README.md` lists this as an open gap. The flow below is forward design, not a current feature.

**Google Sign-In Flow (proposed):**

```
1. User clicks "Sign in with Google"
2. Frontend redirects to Google OAuth consent screen
3. User grants permissions to WAZZAR
4. Google redirects back to WAZZAR with auth code
5. Frontend sends auth code to backend
6. Backend exchanges code for Google token
7. Backend fetches user info from Google (name, email, profile picture)
8. Backend checks if email exists in WAZZAR
   a. If yes: Log in existing user
   b. If no: Create new user with Google info
9. Generate JWT tokens
10. Return { accessToken, refreshToken } in the JSON response body, matching the pattern the rest of auth already uses
11. Redirect to home
```

### Authorization (Role-Based)

**Roles:**

| Role | Permissions |
|---|---|
| CUSTOMER | Create shipment, pay, track, rate |
| RIDER | Accept offer, pickup, deliver, withdraw, rate |
| BUSINESS | Create bulk shipments via API, view analytics |
| ADMIN | Manage users, shipments, payments, view admin dashboard |
| SUPER_ADMIN | All admin permissions + system configuration |

**Role-Based Guards (NestJS):**

```typescript
// Example: Only riders can set online status
@UseGuards(RoleGuard(['RIDER']))
@Post('rider/availability/online')
async setOnline(@Req() req) {
  // User is guaranteed to be a RIDER
}

// Example: Customers can only view their own shipments
@UseGuards(AuthGuard, OwnerGuard)
@Get('shipments/:id')
async getShipment(@Param('id') shipmentId: string, @Req() req) {
  // User can only access if they own the shipment
}
```

### Session Management

- **Session lifetime:** 7 days (via refresh token expiry)
- **Device tracking:** Track multiple sessions per user (optional)
- **Logout from all devices:** Invalidate all sessions for a user

### Account Security

- **Password requirements:** Min 8 chars, uppercase, lowercase, number, special char
- **Password hashing:** bcrypt with salt rounds = 10
- **Account recovery:** Email/SMS verification
- **Account suspension:** Admin can suspend account (fraud, abuse)
- **Account deletion:** Soft delete (mark as deleted, retain data for audit)

---

## FOUNDATION 7: PAYMENTS

### Purpose

Securely process and track financial transactions.

### Payment Flow

```
1. Customer creates shipment
2. Frontend shows price quote
3. Customer selects payment method (mobile money, card, cash)
4. Customer confirms
5. Frontend calls POST /payments/initiate
6. Backend creates Payment record (status=PENDING)
7. Backend calls payment provider's API
8. Payment provider handles auth/charging
9. Payment provider sends callback to backend webhook
10. Backend updates Payment status (COMPLETED or FAILED)
11. Backend updates Shipment status (CONFIRMED or PAYMENT_FAILED)
12. Frontend shows result to user
13. If successful, Matching Engine starts finding rider
```

### Payment Methods

**Mobile Money (M-Pesa example):**

- Provider: Safaricom M-Pesa
- API: M-Pesa Daraja API (REST)
- Flow: Customer enters phone → WAZZAR initiates charge → M-Pesa prompts customer for PIN → Callback confirms
- Fees: ~1–3% (negotiated with Safaricom)
- Settlement: Daily to WAZZAR merchant account

**Card (Stripe example):**

- Provider: Stripe
- API: Stripe Payment Intents API
- Flow: Frontend collects card details → Stripe tokenizes → Backend creates payment intent → Stripe handles 3D Secure → Callback confirms
- Fees: ~2–3% + fixed per transaction
- Settlement: Daily or weekly to bank account

**Cash:**

- Method: Rider collects from customer at pickup
- Process: Shipment status = PAYMENT_PENDING_CASH
- Rider marks as paid via app
- WAZZAR receives notification
- Settlement: Daily rider payout includes cash collected

**Business Invoice:**

- Method: Monthly invoicing
- Process: Businesses get monthly statement
- Payment: Due within 30 days
- Settlement: Automatic via bank transfer when due

### Payment Reconciliation

**Daily reconciliation process:**

```
1. Backend fetches all payments from WAZZAR database
2. Backend fetches settlement report from payment providers
3. Backend matches:
   - Payment ID with provider's transaction ID
   - Amount matches
   - Status matches (COMPLETED → SETTLED)
4. Reconcile differences:
   - Missing from provider → Investigate
   - Extra from provider → Investigate
5. Report discrepancies to finance team
6. Settle unmatched transactions manually
```

### Refund Policy

- **Customer cancels before pickup:** Full refund (commission returned)
- **Customer cancels after pickup:** No refund (rider already involved)
- **Non-delivery:** Full refund + compensation
- **Rider cancels:** No charge to customer, commission waived

**Refund flow:**

```
1. User requests refund
2. Admin reviews reason
3. Admin approves refund
4. Backend creates Refund record
5. Backend calls payment provider's refund API
6. Provider processes refund to customer's account
7. Callback confirms refund status
8. Payment status = REFUNDED
9. Rider loses payout (or disputes if applicable)
```

### Security

- **PCI compliance:** Never store raw card numbers; use Stripe tokenization
- **Encryption:** All payment data encrypted in transit (HTTPS)
- **Rate limiting:** Max 10 payment attempts per user per hour (fraud prevention)
- **3D Secure:** Required for higher-value transactions (Stripe handles)
- **Webhook verification:** Verify webhook signature from provider (prevent spoofing)
- **Idempotency:** Payment requests idempotent (prevent double-charging if request retried)

---

## FOUNDATION 8: MAPS / GPS / LOCATION

### Purpose

Enable real-time location tracking, routing, ETA calculation, and geographic services.

### Technology: Google Maps API

**Why Google Maps:**
- Routing engine (A → B via roads)
- ETA calculation (with traffic data)
- Geocoding/reverse geocoding
- Maps SDK for web/mobile
- Elevation data, traffic layers
- Competitive pricing

**Alternative: Mapbox or OpenStreetMap (self-hosted)**

### Components

**Rider GPS Tracking:**

```
1. Rider app fetches GPS location every 30 seconds (configurable)
2. App sends location to backend: POST /rider/location (no /api/v1 prefix)
3. Backend stores in Redis: rider:{rider_id}:location
4. Customer app polls or WebSocket subscribes to tracking
5. Frontend requests GET /shipments/{id}/tracking (no /api/v1 prefix; note plural `shipments`)
6. Backend returns latest location + ETA from Redis
```

**ETA Calculation:**

```typescript
async calculateETA(
  riderLocation: Location,
  destination: Location
): Promise<number> {
  // Use Google Maps Distance Matrix API
  const result = await googleMaps.distanceMatrix({
    origins: [riderLocation],
    destinations: [destination],
    mode: 'DRIVING',
    traffic_model: 'BEST_GUESS'
  })
  const durationSeconds = result.rows[0].elements[0].duration.value
  return durationSeconds
}
```

**Geocoding (Address → Coordinates):**

```typescript
async geocode(address: string): Promise<Location> {
  const result = await googleMaps.geocode({ address })
  const location = result.results[0].geometry.location
  return { lat: location.lat, lng: location.lng }
}
```

**Reverse Geocoding (Coordinates → Address):**

```typescript
async reverseGeocode(lat: number, lng: number): Promise<string> {
  const result = await googleMaps.reverseGeocode({ latlng: { lat, lng } })
  return result.results[0].formatted_address
}
```

### Location Privacy

- **Storage:** Rider location kept only during active delivery (deleted after)
- **Retention:** Live location not stored long-term
- **Access:** Only customer + rider + admin can see location
- **Audit:** Location history access is logged

### Fallback (No GPS)

- **Rider updates manually:** Rider checks-in at waypoints
- **ETA estimation:** Based on address, not real-time
- **Tracking:** Checkpoint-based (picked up, in transit, delivered)

---

## FOUNDATION 9: NOTIFICATIONS

### Purpose

Keep users informed of important events (shipment status, payment, alerts).

### Notification Channels

**Push Notifications:**

- Technology: Firebase Cloud Messaging (FCM) or Apple Push Notification service (APNs)
- Devices: Mobile apps (iOS, Android)
- Use case: Shipment status updates, ride requests, urgent alerts
- Delivery: Usually within 5 seconds

**SMS:**

- Provider: Twilio (or African alternative: Africa's Talking, Yo! Telecom)
- Devices: Any phone (feature phones, smartphones)
- Use case: OTP, payment confirmation, delivery notification
- Delivery: Usually within 10 seconds

**Email:**

- Provider: SendGrid (or AWS SES)
- Devices: Email client
- Use case: Receipt, detailed report, important notices
- Delivery: Usually within 1 minute

**WhatsApp (Phase 2+):**

- Provider: Twilio WhatsApp Business API
- Devices: WhatsApp app
- Use case: Customer support, shipping updates, promotions
- Delivery: Usually within seconds

### Notification Events (Phase 1)

| Event | Trigger | Recipients | Channels |
|---|---|---|---|
| ACCOUNT_CREATED | User signs up | User | Email |
| OTP_SENT | Login/password reset | User | SMS |
| SHIPMENT_QUOTED | User creates shipment | User | Push, email |
| PAYMENT_COMPLETED | Payment successful | User | Push, SMS, email |
| PAYMENT_FAILED | Payment failed | User | Push, SMS |
| RIDER_ASSIGNED | Rider matched | Customer + Rider | Push, SMS |
| PICKUP_ARRIVED | Rider nearby for pickup | Customer | Push |
| PICKUP_COMPLETED | Parcel collected | Customer | Push, SMS |
| DELIVERY_ARRIVED | Rider nearby for delivery | Customer | Push |
| DELIVERY_COMPLETED | Parcel delivered | Customer + Rider | Push, SMS, email |
| RATING_REQUEST | After delivery | Both | Push |
| SHIPMENT_CANCELLED | User or system cancels | Affected parties | Push |
| DRIVER_CANCELLED | Rider cancels after assignment | Customer + Admin | Push, SMS |

### Notification Templates

**Example: Rider Assigned**

```
SMS: "Your parcel is with rider Ahmed (Toyota 123). Track here: [link]"
Push: {
  "title": "Your rider is on the way",
  "body": "Ahmed is 5 minutes away",
  "data": {
    "shipmentId": "uuid",
    "action": "OPEN_TRACKING"
  }
}
Email:
Subject: Your delivery is on its way
Body: Hi John, rider Ahmed has accepted your delivery. 
Track your parcel: [link]
```

### Notification Preferences

Users can configure:

- Which events trigger notifications
- Which channels (push, SMS, email)
- Do not disturb hours (e.g., no notifications 22:00–08:00)
- Language (English, Swahili, etc.)

### Implementation

**Event-driven architecture:**

```
┌─────────────────────────────┐
│ Shipment Status Change      │
│ (Backend updates status)    │
└──────────────┬──────────────┘
               ↓
        ┌──────────────┐
        │ Event Bus    │
        │ (RabbitMQ,   │
        │  Kafka, etc) │
        └──────────────┘
               ↓
      ┌────────┴────────┐
      ↓                 ↓
  ┌────────┐     ┌──────────────┐
  │ Push   │     │ SMS / Email  │
  │ Notif. │     │ Service      │
  │ Service│     │              │
  └────────┘     └──────────────┘
```

**Example code:**

```typescript
// When shipment status changes
async updateShipmentStatus(shipmentId, newStatus) {
  await db.shipments.update(shipmentId, { status: newStatus })
  
  // Emit event
  this.eventBus.emit('shipment:status-changed', {
    shipmentId,
    status: newStatus,
    timestamp: new Date()
  })
}

// Notification service listens for event
@EventListener('shipment:status-changed')
async handleStatusChange(event) {
  const { shipmentId, status } = event
  const shipment = await db.shipments.findById(shipmentId)
  const customer = await db.users.findById(shipment.customerId)
  
  // Send appropriate notifications
  if (status === 'RIDER_ASSIGNED') {
    await this.pushNotificationService.send(customer.id, {
      title: 'Rider assigned',
      body: `Your rider is on the way`
    })
    await this.smsService.send(customer.phone, 'Your delivery rider...')
  }
}
```

---

## FOUNDATION 10: ADMIN / OPERATIONS CONTROL CENTER

### Purpose

WAZZAR internal dashboard to operate the platform.

### Pages/Sections

**Dashboard (Overview):**

- Key metrics (active users, shipments today, revenue, satisfaction)
- Alerts (failed payments, low rider supply, disputes)
- Recent activity (new shipments, refunds, system events)

**Users Management:**

- Search/filter users by role, status, location
- View user profile (phone, email, rating, history)
- Suspend/verify/activate users
- Manual Rider verification approval
- View user disputes

**Shipments Management:**

- List all shipments (filter by status, customer, rider, date)
- Shipment details (locations, status history, customer, rider, payment)
- Manual status changes (if needed)
- Initiate refunds
- View tracking history

**Payments:**

- List all payments (filter by status, method, date range)
- Payment reconciliation report
- Manual payment approval/rejection
- Issue refunds
- Chargeback handling

**Disputes & Escalations:**

- List open disputes (filter by type, status)
- Dispute details (description, evidence, parties)
- Manual resolution (approve/deny, issue refund, suspend user)
- Communication history

**Riders:**

- List all riders (filter by status, location, rating)
- Rider profile (vehicle, documents, earnings, history)
- Document verification (approve documents)
- Suspend/reactivate riders
- Earnings/payout monitoring

**Financial Reports:**

- Daily/weekly/monthly revenue
- Commission breakdown
- Rider earnings
- Customer acquisition cost
- Churn analysis

**System Configuration:**

- Pricing rules (commission %, minimum delivery price, surge multiplier)
- Feature flags (enable/disable features by region)
- Notification templates
- Email/SMS provider settings
- Supported locations and their status

### Permissions

| Role | Permissions |
|---|---|
| ADMIN | Can view/modify data, approve verification, resolve disputes |
| SUPER_ADMIN | All admin + system configuration, user management, financial |
| FRAUD_SPECIALIST | View suspicious patterns, approve/block accounts |
| FINANCE | View payments, reports, issue refunds, reconciliation |
| SUPPORT | View user info, shipments, respond to inquiries |

### Audit Logging

Every admin action is logged:

```
{
  "adminId": "uuid",
  "action": "SUSPEND_USER",
  "targetId": "uuid", // user ID
  "timestamp": "2026-08-18T15:30:45Z",
  "reason": "Suspected fraud",
  "changes": {
    "userStatus": { "from": "ACTIVE", "to": "SUSPENDED" }
  }
}
```

---

## FOUNDATION 11: MULTIPLE CLIENT APPLICATIONS

### Client Applications

**Web (React):**
- Customer app (browser-based)
- Admin app (internal dashboard)
- Business app (API management, analytics)

**Mobile (React Native or native):**
- Customer app (iOS + Android)
- Rider app (iOS + Android)

**Backend (Shared):**
- Single REST API serves all clients
- Clients don't duplicate logic
- Shared authentication (JWT tokens)

### Client-Server Flow

```
All Clients (Web, iOS, Android, Admin)
        ↓ (HTTPS)
    REST API
        ↓
    Business Logic
        ↓
    Database
```

### Platform-Specific Considerations

| Platform | Unique needs | Implementation |
|---|---|---|
| iOS | App Store submission, APNs, push notifications | Native Swift code + CocoaPods |
| Android | Google Play Store, FCM, permissions | Native Kotlin code + Gradle |
| Web | Browser compatibility, responsive design | React + Tailwind |
| Admin | High information density, keyboard navigation | React + custom admin UI |

---

## FOUNDATION 12: THIRD-PARTY INTEGRATIONS

### Integration Architecture — The Wire Pattern

Every optional external integration — payments, maps, SMS, email, push, analytics, error tracking, Video KYC, future carrier/bus-tracking APIs — is accessed through a small interface ("the wire") owned by WAZZAR, never called directly from business logic. Each wire ships with a **no-op or mock default implementation from day one**, whether or not a real provider is connected yet. Plugging in a real provider means writing one class that implements the interface and flipping a config value; unplugging it means reverting to the no-op implementation. Nothing in the calling code changes either way — this is what lets a service go from "not integrated" to "integrated" (or back) without touching shipment, pricing, or dispatch logic.

This is already the pattern the Payments module uses in practice — `PaymentProvider` is the wire, `MPesaProvider`/`StripeProvider` are today's (mocked) implementations:

```typescript
// PaymentProvider interface — the "wire"
interface PaymentProvider {
  charge(amount: number, customer: string): Promise<ChargeResult>
  refund(transactionId: string): Promise<RefundResult>
}

// M-Pesa implementation (mocked as of Phase 1 — no live SDK call yet)
class MPesaProvider implements PaymentProvider {
  async charge(amount: number, phone: string): Promise<ChargeResult> {
    // M-Pesa-specific API calls
  }
}

// Stripe implementation (mocked as of Phase 1)
class StripeProvider implements PaymentProvider {
  async charge(amount: number, cardToken: string): Promise<ChargeResult> {
    // Stripe-specific API calls
  }
}

// Usage: swap providers by configuration, never by editing call sites
const provider = config.paymentProvider === 'mpesa'
  ? new MPesaProvider()
  : new StripeProvider()
```

**The same shape applies to every not-yet-integrated service.** A `NotificationProvider` wire, for example, should exist in Phase 1 even though no SMS/email/push vendor is connected yet — its only implementation for now is a no-op that logs instead of sending:

```typescript
// NotificationProvider interface — the "wire"
interface NotificationProvider {
  send(userId: string, channel: 'SMS' | 'EMAIL' | 'PUSH', template: string, data: Record<string, unknown>): Promise<void>
}

// Default Phase 1 implementation — logs instead of sending, keeps the
// system fully functional with zero external dependencies
class NoOpNotificationProvider implements NotificationProvider {
  async send(userId: string, channel: string, template: string): Promise<void> {
    console.log(`[notify:${channel}] would send "${template}" to ${userId}`);
  }
}

// Later: TwilioSmsProvider, SendGridEmailProvider, FcmPushProvider each
// implement the same interface — plugged in via config, unplugged the
// same way, no changes anywhere else in the codebase.
```

### Integrated Services

> **Updated (2026-08-22, post-merge):** Payments and Maps/geocoding both changed with the merged backend build.

| Service | Purpose | Provider | Wire defined? | Status |
|---|---|---|---|---|
| Payments | Card/mobile money processing | M-Pesa, Stripe | Yes — `PaymentProvider` | Stripe SDK and an M-Pesa client are now real dependencies (`package.json`), with real HMAC webhook signature verification (`webhook-signature.ts`) — but both providers still run their mock/fake-data path by default and only switch to live calls once real credentials (`STRIPE_SECRET_KEY`, the five `MPESA_*` vars) are set; see `docs/delivery-notes/PAYMENTS_GOING_LIVE.md`. A working example of the Wire Pattern already in production use, not just design intent. |
| Maps / Geocoding | Address search, geocoding | OpenStreetMap Nominatim (free, no API key) | Yes — isolated in `GeocodingService`, same adapter principle as LATRA | **Live and integrated** as of the 2026-08-22 merge (`GET /geocode/search`) — not Google Maps as originally planned; ETA is still a straight-line (haversine) estimate, routing/turn-by-turn is not built |
| SMS | OTP, notifications | Twilio, Africa's Talking | Not yet | Not integrated (no OTP flow exists) |
| Email | Receipts, alerts | SendGrid | Not yet | Not integrated |
| Push Notifications | Mobile app notifications | Firebase Cloud Messaging | Not yet | Not integrated |
| File Storage | Rider docs, proof-of-delivery photos | Local disk (`UploadsService`), served at `/uploads/{file}` | Yes — isolated behind `UploadsService`/`UploadsController` | **Live** as of the 2026-08-22 merge; S3-compatible swap is a planned follow-up, see `MASTER_GAPS_AND_ROADMAP.md` |
| Bus Tracking | Intercity tracking | Latra | Not yet | Phase 2 — planned alongside the intercity/trunk build |
| Analytics | Product metrics | Mixpanel, Amplitude | Not yet | Not integrated |
| Error Tracking | Production errors | Sentry | Not yet | Not integrated |

*(Checked against `backend/backend/package.json` on 2026-08-22 post-merge — `stripe`, `helmet`, `@nestjs/throttler`, `multer` are now real dependencies; no SMS, email, push, analytics, or error-tracking dependencies exist yet. Every still-unintegrated row above should get its own no-op wire implementation — like `NoOpNotificationProvider` earlier in this document — as soon as the module that needs it is built, even before a real provider is chosen, so integrating or dropping a vendor later is a config change, not a rewrite — exactly what Payments and Geocoding already demonstrate.)*
| Video KYC | Identity verification | Onfido | Phase 2+ |

### Failure Handling

**Graceful degradation:**

```typescript
// If Maps API is down, show text-based tracking instead
async getTracking(shipmentId) {
  try {
    const location = await mapsService.getLocation(riderLocation)
    return { map: location }
  } catch (e) {
    // Fallback to text-based
    return { text: "Rider is en route. Last known location: XYZ" }
  }
}
```

### Rate Limiting

- **Map API:** 100 req/second (Google quota)
- **SMS:** Batch SMS to reduce costs (group multiple notifications into one)
- **Email:** 10,000 emails/day (SendGrid free tier)
- **Payment provider:** Per-provider limits (coordinate with provider)

---

## FOUNDATION 13: FILE / OBJECT STORAGE

### Purpose

Store non-database files (images, documents, receipts).

### Technology: AWS S3 (or Wasabi, MinIO alternative)

### Storage Structure

```
s3://wazzar-uploads/
├── users/
│   └── {user_id}/
│       ├── profile-photo.jpg
│       └── documents/
│           ├── national-id.jpg
│           └── vehicle-registration.jpg
├── shipments/
│   └── {shipment_id}/
│       ├── proof-of-delivery.jpg
│       └── photos/
│           ├── pickup-1.jpg
│           └── delivery-1.jpg
└── receipts/
    └── {payment_id}/
        └── receipt.pdf
```

### Upload Flow

**Client-side upload (secure):**

```
1. User selects file
2. Frontend validates (size, type, dimensions)
3. Frontend generates S3 pre-signed POST URL from backend
4. Frontend uploads directly to S3 using pre-signed URL
5. S3 confirms upload
6. Frontend notifies backend of successful upload
7. Backend stores S3 URL in database
8. Frontend displays image
```

**Why pre-signed URLs:**
- Avoids uploading through backend (saves bandwidth, faster)
- Limits upload scope (only specific S3 bucket/prefix)
- Limits upload time (URL expires in 15 minutes)

### Security

- **File size limits:** Profile photo < 5MB, POD < 10MB
- **File type validation:** JPEG, PNG only (no executable files)
- **Malware scanning:** AWS Macie or manual scanning (Phase 2+)
- **Access control:** Private objects (not publicly readable)
- **Signed URLs:** Generate signed URLs for download (expire after 1 hour)
- **Encryption:** S3 default encryption (AES-256)

### Cost Optimization

- **Image compression:** Resize large photos (1920px max)
- **CDN:** Serve images through CloudFront (saves S3 egress costs)
- **Cleanup:** Delete old/deleted user photos after 90 days

---

## FOUNDATION 14: SECURITY

### Purpose

Protect WAZZAR from unauthorized access, data theft, fraud, and abuse.

> **Updated (2026-08-22, post-merge):** This section was written as aspirational design intent. A few items below are now actually real, per the merged backend: rate limiting on sensitive endpoints (global 60 req/min via `@nestjs/throttler`, plus a stricter 10 req/min on `/auth/register`, `/auth/login`, `/auth/refresh` — see `app.module.ts` and `auth.controller.ts`), HTTPS-adjacent hardening via `helmet()` in `main.ts`, CORS restricted to an explicit origin list in production (`CORS_ORIGIN` env var, enforced by `assertProductionSafeConfig()` refusing to boot without it — see `security-checks.ts`), and real HMAC-SHA256 webhook signature verification for both payment webhooks (`webhook-signature.ts`). Everything else below (device fingerprinting, chargeback detection, GDPR/SOC2 compliance, intrusion detection, etc.) is still design intent, not built.

### Layers

**Network Security:**

- HTTPS/TLS for all traffic
- TLS 1.2+ (disable old versions)
- Valid certificate from trusted CA (Let's Encrypt free or paid)

**Application Security:**

- Authentication via JWT tokens
- Authorization via role-based guards
- Input validation (all forms, APIs)
- Output encoding (prevent XSS)
- SQL injection prevention (parameterized queries via ORM)
- CSRF tokens (if using session cookies)
- Rate limiting on sensitive endpoints

**Data Security:**

- Passwords hashed with bcrypt
- Sensitive data encrypted at rest (S3 encryption, DB encryption)
- PII (phone, email) not logged to plain-text logs
- Payment data never stored in database (tokenized)
- Location history deleted after retention period

**Fraud Prevention:**

- Device fingerprinting (detect account abuse)
- Geolocation verification (pickup/delivery must match)
- Chargeback detection (flag reversed payments)
- Duplicate account detection (same phone, email, payment method)
- Behavioral analysis (unusual patterns → manual review)

**Infrastructure Security:**

- Database access restricted (only app servers)
- Secrets not in code (environment variables, Secrets Manager)
- SSH key-based access (no passwords)
- Regular security patching (OS, dependencies)
- Firewall rules (only necessary ports open)

**Monitoring & Response:**

- Security event logging (auth failures, permission denials, payment errors)
- Intrusion detection (Fail2ban, AWS GuardDuty)
- Alerting on suspicious patterns
- Incident response plan (breach, outage, fraud)

### Compliance

- **GDPR (if EU users):** Data privacy, right to deletion
- **Tanzania data protection:** Align with local regulations
- **PCI DSS:** If storing payment data (we don't—use tokenization)
- **SOC 2:** Best practices for security, availability, confidentiality

---

## FOUNDATION 15: TESTING

### Strategy

**Unit Tests:**

- Test individual functions/services
- Mock external dependencies
- Target: >80% code coverage

**Integration Tests:**

- Test services working together
- Use test database
- Test database migrations

**API Tests:**

- Test endpoints (request → response)
- Test authentication/authorization
- Test error cases

**Database Tests:**

- Test data integrity
- Test constraints, indexes
- Test migrations

**End-to-End Tests:**

- Test complete user journeys
- Use staging environment
- Selenium/Cypress for web UI tests

**Mobile Tests:**

- Unit tests for business logic
- UI tests (Detox for React Native)
- Manual testing on real devices

**Security Tests:**

- Vulnerability scanning (OWASP ZAP, Burp Suite)
- Password security test
- Session management test
- API security test

**Load Tests:**

- Simulate 1000+ concurrent users
- Measure response times, identify bottlenecks
- Test under 2x, 5x, 10x normal load

### Test Coverage Targets

- Backend: 80%+ coverage (unit + integration)
- Frontend: 60%+ coverage (components, services)
- Critical paths: 95%+ coverage (payment, auth, shipment)

---

## FOUNDATION 16: VERSION CONTROL, CI/CD, MONITORING, BACKUPS

### Version Control (Git)

**Repository structure:**

```
wazzar/
├── apps/web/
├── apps/admin/
├── apps/android/
├── apps/ios/
├── backend/
├── database/
├── infrastructure/
└── docs/
```

**Branching strategy:**

- `main` — production-ready code
- `staging` — pre-production testing
- `feature/*` — individual features
- `bugfix/*` — bug fixes
- `release/*` — release branches

**Commit conventions:**

```
feat: Add rider location tracking
fix: Resolve payment reconciliation bug
docs: Update API documentation
test: Add tests for matching algorithm
refactor: Simplify pricing calculation
```

### CI/CD Pipeline

**On push to feature branch:**

```
1. Lint (ESLint, Prettier)
2. Type check (TypeScript)
3. Unit tests
4. Security scan (Snyk)
5. Build artifact
6. Deploy to dev environment (auto)
```

**On PR to staging:**

```
1. All above +
2. Integration tests
3. API tests
4. Database migration test
5. Deploy to staging (auto)
6. Manual QA testing
7. Performance testing
8. Security review
```

**On merge to main:**

```
1. All above +
2. Manual approval required
3. Deploy to production (blue-green deployment)
4. Smoke tests
5. Monitoring alerts
6. Rollback plan ready
```

### Monitoring & Alerting

**Key Metrics:**

- API response time (p50, p95, p99)
- Error rate (4xx, 5xx)
- Payment success rate
- Database query time
- Redis hit rate
- Server CPU, memory, disk
- Active users, shipments
- Queue length (async jobs)

**Alerting Rules:**

- API p99 > 500ms → Alert
- Error rate > 1% → Alert
- Payment success < 95% → Critical alert
- Database down → Critical alert
- Low rider supply (active < 10) → Alert
- Fraud detected (10+ duplicate accounts) → Alert

**Dashboards:**

- Overview (health, key metrics)
- Operations (shipments, payments, users)
- Engineering (API errors, performance, builds)
- Finance (revenue, payouts, reconciliation)

### Backups & Disaster Recovery

**Database Backups:**

- **Frequency:** Every 6 hours
- **Retention:** 30 days of backups
- **Testing:** Restore one backup/week to test environment
- **Geo-redundancy:** Backup replicated to different region

**File Storage Backups:**

- **S3 versioning:** Enabled (recover deleted files)
- **Cross-region replication:** Automatic to backup region
- **Retention:** 90 days of versions

**Disaster Recovery Plan:**

| Scenario | RTO | RPO | Action |
|---|---|---|---|
| Database crash | 1 hour | 6 hours | Restore from backup |
| Data center outage | 4 hours | 1 hour | Failover to backup region |
| S3 data loss | 30 minutes | 0 | Restore from versioning |
| DDoS attack | 15 minutes | 0 | Activate CloudFront, rate limiting |

---

## INTEGRATION SUMMARY

All 16 Foundations work together:

```
┌─────────────────────────────────────────────────────────┐
│                   WAZZAR Platform                        │
├─────────────────────────────────────────────────────────┤
│ 1. Frontend (Web)       → 4. API → 2. Backend          │
│ 1. Mobile (iOS/Android) → 4. API → 2. Backend          │
│ 10. Admin Console        → 4. API → 2. Backend          │
│                                                          │
│ 2. Backend → 3. Database (PostgreSQL + Redis)          │
│ 2. Backend → 5. Infrastructure (AWS/GCP)               │
│ 2. Backend → 6. Auth (JWT, Role-based)                 │
│ 2. Backend → 7. Payments (M-Pesa, Stripe)              │
│ 2. Backend → 8. Maps (Google Maps)                     │
│ 2. Backend → 9. Notifications (Push, SMS, Email)       │
│ 2. Backend → 12. Integrations (External services)      │
│ 2. Backend → 13. File Storage (S3)                     │
│                                                          │
│ 14. Security (across all layers)                       │
│ 15. Testing (unit, integration, E2E)                   │
│ 16. CI/CD & Monitoring (GitLab/GitHub, Sentry)         │
└─────────────────────────────────────────────────────────┘
```

---

## NEXT STEPS

1. **Review this architecture** with engineering team
2. **Create detailed ADRs** (Architecture Decision Records) for key choices
3. **Build Build Cookbook** (developer implementation guide)
4. **Create traceability matrix** (Blueprint → Architecture → Code)
5. **Set up infrastructure** (AWS, databases, CI/CD)
6. **Begin Phase 1 implementation** (see Development Roadmap)

