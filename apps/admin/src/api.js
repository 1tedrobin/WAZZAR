/* ========================================================================
   WAZZAR ADMIN CONSOLE — real backend client.

   Talks to the NestJS API in wazzar-backend/backend. Base URL comes from
   VITE_API_URL (see .env.example) and defaults to localhost:3000 for local
   dev against `npm run dev` in the backend.

   IMPORTANT — this file only calls endpoints that actually exist in the
   backend today. The backend now has support/ticketing and a read-only
   admin businesses view (see those sections below), but still has no
   customers module, so there are no functions here for that — see
   README_ADMIN_WIRING.md for the full list of what's wired vs. what still
   needs a backend module before it can be wired.

   Every function here throws ApiError on a non-2xx response. Callers are
   expected to catch it and show `err.message` — the backend's messages
   are already written to be admin-readable (e.g. "Rider must be ACTIVE and
   online to be dispatched a shipment").
   ======================================================================== */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const TOKEN_KEY = "wazzar_admin_access_token";
const REFRESH_KEY = "wazzar_admin_refresh_token";
const USER_KEY = "wazzar_admin_user";

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

export class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.message || body.error)) || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

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

// The backend has no admin self-signup — ADMIN/SUPER_ADMIN/DISPATCHER are
// granted out-of-band (an existing admin runs SQL against user_roles;
// see wazzar-backend/backend/README.md "Known simplifications"). This
// login call assumes that account already exists with one of those roles.
export async function login(phone, password) {
  const result = await request("/auth/login", {
    method: "POST",
    auth: false,
    body: { phone, password },
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

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

// DISPATCHER can reach dispatch/* routes only (per DispatchController's
// @Roles) — everything else in this app (riders/verify, payments,
// pricing) needs ADMIN or SUPER_ADMIN. Used to decide what to show/hide,
// not as a real authorization boundary — the backend enforces that.
export function roleSummary() {
  const user = getStoredUser();
  if (!user) return { roles: [], isAdmin: false, isDispatcher: false };
  const roles = user.roles || [];
  return {
    roles,
    isAdmin: roles.some((r) => ADMIN_ROLES.includes(r)),
    isDispatcher: roles.includes("DISPATCHER"),
  };
}

/* ------------------------------------------------------------------ */
/* Dispatch — GET /dispatch/queue, candidates, assign, auto-assign      */
/* Roles: ADMIN, SUPER_ADMIN, DISPATCHER                                */
/* ------------------------------------------------------------------ */

// { pendingShipments: Shipment[], onlineRiders: Rider[] }
export function getDispatchQueue() {
  return request("/dispatch/queue");
}

// Ranked candidate riders for one ASSIGNMENT_PENDING shipment.
export function getDispatchCandidates(shipmentId) {
  return request(`/dispatch/shipments/${shipmentId}/candidates`);
}

export function assignShipment(shipmentId, riderId, reason) {
  return request(`/dispatch/shipments/${shipmentId}/assign`, {
    method: "POST",
    body: { riderId, reason },
  });
}

export function autoAssignShipment(shipmentId, reason) {
  return request(`/dispatch/shipments/${shipmentId}/auto-assign`, {
    method: "POST",
    body: { reason },
  });
}

/* ------------------------------------------------------------------ */
/* Shipments — lookup by ID only. GET /shipments (list) is hard-scoped  */
/* to the caller's own customerId in the backend, so there is no        */
/* "list all shipments" endpoint an admin can call.                     */
/* ------------------------------------------------------------------ */

export function getShipment(id) {
  return request(`/shipments/${id}`);
}

export function getShipmentHistory(id) {
  return request(`/shipments/${id}/history`);
}

export function getProofOfDelivery(id) {
  return request(`/shipments/${id}/proof-of-delivery`);
}

// status must be one of ShipmentStatus. ASSIGNED and DELIVERED are
// rejected by the backend with a specific error pointing at the right
// endpoint (assign / rider's deliver flow) — surface that message as-is.
export function updateShipmentStatus(id, status, reason) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status, reason },
  });
}

/* ------------------------------------------------------------------ */
/* Riders — lookup-by-ID, whole-application verify, and per-document    */
/* approve/reject. Still no GET /riders (list) endpoint, so an admin    */
/* needs the rider's ID from elsewhere (dispatch queue's onlineRiders,  */
/* support contact, onboarding record) to look one up.                  */
/* ------------------------------------------------------------------ */

export function getRider(id) {
  return request(`/riders/${id}`);
}

export function verifyRider(id) {
  return request(`/riders/${id}/verify`, { method: "PATCH" });
}

// documentType is one of "ID" | "LICENSE" | "VEHICLE_REGISTRATION" |
// "INSURANCE". reason is required by the backend when status is
// "REJECTED"; ignored otherwise.
export function reviewRiderDocument(id, documentType, status, reason) {
  return request(`/riders/${id}/documents/${documentType}`, {
    method: "PATCH",
    body: { status, reason },
  });
}

/* ------------------------------------------------------------------ */
/* Payments — status/refund/collect-cash by ID, plus daily reconcile.   */
/* No GET /payments (list) endpoint exists in the backend.              */
/* ------------------------------------------------------------------ */

export function getPaymentStatus(id) {
  return request(`/payments/${id}/status`);
}

export function refundPayment(id, reason, amount) {
  return request(`/payments/${id}/refund`, {
    method: "POST",
    body: amount !== undefined ? { reason, amount } : { reason },
  });
}

export function collectCash(id) {
  return request(`/payments/${id}/collect-cash`, { method: "POST" });
}

// date must be an ISO date, e.g. "2026-08-19".
export function reconcile(date) {
  return request(`/payments/reconcile/${date}`);
}

/* ------------------------------------------------------------------ */
/* Pricing — the one full-CRUD admin surface the backend actually has.  */
/* Not in the original wiring plan, but real and worth exposing.        */
/* ------------------------------------------------------------------ */

export function getActivePricingConfig() {
  return request("/pricing/active", { auth: false });
}

export function getAllPricingConfigs() {
  return request("/pricing/configs");
}

export function createPricingConfig(dto) {
  return request("/pricing/configs", { method: "POST", body: dto });
}

export function updatePricingConfig(id, dto) {
  return request(`/pricing/configs/${id}`, { method: "PUT", body: dto });
}

/* ------------------------------------------------------------------ */
/* Support — ticketing, admin side. Any CUSTOMER/RIDER/BUSINESS can     */
/* raise a ticket via /support/tickets; this console only ever calls    */
/* the /support/admin/tickets/* routes, which are ADMIN/SUPER_ADMIN     */
/* only on the backend (RolesGuard rejects anyone else with a 403).     */
/* ------------------------------------------------------------------ */

export function listTickets(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")),
  ).toString();
  return request(`/support/admin/tickets${qs ? `?${qs}` : ""}`);
}

export function getTicket(id) {
  return request(`/support/admin/tickets/${id}`);
}

export function updateTicket(id, dto) {
  return request(`/support/admin/tickets/${id}`, { method: "PATCH", body: dto });
}

export function addTicketMessage(id, message, isInternalNote = false) {
  return request(`/support/admin/tickets/${id}/messages`, {
    method: "POST",
    body: { message, isInternalNote },
  });
}

/* ------------------------------------------------------------------ */
/* Businesses — admin read-only list/detail over BUSINESS-role         */
/* accounts. No suspend/edit actions yet; see README_ADMIN_WIRING.md.  */
/* ------------------------------------------------------------------ */

export function listBusinesses(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")),
  ).toString();
  return request(`/admin/businesses${qs ? `?${qs}` : ""}`);
}

export function getBusiness(id) {
  return request(`/admin/businesses/${id}`);
}

/* ------------------------------------------------------------------ */
/* Customers — admin read-only list/detail over CUSTOMER-role          */
/* accounts. Same shape as Businesses; no suspend/edit actions yet.    */
/* ------------------------------------------------------------------ */

export function listCustomers(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")),
  ).toString();
  return request(`/admin/customers${qs ? `?${qs}` : ""}`);
}

export function getCustomer(id) {
  return request(`/admin/customers/${id}`);
}
