/* ========================================================================
   WAZZAR CUSTOMER APP — real backend client.

   Talks to the NestJS API in wazzar-backend/backend. Base URL comes from
   VITE_API_URL (see .env.example) and defaults to localhost:3000 for local
   dev against `npm run dev` in the backend.

   This is the only file in the app that knows an HTTP API exists — every
   screen component gets plain JS objects/promises from here, same shape
   whether the data came from a real fetch or (previously) mockData.js.
   ======================================================================== */

import { io } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const TOKEN_KEY = "wazzar_customer_access_token";
const REFRESH_KEY = "wazzar_customer_refresh_token";
const USER_KEY = "wazzar_customer_user";

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

// The backend has no SMS/OTP endpoint yet (Piece 4 is phone+password
// register/login) — the OTP screen in this app is a real UX step, but
// verifying it logs the phone number into a real account rather than
// checking a real SMS code. Each phone number gets a per-device
// generated password on first use so the same phone reliably logs back
// into the same account on this device. This is a known simplification,
// not a security model — see README "Frontend wiring" notes.
function devicePasswordFor(phone) {
  return `Wazzar-${phone}-Dev1!`;
}

function normalizePhone(rawPhone) {
  // Backend expects E.164 (+255XXXXXXXXX). The UI collects a local
  // 9-digit number (e.g. "712345678"); prefix the Tanzania country code
  // if it isn't already there.
  const digits = rawPhone.replace(/\D/g, "");
  if (rawPhone.startsWith("+")) return rawPhone;
  if (digits.startsWith("255")) return `+${digits}`;
  return `+255${digits.replace(/^0/, "")}`;
}

export async function loginOrRegister(rawPhone, fullName) {
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
    // 401 = no such account (or, indistinguishably, wrong password —
    // the backend deliberately doesn't say which). Either way, for a
    // brand-new phone number on this device the right move is to
    // register a fresh account with the same device-derived password.
    if (err instanceof ApiError && err.status === 401) {
      const result = await request("/auth/register", {
        method: "POST",
        auth: false,
        body: {
          phone,
          password,
          fullName: fullName || "WAZZAR Customer",
          role: "CUSTOMER",
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
/* Pricing                                                              */
/* ------------------------------------------------------------------ */

// Public endpoint — no auth required, matches PricingController.
export function calculatePrice({ distanceKm, weightKg }) {
  return request("/pricing/calculate", {
    method: "POST",
    auth: false,
    body: { distanceKm, weightKg },
  });
}

/* ------------------------------------------------------------------ */
/* Shipments                                                            */
/* ------------------------------------------------------------------ */

export function createShipment({ pickupLocation, dropoffLocation, packageWeightKg, packageDescription }) {
  return request("/shipments", {
    method: "POST",
    body: { pickupLocation, dropoffLocation, packageWeightKg, packageDescription },
  });
}

export function getShipment(id) {
  return request(`/shipments/${id}`);
}

export function getShipmentHistory(id) {
  return request(`/shipments/${id}/history`);
}

/* ------------------------------------------------------------------ */
/* Live tracking (WebSocket)                                            */
/* ------------------------------------------------------------------ */

// Connects once to the backend's /tracking Socket.IO namespace and
// subscribes to one shipment's room. Replaces the tracking screen's old
// fully-simulated rider marker (see getRiderPosition in App.jsx) with the
// real rider GPS ping the backend already broadcasts every time
// POST /rider/location lands (see tracking.gateway.ts / tracking.service.ts
// on the backend — this was previously wired up server-side but nothing
// in any frontend app connected to it).
//
// Usage:
//   const unsubscribe = subscribeToShipmentTracking(shipmentId, (snapshot) => {
//     // snapshot.riderLocation is either { latitude, longitude, accuracyMeters }
//     // or null (no GPS fix yet — e.g. rider assigned but hasn't sent a ping)
//   });
//   // later, e.g. on unmount or when the shipment finishes:
//   unsubscribe();
//
// Falls back silently (calls onUpdate with nothing, logs to console) if
// the socket can't connect at all — callers should keep their own
// polling/fallback UI for that case, this never throws.
export function subscribeToShipmentTracking(shipmentId, onUpdate) {
  const token = getToken();
  if (!token) {
    return () => {};
  }

  const socket = io(`${API_BASE}/tracking`, {
    auth: { token },
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    socket.emit("subscribe", { shipmentId });
  });

  socket.on("tracking:update", (snapshot) => {
    if (snapshot && snapshot.shipmentId === shipmentId) {
      onUpdate(snapshot);
    }
  });

  socket.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Tracking socket error:", err?.message || err);
  });

  socket.on("connect_error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Tracking socket failed to connect:", err.message);
  });

  return () => {
    socket.emit("unsubscribe", { shipmentId });
    socket.disconnect();
  };
}

// Moves a paid, CONFIRMED shipment into the dispatch queue. A real
// operator app (dispatcher/admin, or an automated rule) would normally
// trigger this; the customer app calls it itself right after payment
// confirms since there's no dispatcher UI wired up yet in this pass.
export function requestDispatch(id) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status: "ASSIGNMENT_PENDING", reason: "Customer app: payment confirmed" },
  });
}

// DELIVERED -> COMPLETED has no dedicated endpoint (unlike ASSIGNED/
// DELIVERED, which have their own atomic writes) — a bare status PATCH
// is exactly what it's for. Called once the tracking screen observes
// DELIVERED, so the receipt/rating screen reflects a closed-out order.
export function completeShipment(id) {
  return request(`/shipments/${id}/status`, {
    method: "PATCH",
    body: { status: "COMPLETED", reason: "Customer app: delivery confirmed" },
  });
}

// POST /shipments/:id/rate-rider — owning customer only, one rating per
// shipment. Backs the star-rating step on the DeliveredScreen, which
// previously just set local state and went nowhere. See
// MASTER_GAPS_AND_ROADMAP.md ("Customer-rating endpoint").
export function rateRider(shipmentId, rating) {
  return request(`/shipments/${shipmentId}/rate-rider`, {
    method: "POST",
    body: { rating },
  });
}

/* ------------------------------------------------------------------ */
/* Riders (public profile for customer tracking)                        */
/* ------------------------------------------------------------------ */

// GET /riders/:id/public — fetch a rider's public profile (name, vehicle,
// rating) for display during delivery tracking. No auth required.
export function getRiderPublicProfile(riderId) {
  return request(`/riders/${riderId}/public`, { auth: false });
}

/* ------------------------------------------------------------------ */
/* Geocoding                                                            */
/* ------------------------------------------------------------------ */

// GET /geocode/search — backs the pickup/dropoff address search-as-you-
// type list. Replaces the direct-from-the-browser call to Nominatim
// that lived in App.jsx, routing it through the backend's adapter
// instead (see MASTER_GAPS_AND_ROADMAP.md, "Geocoding / places-search
// endpoint"). Reverse geocoding (turning a dragged map pin back into an
// address) stays a direct Nominatim call in App.jsx — the backend only
// exposes forward search, not reverse.
export function searchAddresses(q, countryCode) {
  const params = new URLSearchParams({ q });
  if (countryCode) params.set("countryCode", countryCode);
  return request(`/geocode/search?${params.toString()}`);
}

/* ------------------------------------------------------------------ */
/* Payments                                                             */
/* ------------------------------------------------------------------ */

const PAYMENT_METHOD_MAP = { momo: "MPESA", card: "STRIPE", cash: "CASH" };

export function initiatePayment({ shipmentId, uiMethod, phone }) {
  const method = PAYMENT_METHOD_MAP[uiMethod] || "CASH";
  const body = { shipmentId, method };
  if (method === "MPESA") body.phoneNumber = normalizePhone(phone).replace("+", "");
  if (method === "STRIPE") body.cardToken = "tok_demo_visa"; // no real Stripe Elements wired up yet
  return request("/payments/initiate", { method: "POST", body });
}

// MPESA/STRIPE only complete when the provider calls back
// POST /payments/webhooks/{mpesa,stripe} — in production that's Safaricom
// or Stripe hitting the backend directly, never the browser. Both
// providers are mocked in this backend pass (fake transaction IDs, no
// real gateway), so there's no real webhook coming. To keep the demo
// flow moving without a payment gateway, the app fires the same webhook
// call itself right after initiating — clearly a demo-only shim, not
// something a production client should ever do (a browser calling its
// own payment webhook is not a real confirmation of anything).
//
// The M-Pesa body sent here is shaped like a REAL Daraja STK Push
// callback (see backend's MpesaWebhookDto/mpesa-callback.util.ts) — not
// the old flattened `{transactionId, success, amount}` shape this shim
// used to send, which the backend no longer accepts now that the real
// Daraja shape is enforced. CallbackMetadata.Item mirrors exactly what
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
  if (payment.method === "STRIPE") {
    return request("/payments/webhooks/stripe", {
      method: "POST",
      auth: false,
      body: {
        type: "payment_intent.succeeded",
        data: { object: { id: payment.externalId } },
      },
    });
  }
  // CASH has no webhook — it stays PENDING_CASH_COLLECTION until a rider
  // or admin calls POST /payments/:id/collect-cash for real.
  return null;
}

export { ApiError };
