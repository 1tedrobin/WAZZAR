/* ========================================================================
   WAZZAR RIDER APP — real backend client.

   Talks to the NestJS API in wazzar-backend/backend. Base URL comes from
   VITE_API_URL (see .env.example) and defaults to localhost:3000 for local
   dev against `npm run dev` in the backend.

   Same shape as the Customer app's api.js: this is the only file that
   knows an HTTP API exists — every screen component gets plain JS
   objects/promises from here.
   ======================================================================== */

import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const TOKEN_KEY = "wazzar_rider_access_token";
const REFRESH_KEY = "wazzar_rider_refresh_token";
const USER_KEY = "wazzar_rider_user";

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
// token — pass `auth: false` for the public endpoints (auth/register,
// auth/login).
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

// Same known-simplification as the Customer app: no SMS/OTP endpoint
// yet, so the OTP screen is a real UX step but a per-device generated
// password is what actually authenticates. A separate storage key
// (wazzar_rider_*) means the same phone number can hold both a
// CUSTOMER and a RIDER account without colliding.
function devicePasswordFor(phone) {
  return `Wazzar-Rider-${phone}-Dev1!`;
}

function normalizePhone(rawPhone) {
  const digits = rawPhone.replace(/\D/g, "");
  if (rawPhone.startsWith("+")) return rawPhone;
  if (digits.startsWith("255")) return `+${digits}`;
  return `+255${digits.replace(/^0/, "")}`;
}

export async function loginOrRegister(rawPhone) {
  const phone = normalizePhone(rawPhone);
  const password = devicePasswordFor(phone);

  try {
    const result = await request("/auth/login", {
      method: "POST",
      auth: false,
      body: { phone, password },
    });
    setSession(result);
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const result = await request("/auth/register", {
        method: "POST",
        auth: false,
        body: {
          phone,
          password,
          fullName: "WAZZAR Rider",
          role: "RIDER",
        },
      });
      setSession(result);
      return result;
    }
    throw err;
  }
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

/* ------------------------------------------------------------------ */
/* Uploads                                                              */
/* ------------------------------------------------------------------ */

// POST /uploads — multipart, so it bypasses the JSON request() helper
// above. Backs rider onboarding docs (ID/licence/vehicle-reg/insurance)
// and proof-of-delivery photos, both previously just client-side toggle
// buttons that went nowhere — see MASTER_GAPS_AND_ROADMAP.md
// ("File/photo upload endpoint"). Returns { url, filename, mimeType,
// sizeBytes }; callers only need `url`.
export async function uploadFile(file) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers,
    body: formData,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Rider profile & availability                                        */
/* ------------------------------------------------------------------ */

// Returns null (not a 404 throw) for "no profile yet" — the one case the
// app's own onboarding flow expects and needs to branch on, so callers
// don't all need their own try/catch for this specific 404.
export async function getMyRiderProfile() {
  try {
    return await request("/riders/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function createRiderProfile({
  vehicleType,
  vehicleRegistration,
  licenseNumber,
  insuranceExpiresAt,
  idDocumentUrl,
  licenseDocumentUrl,
  vehicleRegistrationDocumentUrl,
  insuranceDocumentUrl,
}) {
  return request("/riders", {
    method: "POST",
    body: {
      vehicleType,
      vehicleRegistration,
      licenseNumber,
      insuranceExpiresAt,
      idDocumentUrl,
      licenseDocumentUrl,
      vehicleRegistrationDocumentUrl,
      insuranceDocumentUrl,
    },
  });
}

export function goOnline() {
  return request("/riders/availability/online", { method: "POST" });
}

export function goOffline() {
  return request("/riders/availability/offline", { method: "POST" });
}

export function getEarnings() {
  return request("/riders/me/earnings");
}

/* ------------------------------------------------------------------ */
/* Deliveries                                                           */
/* ------------------------------------------------------------------ */

// GET /shipments/available — the open, unassigned ASSIGNMENT_PENDING
// queue. Added alongside this app (backend previously had no rider-
// facing equivalent to the admin/dispatcher queue).
export function getAvailableShipments({ limit = 5, offset = 0 } = {}) {
  return request(`/shipments/available?limit=${limit}&offset=${offset}`);
}

export function getShipment(id) {
  return request(`/shipments/${id}`);
}

// Connects once to the backend's /dispatch Socket.IO namespace and joins
// the shared queue room — the push counterpart to the polling loop above
// (App.jsx's useEffect on `online && screen === "home"`). Backs both
// events the backend broadcasts (see dispatch.gateway.ts on the
// backend):
//   - `dispatch:new-request` — a shipment just became ASSIGNMENT_PENDING
//   - `dispatch:claimed` — a shipment was just claimed by someone (self
//     or another rider/dispatcher), so it should disappear from view
//
// This does NOT replace the poll — it's additive. The poll stays as the
// fallback for a socket that hasn't connected yet, dropped, or is behind
// a network that blocks WebSocket upgrades; the socket just means a
// rider normally sees a new request within milliseconds instead of
// waiting up to ~4s for the next poll tick. Callers should keep treating
// GET /shipments/available as the source of truth when in doubt (e.g. on
// first mount, or after a reconnect) — the socket event is a nudge to
// look, not itself a fetch of the current, complete shipment state.
//
// Usage:
//   const unsubscribe = subscribeToDispatchQueue({
//     onNewRequest: (summary) => { /* show it, same shape as one entry
//                                     from getAvailableShipments() */ },
//     onClaimed: (shipmentId) => { /* hide it if currently shown */ },
//   });
//   // later, e.g. when going offline or on unmount:
//   unsubscribe();
//
// Falls back silently (returns a no-op unsubscribe, logs to console) if
// there's no token yet or the socket can't connect — same pattern as
// subscribeToShipmentTracking in the customer app.
export function subscribeToDispatchQueue({ onNewRequest, onClaimed }) {
  const token = getToken();
  if (!token) {
    return () => {};
  }

  const socket = io(`${API_BASE}/dispatch`, {
    auth: { token },
    transports: ["websocket", "polling"],
  });

  socket.on("dispatch:new-request", (summary) => {
    if (summary) onNewRequest?.(summary);
  });

  socket.on("dispatch:claimed", (payload) => {
    if (payload?.shipmentId) onClaimed?.(payload.shipmentId);
  });

  socket.on("connect_error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Dispatch queue socket failed to connect:", err.message);
  });

  return () => {
    socket.disconnect();
  };
}

// A rider claims an ASSIGNMENT_PENDING shipment for themselves. Can
// fail with 409 if another rider won the race — callers should treat
// that as "someone else got it," not a hard error.
export function acceptShipment(id) {
  return request(`/shipments/${id}/assign`, { method: "POST" });
}

// Generic forward-progress transition (ASSIGNED -> PICKUP_IN_PROGRESS
// -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY). DELIVERED has its
// own dedicated endpoint — see submitProofOfDelivery — because it also
// has to write the proof-of-delivery row atomically.
export function updateShipmentStatus(id, status, reason) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status, reason },
  });
}

export function submitProofOfDelivery(id, { recipientName, photoUrl, notes }) {
  return request(`/shipments/${id}/deliver`, {
    method: "POST",
    body: { recipientName, photoUrl, notes },
  });
}

// COMPLETED has no dedicated endpoint (same reasoning as the Customer
// app's completeShipment) — a bare status PATCH is exactly what it's
// for. Called once the rider finishes the rating/summary screen.
export function completeShipment(id) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status: "COMPLETED", reason: "Rider app: delivery closed out" },
  });
}

/* ------------------------------------------------------------------ */
/* Tracking                                                             */
/* ------------------------------------------------------------------ */

export function updateLocation({ latitude, longitude, accuracyMeters }) {
  return request("/rider/location", {
    method: "POST",
    body: { latitude, longitude, accuracyMeters },
  });
}

/* ------------------------------------------------------------------ */
/* Cash collection                                                      */
/* ------------------------------------------------------------------ */

// GET /payments/by-shipment/:shipmentId — the missing lookup this
// module's collectCash() needed: the shipment itself never carried a
// paymentId (GET /shipments/:id still doesn't), so this is how the
// active-delivery screen finds out whether the current shipment has a
// CASH payment sitting PENDING_CASH_COLLECTION. Returns null when no
// payment exists yet for the shipment — a normal state, not an error.
export function getPaymentForShipment(shipmentId) {
  return request(`/payments/by-shipment/${shipmentId}`);
}

// POST /payments/:id/collect-cash — confirms a CASH payment was
// physically collected.
export function collectCash(paymentId) {
  return request(`/payments/${paymentId}/collect-cash`, { method: "POST" });
}

export { ApiError };
