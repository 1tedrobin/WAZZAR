/* ========================================================================
   WAZZAR BUSINESS APP — real backend client.

   Talks to the NestJS API in wazzar-backend/backend. Base URL comes from
   VITE_API_URL (see .env.example) and defaults to localhost:3000 for local
   dev against `npm run dev` in the backend.

   This is the only file in the app that knows an HTTP API exists — every
   screen component gets plain JS objects/promises from here, same shape
   whether the data came from a real fetch or (previously) mockData.js.

   Mirrors customer-app/src/api.js's shape (request wrapper, session
   storage, error handling) so the two clients stay easy to compare —
   see that file's header comment for the fuller rationale.
   ======================================================================== */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const TOKEN_KEY = "wazzar_business_access_token";
const REFRESH_KEY = "wazzar_business_refresh_token";
const USER_KEY = "wazzar_business_user";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setSession({ accessToken, refreshToken, user }) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.message || body.error)) || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

// Core fetch wrapper. `auth: true` (default) attaches the stored bearer
// token — pass `auth: false` for the handful of public endpoints
// (pricing/calculate, auth/register, auth/login).
async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                 */
/* ------------------------------------------------------------------ */

// Unlike the customer app (phone-only, OTP-shaped UX), the business
// dashboard is a real login form — the merchant sets their own password
// at registration and types it every time. No device-derived password
// trick needed here.

function normalizePhone(rawPhone) {
  // Backend expects E.164 (+255XXXXXXXXX). The UI collects a local
  // 9-digit number (e.g. "712345678"); prefix the Tanzania country code
  // if it isn't already there.
  const digits = rawPhone.replace(/\D/g, "");
  if (rawPhone.startsWith("+")) return rawPhone;
  if (digits.startsWith("255")) return `+${digits}`;
  return `+255${digits.replace(/^0/, "")}`;
}

export async function login(rawPhone, password) {
  const result = await request("/auth/login", {
    method: "POST",
    auth: false,
    body: { phone: normalizePhone(rawPhone), password },
  });
  setSession(result);
  return result;
}

// role is always BUSINESS — this app only ever signs up merchant
// accounts (SELF_SIGNUP_ROLES on the backend also allows CUSTOMER/RIDER,
// but those belong to the other two apps).
export async function register({ phone, password, fullName, email }) {
  const result = await request("/auth/register", {
    method: "POST",
    auth: false,
    body: {
      phone: normalizePhone(phone),
      password,
      fullName,
      email: email || undefined,
      role: "BUSINESS",
    },
  });
  setSession(result);
  return result;
}

export function logout() {
  clearSession();
}

export function currentUser() {
  return getStoredUser();
}

export function isAuthenticated() {
  return !!getToken();
}

// Confirms the stored token still works and refreshes the cached user
// (e.g. after a token was issued on another device/session). Called once
// on app load so a stale/expired token falls back to the login screen
// instead of showing a dashboard that will 401 on first fetch.
export async function fetchCurrentUser() {
  const user = await request("/auth/me");
  const existing = getStoredUser() || {};
  localStorage.setItem(USER_KEY, JSON.stringify({ ...existing, ...user }));
  return user;
}

/* ------------------------------------------------------------------ */
/* Business Profile (settings — name, category, pickup location)       */
/* ------------------------------------------------------------------ */

// Get the current business's profile (or create a minimal one if none exists).
export function getBusinessProfile() {
  return request("/business/profile");
}

// Update the current business's profile fields.
export function updateBusinessProfile({
  businessName,
  category,
  pickupLatitude,
  pickupLongitude,
  pickupAddress,
}) {
  return request("/business/profile", {
    method: "PATCH",
    body: {
      businessName,
      category,
      pickupLatitude,
      pickupLongitude,
      pickupAddress,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Pricing                                                              */
/* ------------------------------------------------------------------ */

// Public endpoint — no auth required, matches PricingController. Used
// for the live estimate in the New Delivery modal; the shipment's real
// price is computed again (authoritatively) by the backend at creation.
export function calculatePrice({ distanceKm, weightKg }) {
  return request("/pricing/calculate", {
    method: "POST",
    auth: false,
    body: { distanceKm, weightKg },
  });
}

/* ------------------------------------------------------------------ */
/* Shipments (= this business's "orders")                              */
/* ------------------------------------------------------------------ */

export function createShipment({ pickupLocation, dropoffLocation, packageWeightKg, packageDescription }) {
  return request("/shipments", {
    method: "POST",
    body: { pickupLocation, dropoffLocation, packageWeightKg, packageDescription },
  });
}

// GET /shipments is always scoped server-side to the calling user (see
// ListShipmentsQueryDto) — a BUSINESS account gets back exactly the
// shipments it created, same as a CUSTOMER account would. limit maxes
// out at 100 on the backend.
export function listShipments({ status, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set("status", status);
  return request(`/shipments?${params.toString()}`);
}

export function getShipment(id) {
  return request(`/shipments/${id}`);
}

export function getShipmentHistory(id) {
  return request(`/shipments/${id}/history`);
}

/* ------------------------------------------------------------------ */
/* Customers (this business's own saved address book)                  */
/*                                                                      */
/* Previously local-only mock data (see App.jsx's header comment and   */
/* WIRING_NOTES.md) — now backed by a real `business_customers` table  */
/* (see backend's business-customers module). This is a private        */
/* address book scoped to the calling business, not a link to real     */
/* platform CUSTOMER accounts — recipients here don't need a WAZZAR    */
/* account of their own.                                                */
/* ------------------------------------------------------------------ */

export function listCustomers() {
  return request("/business/customers");
}

export function createCustomer({ name, phone, address, notes }) {
  return request("/business/customers", {
    method: "POST",
    body: { name, phone, address, notes },
  });
}

export function updateCustomer(id, { name, phone, address, notes }) {
  return request(`/business/customers/${id}`, {
    method: "PATCH",
    body: { name, phone, address, notes },
  });
}

export function deleteCustomer(id) {
  return request(`/business/customers/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Scheduled deliveries (recurring shipments this business defines —   */
/* a background job on the backend turns due ones into real shipments  */
/* automatically; nothing in this app triggers a run itself)           */
/* ------------------------------------------------------------------ */

export function listScheduledDeliveries() {
  return request("/business/scheduled-deliveries");
}

export function createScheduledDelivery({
  name,
  pickupLocation,
  dropoffLocation,
  packageWeightKg,
  packageDescription,
  daysOfWeek,
  timeOfDay,
}) {
  return request("/business/scheduled-deliveries", {
    method: "POST",
    body: { name, pickupLocation, dropoffLocation, packageWeightKg, packageDescription, daysOfWeek, timeOfDay },
  });
}

export function updateScheduledDelivery(id, patch) {
  return request(`/business/scheduled-deliveries/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export function deleteScheduledDelivery(id) {
  return request(`/business/scheduled-deliveries/${id}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Staff (this business's own team roster — NOT real login accounts;   */
/* see backend's business-staff module for why)                        */
/* ------------------------------------------------------------------ */

export function listStaff() {
  return request("/business/staff");
}

export function inviteStaff({ name, email, role }) {
  return request("/business/staff", {
    method: "POST",
    body: { name, email, role },
  });
}

export function updateStaff(id, { name, email, role, status }) {
  return request(`/business/staff/${id}`, {
    method: "PATCH",
    body: { name, email, role, status },
  });
}

export function removeStaff(id) {
  return request(`/business/staff/${id}`, { method: "DELETE" });
}

// Moves a paid, CONFIRMED shipment into the dispatch queue. A real
// dispatcher/admin app (or an automated rule) would normally trigger
// this; this app calls it itself right after payment confirms since
// there's no dispatcher UI wired up yet in this pass (same shim the
// customer app uses — see its api.js).
export function requestDispatch(id) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status: "ASSIGNMENT_PENDING", reason: "Business app: payment confirmed" },
  });
}

export function cancelShipment(id, reason) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status: "CANCELLED", reason: reason || "Business app: cancelled by merchant" },
  });
}

/* ------------------------------------------------------------------ */
/* Payments                                                             */
/* ------------------------------------------------------------------ */

const PAYMENT_METHOD_MAP = { mpesa: "MPESA", cash: "CASH" };

export function initiatePayment({ shipmentId, uiMethod, phone }) {
  const method = PAYMENT_METHOD_MAP[uiMethod] || "CASH";
  const body = { shipmentId, method };
  if (method === "MPESA") body.phoneNumber = normalizePhone(phone).replace("+", "");
  return request("/payments/initiate", { method: "POST", body });
}

// GET /payments/history — always scoped server-side to the calling
// account (see PaymentsService.getHistory), so for a business account
// this is exactly that business's own real per-delivery payment
// history: one row per Payment, each tied to a real Shipment they
// created. Backs the Billing page — see App.jsx's BillingPage.
export function listPaymentHistory({ limit } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return request(`/payments/history${qs ? `?${qs}` : ""}`);
}

// MPESA only completes when Safaricom calls back POST
// /payments/webhooks/mpesa — in production that's the provider hitting
// the backend directly, never the browser. The provider is mocked in
// this backend pass (fake transaction id, no real Daraja integration),
// so there's no real webhook coming. To keep the flow moving without a
// payment gateway, the app fires the same webhook call itself right
// after initiating — a demo-only shim, not something a production
// client should ever do (see customer-app/src/api.js for the same
// pattern and the same caveat).
//
// The body sent here is shaped like a REAL Daraja STK Push callback
// (see backend's MpesaWebhookDto/mpesa-callback.util.ts) — not the old
// flattened `{transactionId, success, amount}` shape this shim used to
// send, which the backend no longer accepts now that the real Daraja
// shape is enforced. CallbackMetadata.Item mirrors exactly what
// Safaricom's own docs show for a successful callback.
export async function simulateProviderConfirmation(payment) {
  if (payment.method === "MPESA") {
    return request("/payments/webhooks/mpesa", {
      method: "POST",
      auth: false,
      body: {
        Body: {
          stkCallback: {
            MerchantRequestID: `demo-${payment.id}`,
            CheckoutRequestID: payment.externalId,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: Number(payment.amount) },
                { Name: "MpesaReceiptNumber", Value: `DEMO${Date.now()}` },
                { Name: "PhoneNumber", Value: 255700000000 },
              ],
            },
          },
        },
      },
    });
  }
  // CASH has no webhook — it stays PENDING_CASH_COLLECTION until a rider
  // or admin calls POST /payments/:id/collect-cash for real.
  return null;
}

export { ApiError, normalizePhone };
