/* ========================================================================
   WAZZAR BUSINESS DASHBOARD — standalone build, split out of the original
   combined WAZZAR Suite prototype. Owns nothing about Customer/Rider/Admin.

   WIRED TO THE REAL BACKEND (wazzar-backend/backend) in this pass:
     - Auth (login/register as a BUSINESS account, GET /auth/me)
     - Orders = real shipments (create, list, live status) via /shipments
     - Overview stats + weekly chart, computed client-side from real orders
     - Live price quotes via /pricing/calculate, real geocoding via Nominatim
     - Customers = a real per-business address book via /business/customers
       (see backend's business-customers module) — NOT a link to real
       platform CUSTOMER accounts, and has no "orders"/"lastOrder" stats
       (the old mock columns) since shipments have no recipient-phone
       field to match against yet — see that module's migration comment.
     - Staff = a real per-business team roster via /business/staff (see
       backend's business-staff module) — NOT real login accounts.
       "Invite staff" adds a roster entry only; no email is sent and no
       WAZZAR account is created for them — see that module's migration
       comment for why a real invite/sub-account system is a bigger
       follow-on piece, not built here.
     - Scheduled deliveries = real recurring-shipment definitions via
       /business/scheduled-deliveries (see backend's scheduled-deliveries
       module). A backend cron job (not this app) turns due schedules
       into real shipments automatically, once a minute — this app only
       ever does CRUD on the schedule definition, never "runs" one.

   NOT wired — the backend has no supporting tables/endpoints for this yet.
   Still renders with the original mock data so nothing regresses, but is
   clearly flagged in the UI (see <DemoBanner>) instead of silently
   pretending to be live:
     - Billing (no subscription/invoicing module — WAZZAR prices per
       delivery today, not as a monthly plan)
   See WIRING_NOTES.md alongside this app for the full rundown.
   ======================================================================== */

import React, { useState, useEffect, lazy, Suspense } from "react";
import {
  Search, ChevronRight, Check, CheckCircle2, Package, TrendingUp, Clock, Download,
  LayoutDashboard, Users, Calendar, UserCog, Receipt, Settings, Menu, Bell, Plus, X,
  LogOut, Loader2, AlertTriangle,
} from "lucide-react";
import * as api from "./api";

// Code-split out of the main bundle (was the direct cause of Rollup's
// >500kB warning for this app) — see DeliveriesChart.jsx for why this is a
// lazy import instead of a normal top-level one, and why App() below also
// calls preloadDeliveriesChart() on login rather than leaving it fully cold.
const DeliveriesChart = lazy(() => import("./DeliveriesChart"));
const preloadDeliveriesChart = () => import("./DeliveriesChart");

const COLORS = {
  ink: "#10221C",
  inkSoft: "#1C332B",
  inkFaint: "#5B6E65",
  paper: "#F7F4EE",
  paperDim: "#ECE7DA",
  amber: "#FF7A1A",
  amberDeep: "#E8650A",
  amberSoft: "#FFE3C9",
  teal: "#0E7C86",
  tealSoft: "#DCEEEE",
  green: "#2BAA6B",
  greenSoft: "#DFF3E7",
  coral: "#E1483B",
  coralSoft: "#FAD9D5",
};

const fmtTZS = (n) => `TZS ${Math.round(n || 0).toLocaleString("en-US")}`;

/* ---------------------------------------------------------------------- */
// 0 = Sunday ... 6 = Saturday, matching the backend's daysOfWeek
// (Date#getUTCDay() numbering) — see the recurrence util's header
// comment in scheduled-deliveries.
const WEEKDAY_LABELS = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 0, short: "Sun" },
];

// Turns a schedule's real daysOfWeek/timeOfDay into the same kind of
// short label the old mock data used ("Weekdays · 9:00 AM"), and its
// real nextRunAt into a friendly "next run" string — display-only, the
// backend is the one source of truth for both fields.
function describeRecurrence(daysOfWeek) {
  const sorted = [...daysOfWeek].sort();
  const weekdays = [1, 2, 3, 4, 5];
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 5 && weekdays.every((d) => sorted.includes(d))) return "Weekdays";
  if (sorted.length === 2 && sorted.includes(0) && sorted.includes(6)) return "Weekends";
  return WEEKDAY_LABELS.filter((d) => daysOfWeek.includes(d.value)).map((d) => d.short).join(", ");
}

function fmtTimeOfDay(timeOfDay) {
  const [h, m] = timeOfDay.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtNextRun(nextRunAt) {
  const date = new Date(nextRunAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (isTomorrow) return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

// Payment.status (backend enum: PENDING/PROCESSING/COMPLETED/FAILED/
// REFUNDED/PARTIALLY_REFUNDED/PENDING_CASH_COLLECTION) -> the same kind
// of short display label + Pill style the rest of this app already
// uses for shipment/staff statuses (see PILL_STYLES above). COMPLETED
// maps to "Paid" deliberately — from a business's point of view, a
// completed payment on their real per-delivery billing history *is*
// what "Paid" meant on the old fake invoice list, just attached to a
// single delivery instead of a monthly invoice.
const PAYMENT_STATUS_LABELS = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  COMPLETED: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially Refunded",
  PENDING_CASH_COLLECTION: "Awaiting Cash",
};

function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || status;
}

function paymentMethodLabel(method) {
  if (method === "MPESA") return "M-Pesa";
  if (method === "STRIPE") return "Card";
  if (method === "CASH") return "Cash";
  return method;
}

const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "orders", label: "Orders", icon: Package },
  { id: "customers", label: "Customers", icon: Users },
  { id: "scheduled", label: "Scheduled", icon: Calendar },
  { id: "staff", label: "Staff", icon: UserCog },
  { id: "billing", label: "Billing", icon: Receipt },
  { id: "settings", label: "Settings", icon: Settings },
];

/* ---------------------------------------------------------------------- */
/* Geocoding — real forward search via Nominatim (OpenStreetMap's free    */
/* geocoder, no API key). Same helper the wired customer-app uses for its */
/* pickup/dropoff pickers — see customer-app/src/App.jsx.                 */
/* ---------------------------------------------------------------------- */

async function searchPlaces(query, near) {
  if (!query || query.trim().length < 2) return [];
  try {
    const params = new URLSearchParams({ format: "json", q: query.trim(), limit: "5", addressdetails: "0", countrycodes: "tz" });
    if (near) {
      const delta = 0.6;
      params.set("viewbox", `${near.lng - delta},${near.lat + delta},${near.lng + delta},${near.lat - delta}`);
      params.set("bounded", "0");
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d) => ({
      label: d.display_name.split(",").slice(0, 3).join(",").trim(),
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
    }));
  } catch (e) { return []; }
}

function usePlaceSearch(query, near) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query || query.trim().length < 2) { setResults([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      searchPlaces(query, near).then((r) => { if (!cancelled) { setResults(r); setLoading(false); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return { results, loading };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/* ---------------------------------------------------------------------- */
/* Shipment <-> Order mapping                                              */
/*                                                                          */
/* The backend's Shipment has no recipient-name/phone field anywhere in    */
/* the system (proof-of-delivery captures a recipient name, but only at    */
/* the moment a rider marks DELIVERED — too late to show in the Orders     */
/* list). This app stashes "Recipient: NAME · PHONE" in                    */
/* dropoffLocation.instruction (a free-text field meant for exactly this   */
/* kind of dropoff context) and parses it back out here. It's a real,      */
/* honest workaround, not a fabrication — flagged in WIRING_NOTES.md as    */
/* something a dedicated recipient field on the backend should replace.    */
/* ---------------------------------------------------------------------- */

function parseRecipient(instruction) {
  if (!instruction) return { name: "Recipient", phone: null };
  const m = /^Recipient:\s*([^·]+?)(?:\s*·\s*(.+))?$/.exec(instruction.trim());
  if (!m) return { name: instruction.trim() || "Recipient", phone: null };
  return { name: m[1].trim(), phone: m[2] ? m[2].trim() : null };
}

const STATUS_LABELS = {
  CREATED: "Draft",
  QUOTED: "Awaiting Payment",
  CONFIRMED: "Confirmed",
  ASSIGNMENT_PENDING: "Searching",
  ASSIGNED: "Rider Assigned",
  PICKUP_IN_PROGRESS: "Pickup In Progress",
  PICKED_UP: "Picked Up",
  IN_TRANSIT: "In Transit",
  OUT_FOR_DELIVERY: "Out For Delivery",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_STAGE = {
  CREATED: "Awaiting Payment",
  QUOTED: "Awaiting Payment",
  CONFIRMED: "Active",
  ASSIGNMENT_PENDING: "Active",
  ASSIGNED: "Active",
  PICKUP_IN_PROGRESS: "Active",
  PICKED_UP: "Active",
  IN_TRANSIT: "Active",
  OUT_FOR_DELIVERY: "Active",
  DELIVERED: "Delivered",
  COMPLETED: "Delivered",
  CANCELLED: "Cancelled",
};

// Progress-bar milestones in the order detail modal, mapped onto the
// backend's full 10-state lifecycle (see shipment-status.transitions.ts).
const ORDERED_STATUSES = ["QUOTED", "CONFIRMED", "ASSIGNMENT_PENDING", "ASSIGNED", "PICKUP_IN_PROGRESS", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"];
const MILESTONES = [
  { status: "QUOTED", label: "Placed" },
  { status: "CONFIRMED", label: "Paid" },
  { status: "ASSIGNED", label: "Rider Assigned" },
  { status: "PICKED_UP", label: "Picked Up" },
  { status: "DELIVERED", label: "Delivered" },
];
function milestoneIndex(rawStatus) {
  const cur = ORDERED_STATUSES.indexOf(rawStatus);
  if (cur === -1) return -1;
  let idx = -1;
  MILESTONES.forEach((m, i) => { if (ORDERED_STATUSES.indexOf(m.status) <= cur) idx = i; });
  return idx;
}

function formatOrderDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `Today · ${time}`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function mapShipmentToOrder(shipment) {
  const { name, phone } = parseRecipient(shipment.dropoffLocation?.instruction);
  return {
    id: `#${shipment.id.slice(0, 8).toUpperCase()}`,
    fullId: shipment.id,
    recipient: name,
    phone,
    address: shipment.dropoffLocation?.address || "—",
    pickupAddress: shipment.pickupLocation?.address || "—",
    category: shipment.packageDescription || "Parcel",
    rawStatus: shipment.status,
    status: STATUS_LABELS[shipment.status] || shipment.status,
    stage: STATUS_STAGE[shipment.status] || "Active",
    fare: shipment.price ? Number(shipment.price) : 0,
    date: formatOrderDate(shipment.createdAt),
    createdAt: shipment.createdAt,
    deliveredAt: shipment.deliveredAt,
    rider: shipment.riderId || null,
  };
}

function statsFor(orders) {
  const now = new Date();
  const isThisMonth = (iso) => {
    const d = new Date(iso);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };
  const thisMonth = orders.filter((o) => isThisMonth(o.createdAt));
  const delivered = thisMonth.filter((o) => o.rawStatus === "DELIVERED" || o.rawStatus === "COMPLETED");
  const spend = thisMonth.filter((o) => o.rawStatus !== "CANCELLED").reduce((s, o) => s + o.fare, 0);
  const active = orders.filter((o) => o.stage === "Active").length;
  const withDeliveredAt = thisMonth.filter((o) => o.deliveredAt);
  const avgMin = withDeliveredAt.length
    ? Math.round(withDeliveredAt.reduce((s, o) => s + (new Date(o.deliveredAt) - new Date(o.createdAt)) / 60000, 0) / withDeliveredAt.length)
    : null;
  return { deliveries: delivered.length, spend, avgMin, active };
}

function weeklyChartData(orders) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const now = new Date();
  const dayIdx = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayIdx);
  const counts = days.map(() => 0);
  orders.forEach((o) => {
    if (!o.createdAt) return;
    const d = new Date(o.createdAt);
    const diff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - monday) / 86400000);
    if (diff >= 0 && diff < 7) counts[diff] += 1;
  });
  return days.map((d, i) => ({ day: d, deliveries: counts[i] }));
}

/* ---------------------------------------------------------------------- */
/* Shared primitives                                                       */
/* ---------------------------------------------------------------------- */

const PILL_STYLES = {
  Draft: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  "Awaiting Payment": { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  Confirmed: { bg: COLORS.tealSoft, text: COLORS.teal },
  Searching: { bg: COLORS.tealSoft, text: COLORS.teal },
  "Rider Assigned": { bg: COLORS.tealSoft, text: COLORS.teal },
  "Pickup In Progress": { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  "Picked Up": { bg: COLORS.tealSoft, text: COLORS.teal },
  "In Transit": { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  "Out For Delivery": { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  Delivered: { bg: COLORS.greenSoft, text: COLORS.green },
  Completed: { bg: COLORS.greenSoft, text: COLORS.green },
  Cancelled: { bg: COLORS.coralSoft, text: COLORS.coral },
  Scheduled: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  Manager: { bg: COLORS.tealSoft, text: COLORS.teal },
  Staff: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  Invited: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  Active: { bg: COLORS.greenSoft, text: COLORS.green },
  Pending: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  Paid: { bg: COLORS.greenSoft, text: COLORS.green },
  Due: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  Processing: { bg: COLORS.tealSoft, text: COLORS.teal },
  Failed: { bg: COLORS.coralSoft, text: COLORS.coral },
  Refunded: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  "Partially Refunded": { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  "Awaiting Cash": { bg: COLORS.amberSoft, text: COLORS.amberDeep },
};

function Pill({ status }) {
  const s = PILL_STYLES[status] || { bg: COLORS.paperDim, text: COLORS.inkFaint };
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap" style={{ backgroundColor: s.bg, color: s.text }}>
      {status}
    </span>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="rounded-full flex-shrink-0 transition-colors"
      style={{ width: 40, height: 24, backgroundColor: checked ? COLORS.teal : COLORS.inkFaint, opacity: checked ? 1 : 0.3, padding: 3 }}
    >
      <div className="rounded-full transition-transform" style={{ width: 18, height: 18, backgroundColor: COLORS.paper, transform: checked ? "translateX(16px)" : "translateX(0px)" }} />
    </button>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
      <Icon size={16} color={COLORS.teal} />
      <p className="text-xl font-extrabold mt-2" style={{ color: COLORS.ink }}>{value}</p>
      <p className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>{label}</p>
    </div>
  );
}

function DataTable({ columns, rows, onRowClick }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
      <div className="overflow-x-auto">
        <table className="w-full text-left" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: COLORS.paperDim }}>
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 text-xs font-bold tracking-wide whitespace-nowrap" style={{ color: COLORS.inkFaint }}>{c.label}</th>
              ))}
              {onRowClick && <th style={{ width: 36 }}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (onRowClick ? 1 : 0)} className="px-4 py-8 text-center text-sm" style={{ color: COLORS.inkFaint }}>
                  No records yet.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id || i} onClick={() => onRowClick && onRowClick(r)} className={onRowClick ? "cursor-pointer tr-row" : "tr-row"} style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: COLORS.ink }}>
                      {c.render ? c.render(r) : r[c.key]}
                    </td>
                  ))}
                  {onRowClick && (
                    <td className="px-2">
                      <ChevronRight size={15} color={COLORS.inkFaint} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(16,34,28,0.5)", zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-2xl w-full overflow-y-auto modal-pop" style={{ backgroundColor: COLORS.paper, maxWidth: wide ? 560 : 420, maxHeight: "85vh" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${COLORS.paperDim}` }}>
          <p className="text-base font-extrabold" style={{ color: COLORS.ink }}>{title}</p>
          <button onClick={onClose} className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, backgroundColor: COLORS.paperDim }}>
            <X size={16} color={COLORS.ink} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>{label}</span>
      <span className="text-sm font-semibold text-right" style={{ color: COLORS.ink }}>{value}</span>
    </div>
  );
}

// Amber "this isn't real data yet" notice — for the four surfaces the
// backend has no model for. See header comment.
function DemoBanner({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: COLORS.amberSoft }}>
      <AlertTriangle size={15} color={COLORS.amberDeep} style={{ marginTop: 1, flexShrink: 0 }} />
      <p className="text-xs font-semibold" style={{ color: COLORS.amberDeep }}>{children}</p>
    </div>
  );
}

// Coral "something real actually failed" notice — network/API errors.
function ErrorBanner({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: COLORS.coralSoft }}>
      <AlertTriangle size={15} color={COLORS.coral} style={{ marginTop: 1, flexShrink: 0 }} />
      <p className="text-xs font-semibold" style={{ color: COLORS.coral }}>{children}</p>
    </div>
  );
}

const ORDER_COLUMNS = [
  { key: "id", label: "Order" },
  { key: "recipient", label: "Recipient" },
  { key: "category", label: "Category" },
  // No rider-name lookup is exposed to a BUSINESS account by the backend
  // (riderId has no accessible /riders/:id endpoint outside admin) — show
  // assignment state rather than fabricate a name.
  { key: "rider", label: "Rider", render: (r) => (r.rider ? <span className="text-xs font-bold" style={{ color: COLORS.teal }}>Assigned</span> : <span style={{ color: COLORS.inkFaint }}>—</span>) },
  { key: "status", label: "Status", render: (r) => <Pill status={r.status} /> },
  { key: "fare", label: "Fare", render: (r) => fmtTZS(r.fare) },
  { key: "date", label: "Date" },
];

/* ---------------------------------------------------------------------- */
/* Auth                                                                     */
/* ---------------------------------------------------------------------- */

function SplashScreen() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ backgroundColor: COLORS.paperDim }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>
      <Loader2 size={24} color={COLORS.teal} className="spin" />
    </div>
  );
}

function LoginScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = mode === "login"
        ? await api.login(phone, password)
        : await api.register({ phone, password, fullName, email });
      onAuthed(result.user);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-5" style={{ backgroundColor: COLORS.paperDim, fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Manrope', sans-serif; box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }
      `}</style>
      <div className="w-full rounded-2xl p-6" style={{ maxWidth: 380, backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="rounded-xl flex items-center justify-center font-extrabold flex-shrink-0" style={{ width: 40, height: 40, backgroundColor: COLORS.teal, color: COLORS.paper }}>W</div>
          <div>
            <p className="text-base font-extrabold" style={{ color: COLORS.ink }}>WAZZAR Business</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{mode === "login" ? "Log in to your dashboard" : "Create your business account"}</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === "register" && (
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" required
              className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
          )}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (e.g. 712 345 678)" required
            className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
          {mode === "register" && (
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" type="email"
              className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
          )}
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required minLength={8}
            className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
          {mode === "register" && (
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>At least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.</p>
          )}

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 font-bold text-sm mt-1"
            style={{ backgroundColor: submitting ? COLORS.paperDim : COLORS.teal, color: submitting ? COLORS.inkFaint : COLORS.paper }}>
            {submitting && <Loader2 size={15} className="spin" />}
            {submitting ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }} className="w-full text-center text-xs font-bold mt-4" style={{ color: COLORS.teal }}>
          {mode === "login" ? "New here? Create a business account" : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Layout                                                                   */
/* ---------------------------------------------------------------------- */

function initialsFor(text) {
  return (text || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function Sidebar({ page, setPage, open, setOpen, user, business, onLogout }) {
  return (
    <>
      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 lg:hidden z-40" style={{ backgroundColor: "rgba(16,34,28,0.5)" }} />}
      <div
        className={`fixed top-0 left-0 h-screen w-60 flex flex-col z-50 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: COLORS.ink }}
      >
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <div className="rounded-xl flex items-center justify-center font-extrabold flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.teal, color: COLORS.paper }}>{initialsFor(business.name)}</div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold truncate" style={{ color: COLORS.paper }}>{business.name || "My Business"}</p>
            <p className="text-xs" style={{ color: COLORS.paper, opacity: 0.5 }}>WAZZAR Business</p>
          </div>
        </div>
        <div className="flex-1 px-3 flex flex-col gap-1 overflow-y-auto">
          {NAV.map((n) => {
            const active = page === n.id;
            return (
              <button
                key={n.id}
                onClick={() => { setPage(n.id); setOpen(false); }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ backgroundColor: active ? COLORS.inkSoft : "transparent" }}
              >
                <n.icon size={17} color={COLORS.teal} strokeWidth={active ? 2.4 : 2} style={{ opacity: active ? 1 : 0.55 }} />
                <span className="text-sm font-semibold" style={{ color: COLORS.paper, opacity: active ? 1 : 0.7 }}>{n.label}</span>
              </button>
            );
          })}
        </div>
        <div className="px-5 py-5 flex items-center gap-3" style={{ borderTop: `1px solid ${COLORS.inkSoft}` }}>
          <div className="rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0" style={{ width: 32, height: 32, backgroundColor: COLORS.teal, color: COLORS.paper }}>{initialsFor(user.fullName)}</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate" style={{ color: COLORS.paper }}>{user.fullName}</p>
            <p className="text-xs truncate" style={{ color: COLORS.paper, opacity: 0.5 }}>{user.phone}</p>
          </div>
          <button onClick={onLogout} title="Log out" className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, backgroundColor: COLORS.inkSoft }}>
            <LogOut size={14} color={COLORS.paper} style={{ opacity: 0.7 }} />
          </button>
        </div>
      </div>
    </>
  );
}

function TopBar({ title, onMenuClick, onNewDelivery }) {
  return (
    <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ backgroundColor: COLORS.paper, borderBottom: `1px solid ${COLORS.paperDim}`, zIndex: 30 }}>
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="lg:hidden rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paperDim }}>
          <Menu size={18} color={COLORS.ink} />
        </button>
        <h1 className="text-lg font-extrabold" style={{ color: COLORS.ink }}>{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onNewDelivery} className="hidden sm:flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ backgroundColor: COLORS.teal }}>
          <Plus size={15} color={COLORS.paper} />
          <span className="text-sm font-bold" style={{ color: COLORS.paper }}>New delivery</span>
        </button>
        <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paperDim }}>
          <Bell size={16} color={COLORS.ink} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Pages                                                                    */
/* ---------------------------------------------------------------------- */

function OverviewPage({ orders, stats, chartData, loading, error, onNewDelivery, onOpenOrder, setPage }) {
  const recent = orders.slice(0, 5);
  return (
    <div>
      {error && <ErrorBanner>Couldn't load your orders from WAZZAR: {error}</ErrorBanner>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Package} label="Deliveries this month" value={stats.deliveries} />
        <StatCard icon={TrendingUp} label="Spend this month" value={fmtTZS(stats.spend)} />
        <StatCard icon={Clock} label="Avg delivery time" value={stats.avgMin != null ? `${stats.avgMin} min` : "—"} />
        <StatCard icon={CheckCircle2} label="Active right now" value={stats.active} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 rounded-2xl p-5" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
          <p className="text-sm font-extrabold mb-4" style={{ color: COLORS.ink }}>Deliveries this week</p>
          <Suspense fallback={<div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin" color={COLORS.inkFaint} /></div>}>
            <DeliveriesChart
              chartData={chartData}
              tealColor={COLORS.teal}
              inkFaintColor={COLORS.inkFaint}
              paperDimColor={COLORS.paperDim}
            />
          </Suspense>
        </div>
        <div className="rounded-2xl p-5 flex flex-col justify-between" style={{ backgroundColor: COLORS.ink }}>
          <div>
            <p className="text-sm font-extrabold mb-1" style={{ color: COLORS.paper }}>Quick action</p>
            <p className="text-xs mb-4" style={{ color: COLORS.paper, opacity: 0.6 }}>Create a delivery in seconds — no need to leave your dashboard.</p>
          </div>
          <button onClick={onNewDelivery} className="w-full flex items-center justify-center gap-2 rounded-xl py-3" style={{ backgroundColor: COLORS.teal }}>
            <Plus size={16} color={COLORS.paper} />
            <span className="text-sm font-bold" style={{ color: COLORS.paper }}>New delivery</span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>Recent orders</p>
        <button onClick={() => setPage("orders")} className="text-xs font-bold" style={{ color: COLORS.teal }}>View all</button>
      </div>
      {loading && orders.length === 0 ? (
        <p className="text-sm font-semibold px-1" style={{ color: COLORS.inkFaint }}>Loading orders…</p>
      ) : (
        <DataTable columns={ORDER_COLUMNS} rows={recent} onRowClick={onOpenOrder} />
      )}
    </div>
  );
}

function OrdersPage({ orders, loading, error, onNewDelivery, onOpenOrder }) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const filters = ["All", "Awaiting Payment", "Active", "Delivered", "Cancelled"];
  const filtered = orders.filter(
    (o) => (filter === "All" || o.stage === filter) && (o.recipient.toLowerCase().includes(query.toLowerCase()) || o.id.toLowerCase().includes(query.toLowerCase()))
  );
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
          <Search size={15} color={COLORS.inkFaint} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by order or recipient" className="flex-1 bg-transparent outline-none text-sm" style={{ color: COLORS.ink }} />
        </div>
        <button onClick={onNewDelivery} className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 flex-shrink-0" style={{ backgroundColor: COLORS.teal }}>
          <Plus size={15} color={COLORS.paper} />
          <span className="text-sm font-bold" style={{ color: COLORS.paper }}>New delivery</span>
        </button>
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {filters.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className="rounded-full px-3 py-1.5 whitespace-nowrap" style={{ backgroundColor: filter === f ? COLORS.ink : COLORS.paperDim }}>
            <span className="text-xs font-bold" style={{ color: filter === f ? COLORS.paper : COLORS.inkFaint }}>{f}</span>
          </button>
        ))}
      </div>
      {error && <ErrorBanner>Couldn't load orders from WAZZAR: {error}</ErrorBanner>}
      {loading && orders.length === 0 ? (
        <p className="text-sm font-semibold px-1" style={{ color: COLORS.inkFaint }}>Loading orders…</p>
      ) : (
        <DataTable columns={ORDER_COLUMNS} rows={filtered} onRowClick={onOpenOrder} />
      )}
    </div>
  );
}

function AddCustomerModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim() && phone.trim() && address.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api.createCustomer({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim() || undefined,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save this customer");
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Add customer" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional) — e.g. gate code, delivery preferences" rows={2} className="rounded-xl px-4 py-3 text-sm font-semibold outline-none resize-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        {error && <p className="text-xs font-bold" style={{ color: COLORS.coral }}>{error}</p>}
        <button onClick={submit} disabled={!canSubmit} className="rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2" style={{ backgroundColor: canSubmit ? COLORS.teal : COLORS.paperDim, color: canSubmit ? COLORS.paper : COLORS.inkFaint }}>
          {submitting ? <Loader2 size={16} className="animate-spin" /> : "Save customer"}
        </button>
      </div>
    </Modal>
  );
}

function CustomersPage({ customers, loading, error, onAdd, onDelete }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  const cols = [
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "notes", label: "Notes", render: (r) => r.notes || <span style={{ color: COLORS.inkFaint }}>—</span> },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
          disabled={deletingId === r.id}
          className="text-xs font-bold"
          style={{ color: COLORS.coral }}
        >
          {deletingId === r.id ? "…" : "Remove"}
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{customers.length} customers</p>
        <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ backgroundColor: COLORS.teal }}>
          <Plus size={15} color={COLORS.paper} />
          <span className="text-sm font-bold" style={{ color: COLORS.paper }}>Add customer</span>
        </button>
      </div>
      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ backgroundColor: COLORS.coralSoft, color: COLORS.coral }}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: COLORS.teal }} />
        </div>
      ) : (
        <DataTable columns={cols} rows={customers} />
      )}
      {showAddModal && <AddCustomerModal onClose={() => setShowAddModal(false)} onCreated={onAdd} />}
    </div>
  );
}

function AddScheduleModal({ onClose, onCreated, business }) {
  const [name, setName] = useState("");
  const [pickupText, setPickupText] = useState(business?.address || "");
  const [pickupCoord, setPickupCoord] = useState(business?.addressCoord || null);
  const [dropoffText, setDropoffText] = useState("");
  const [dropoffCoord, setDropoffCoord] = useState(null);
  const [days, setDays] = useState([]);
  const [time, setTime] = useState("09:00");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const toggleDay = (value) =>
    setDays((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]));

  const canSubmit = name.trim() && !!pickupCoord && !!dropoffCoord && days.length > 0 && time && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api.createScheduledDelivery({
        name: name.trim(),
        pickupLocation: { latitude: pickupCoord.lat, longitude: pickupCoord.lng, address: pickupText },
        dropoffLocation: { latitude: dropoffCoord.lat, longitude: dropoffCoord.lng, address: dropoffText },
        packageDescription: description.trim() || undefined,
        daysOfWeek: days,
        timeOfDay: time,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save this schedule");
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New schedule" onClose={onClose} wide>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schedule name — e.g. Daily restock" className="w-full rounded-xl px-4 py-3 text-sm font-semibold outline-none mb-4" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />

      <AddressField label="PICKUP ADDRESS" placeholder="Where the rider collects the package" text={pickupText} setText={setPickupText} coord={pickupCoord} setCoord={setPickupCoord} near={dropoffCoord} />
      <AddressField label="DROPOFF ADDRESS" placeholder="Where the recipient is" text={dropoffText} setText={setDropoffText} coord={dropoffCoord} setCoord={setDropoffCoord} near={pickupCoord} />

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>REPEATS ON</p>
      <div className="flex gap-1.5 mb-4">
        {WEEKDAY_LABELS.map((d) => (
          <button key={d.value} onClick={() => toggleDay(d.value)} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: days.includes(d.value) ? COLORS.teal : COLORS.paperDim }}>
            <span className="text-xs font-bold" style={{ color: days.includes(d.value) ? COLORS.paper : COLORS.inkFaint }}>{d.short}</span>
          </button>
        ))}
      </div>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>TIME (EAST AFRICA TIME)</p>
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-xl px-4 py-3 text-sm font-semibold outline-none mb-4" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />

      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Package description (optional)" rows={2} className="w-full rounded-xl px-4 py-3 text-sm font-semibold outline-none resize-none mb-4" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />

      {error && <p className="text-xs font-bold mb-3" style={{ color: COLORS.coral }}>{error}</p>}
      <button onClick={submit} disabled={!canSubmit} className="w-full rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2" style={{ backgroundColor: canSubmit ? COLORS.teal : COLORS.paperDim, color: canSubmit ? COLORS.paper : COLORS.inkFaint }}>
        {submitting ? <Loader2 size={16} className="animate-spin" /> : "Save schedule"}
      </button>
    </Modal>
  );
}

function ScheduledPage({ scheduled, loading, error, onAdd, onToggleActive, onDelete, business }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const handleToggle = async (row) => {
    setBusyId(row.id);
    try {
      await onToggleActive(row);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      await onDelete(id);
    } finally {
      setBusyId(null);
    }
  };

  const cols = [
    { key: "name", label: "Schedule" },
    {
      key: "recurrence",
      label: "Recurrence",
      render: (r) => `${describeRecurrence(r.daysOfWeek)} · ${fmtTimeOfDay(r.timeOfDay)}`,
    },
    { key: "nextRunAt", label: "Next run", render: (r) => fmtNextRun(r.nextRunAt) },
    {
      key: "active",
      label: "Status",
      render: (r) => <ToggleSwitch checked={r.active} onChange={() => handleToggle(r)} />,
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
          disabled={busyId === r.id}
          className="text-xs font-bold"
          style={{ color: COLORS.coral }}
        >
          {busyId === r.id ? "…" : "Remove"}
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{scheduled.length} recurring schedules</p>
        <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ backgroundColor: COLORS.teal }}>
          <Plus size={15} color={COLORS.paper} />
          <span className="text-sm font-bold" style={{ color: COLORS.paper }}>New schedule</span>
        </button>
      </div>
      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ backgroundColor: COLORS.coralSoft, color: COLORS.coral }}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: COLORS.teal }} />
        </div>
      ) : (
        <DataTable columns={cols} rows={scheduled} />
      )}
      {showAddModal && <AddScheduleModal onClose={() => setShowAddModal(false)} onCreated={onAdd} business={business} />}
    </div>
  );
}

function InviteStaffModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("STAFF");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim() && email.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api.inviteStaff({ name: name.trim(), email: email.trim(), role });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't add this team member");
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Invite staff" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs" style={{ color: COLORS.inkFaint }}>
          This adds them to your team list. No invite email is sent yet, and they don't get a WAZZAR login from this — see WIRING_NOTES.md.
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <div className="grid grid-cols-2 gap-2">
          {["STAFF", "MANAGER"].map((r) => (
            <button key={r} onClick={() => setRole(r)} className="rounded-xl py-3 text-sm font-bold" style={{ backgroundColor: role === r ? COLORS.teal : COLORS.paperDim, color: role === r ? COLORS.paper : COLORS.inkFaint }}>
              {r === "STAFF" ? "Staff" : "Manager"}
            </button>
          ))}
        </div>
        {error && <p className="text-xs font-bold" style={{ color: COLORS.coral }}>{error}</p>}
        <button onClick={submit} disabled={!canSubmit} className="rounded-xl px-4 py-3 text-sm font-bold flex items-center justify-center gap-2" style={{ backgroundColor: canSubmit ? COLORS.teal : COLORS.paperDim, color: canSubmit ? COLORS.paper : COLORS.inkFaint }}>
          {submitting ? <Loader2 size={16} className="animate-spin" /> : "Add to team"}
        </button>
      </div>
    </Modal>
  );
}

function StaffPage({ staff, loading, error, onAdd, onToggleActive, onRemove }) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const handleToggle = async (row) => {
    setBusyId(row.id);
    try {
      await onToggleActive(row);
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (id) => {
    setBusyId(id);
    try {
      await onRemove(id);
    } finally {
      setBusyId(null);
    }
  };

  const cols = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role", render: (r) => <Pill status={r.role === "MANAGER" ? "Manager" : "Staff"} /> },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <button onClick={(e) => { e.stopPropagation(); handleToggle(r); }} disabled={busyId === r.id}>
          <Pill status={r.status === "ACTIVE" ? "Active" : "Pending"} />
        </button>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <button onClick={(e) => { e.stopPropagation(); handleRemove(r.id); }} disabled={busyId === r.id} className="text-xs font-bold" style={{ color: COLORS.coral }}>
          {busyId === r.id ? "…" : "Remove"}
        </button>
      ),
    },
  ];

  return (
    <div>
      <DemoBanner>Team accounts aren't a real login system yet — this is a roster your business keeps, not accounts staff can log in with. Tap a status pill to toggle Active/Pending.</DemoBanner>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{staff.length} team members</p>
        <button onClick={() => setShowInviteModal(true)} className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ backgroundColor: COLORS.teal }}>
          <Plus size={15} color={COLORS.paper} />
          <span className="text-sm font-bold" style={{ color: COLORS.paper }}>Invite staff</span>
        </button>
      </div>
      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ backgroundColor: COLORS.coralSoft, color: COLORS.coral }}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: COLORS.teal }} />
        </div>
      ) : (
        <DataTable columns={cols} rows={staff} />
      )}
      {showInviteModal && <InviteStaffModal onClose={() => setShowInviteModal(false)} onCreated={onAdd} />}
    </div>
  );
}

// Builds and downloads a CSV of the calling business's own real payment
// history, entirely client-side from data already fetched via
// GET /payments/history — no backend export endpoint exists (or is
// needed) for this.
function downloadPaymentHistoryCsv(payments) {
  const header = ["Date", "Shipment", "Method", "Amount (TZS)", "Status"];
  const rows = payments.map((p) => [
    new Date(p.createdAt).toISOString(),
    p.shipmentId,
    paymentMethodLabel(p.method),
    p.amount,
    paymentStatusLabel(p.status),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wazzar-payments-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function BillingPage({ payments, loading, error }) {
  const completed = payments.filter((p) => p.status === "COMPLETED");
  const now = new Date();
  const paidThisMonth = completed
    .filter((p) => {
      const d = new Date(p.completedAt || p.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const pendingCount = payments.filter((p) =>
    ["PENDING", "PROCESSING", "PENDING_CASH_COLLECTION"].includes(p.status),
  ).length;
  const methodCounts = completed.reduce((acc, p) => {
    acc[p.method] = (acc[p.method] || 0) + 1;
    return acc;
  }, {});
  const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  const cols = [
    { key: "date", label: "Date", render: (r) => formatOrderDate(r.createdAt) },
    { key: "shipmentId", label: "Shipment", render: (r) => `#${r.shipmentId.slice(0, 8).toUpperCase()}` },
    { key: "method", label: "Method", render: (r) => paymentMethodLabel(r.method) },
    { key: "amount", label: "Amount", render: (r) => fmtTZS(r.amount) },
    { key: "status", label: "Status", render: (r) => <Pill status={paymentStatusLabel(r.status)} /> },
  ];

  return (
    <div>
      <div className="rounded-xl px-4 py-3 mb-6 text-sm font-semibold" style={{ backgroundColor: COLORS.tealSoft, color: COLORS.teal }}>
        WAZZAR charges per delivery, not as a monthly subscription — every row below is a real payment tied to a real delivery (see Orders), not an invoice on a plan.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl p-5" style={{ backgroundColor: COLORS.ink }}>
          <p className="text-xs font-semibold" style={{ color: COLORS.paper, opacity: 0.6 }}>Paid this month</p>
          <p className="text-lg font-extrabold mt-1" style={{ color: COLORS.paper }}>{fmtTZS(paidThisMonth)}</p>
        </div>
        <div className="rounded-2xl p-5" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
          <p className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>Most-used method</p>
          <p className="text-base font-extrabold mt-1" style={{ color: COLORS.ink }}>{topMethod ? paymentMethodLabel(topMethod) : "—"}</p>
        </div>
        <div className="rounded-2xl p-5" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
          <p className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>Pending / awaiting</p>
          <p className="text-base font-extrabold mt-1" style={{ color: COLORS.ink }}>{pendingCount}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>Payment history</p>
        {payments.length > 0 && (
          <button
            onClick={() => downloadPaymentHistoryCsv(payments)}
            className="flex items-center gap-1.5 text-xs font-bold"
            style={{ color: COLORS.teal }}
          >
            <Download size={13} /> Export CSV
          </button>
        )}
      </div>
      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ backgroundColor: COLORS.coralSoft, color: COLORS.coral }}>
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: COLORS.teal }} />
        </div>
      ) : (
        <DataTable columns={cols} rows={payments} />
      )}
    </div>
  );
}

function SettingsPage({ business, setBusiness }) {
  return (
    <div className="max-w-xl">
      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>BUSINESS PROFILE</p>
      <div className="rounded-2xl p-5 mb-2" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="rounded-2xl flex items-center justify-center font-extrabold text-lg flex-shrink-0" style={{ width: 56, height: 56, backgroundColor: COLORS.teal, color: COLORS.paper }}>{initialsFor(business.name)}</div>
          <div>
            <p className="font-extrabold" style={{ color: COLORS.ink }}>{business.name}</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{business.category || "No category set"}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <input value={business.name} onChange={(e) => setBusiness({ ...business, name: e.target.value })} placeholder="Business name" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
          <input value={business.category} onChange={(e) => setBusiness({ ...business, category: e.target.value })} placeholder="Category (e.g. Online Retailer · Clothing)" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
          <input
            value={business.address}
            onChange={(e) => setBusiness({ ...business, address: e.target.value, addressCoord: null })}
            placeholder="Pickup address"
            className="rounded-xl px-4 py-3 text-sm font-semibold outline-none"
            style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }}
          />
        </div>
      </div>
      <p className="text-xs mb-6" style={{ color: COLORS.inkFaint }}>
        Synced to your account. The pickup address here pre-fills new deliveries; you'll confirm its exact location (via search) the first time you use it.
      </p>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>BULK ORDERS</p>
      <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold" style={{ color: COLORS.ink }}>CSV batch upload</p>
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: COLORS.paperDim, color: COLORS.inkFaint }}>Coming soon</span>
        </div>
        <p className="text-xs" style={{ color: COLORS.inkFaint }}>Upload a spreadsheet to create hundreds of deliveries at once.</p>
      </div>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>API ACCESS</p>
      <div className="rounded-2xl p-5" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold" style={{ color: COLORS.ink }}>API key</p>
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: COLORS.paperDim, color: COLORS.inkFaint }}>Coming soon</span>
        </div>
        <p className="text-xs" style={{ color: COLORS.inkFaint }}>Order directly from your own app or website once API access rolls out.</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Modals                                                                   */
/* ---------------------------------------------------------------------- */

function OrderModal({ order, onClose }) {
  if (!order) return null;
  const cancelled = order.rawStatus === "CANCELLED";
  const idx = cancelled ? -1 : milestoneIndex(order.rawStatus);

  return (
    <Modal title={order.id} onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <Pill status={order.status} />
        <span className="text-lg font-extrabold" style={{ color: COLORS.ink }}>{fmtTZS(order.fare)}</span>
      </div>

      {!cancelled && (
        <div className="flex items-center mb-6">
          {MILESTONES.map((m, i) => (
            <React.Fragment key={m.status}>
              <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 20, height: 20, backgroundColor: i <= idx ? COLORS.teal : COLORS.paperDim }}>
                {i <= idx && <Check size={11} color={COLORS.paper} />}
              </div>
              {i < MILESTONES.length - 1 && <div className="flex-1" style={{ height: 2, backgroundColor: i < idx ? COLORS.teal : COLORS.paperDim }} />}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Row label="Recipient" value={order.recipient} />
        <Row label="Phone" value={order.phone || "—"} />
        <Row label="Pickup" value={order.pickupAddress} />
        <Row label="Dropoff" value={order.address} />
        <Row label="Category" value={order.category} />
        <Row label="Rider" value={order.rider ? "Assigned" : "Not yet assigned"} />
        <Row label="Date" value={order.date} />
      </div>
    </Modal>
  );
}

// Shared by pickup + dropoff — a text field with live Nominatim
// suggestions. A location only counts as "set" once a suggestion has
// been picked (so the app always has real coordinates, never a
// free-typed address with no lat/lng behind it).
function AddressField({ label, placeholder, text, setText, coord, setCoord, near }) {
  const { results, loading } = usePlaceSearch(text, near);
  const resolved = !!coord;
  return (
    <div className="mb-4">
      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>{label}</p>
      <input
        value={text}
        onChange={(e) => { setText(e.target.value); setCoord(null); }}
        placeholder={placeholder}
        className="w-full rounded-xl px-4 py-3 text-sm font-semibold outline-none"
        style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }}
      />
      {text && !resolved && (
        <div className="mt-1 rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.paperDim}` }}>
          {loading && <div className="px-4 py-2 text-xs" style={{ color: COLORS.inkFaint }}>Searching…</div>}
          {!loading && results.length === 0 && text.trim().length >= 2 && (
            <div className="px-4 py-2 text-xs" style={{ color: COLORS.inkFaint }}>No matches — try a nearby landmark.</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.lat}-${r.lng}`}
              type="button"
              onClick={() => { setText(r.label); setCoord({ lat: r.lat, lng: r.lng }); }}
              className="w-full text-left px-4 py-2 text-xs font-semibold"
              style={{ backgroundColor: COLORS.paper, color: COLORS.ink }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      {resolved && <p className="text-xs mt-1 font-semibold" style={{ color: COLORS.teal }}>✓ Location set</p>}
    </div>
  );
}

const WEIGHT_KG_BY_SIZE = { Small: 1, Medium: 3, Large: 8 };

function NewDeliveryModal({ onClose, onCreated, onPickupResolved, savedContacts, business, businessPhone, onGoToScheduled }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dropoffText, setDropoffText] = useState("");
  const [dropoffCoord, setDropoffCoord] = useState(null);
  const [pickupText, setPickupText] = useState(business.address || "");
  const [pickupCoord, setPickupCoord] = useState(business.addressCoord || null);
  const [category, setCategory] = useState("Clothing");
  const [size, setSize] = useState("Small");
  const [scheduleMode, setScheduleMode] = useState("now");
  const [payMethod, setPayMethod] = useState("cash");
  const [payPhone, setPayPhone] = useState(businessPhone || "");

  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const pickContact = (c) => {
    setName(c.name);
    setPhone(c.phone);
    setDropoffText(c.address);
    setDropoffCoord(null); // saved contacts have no coordinates — force a real re-resolve
  };

  // Once the pickup point resolves to real coordinates, save it back to
  // the business profile so the next delivery starts pre-resolved
  // instead of asking the merchant to re-search their own store address
  // every single time.
  useEffect(() => {
    if (!pickupCoord) return;
    if (pickupText === business.address && pickupCoord.lat === business.addressCoord?.lat && pickupCoord.lng === business.addressCoord?.lng) return;
    onPickupResolved(pickupText, pickupCoord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupCoord?.lat, pickupCoord?.lng]);

  useEffect(() => {
    if (!pickupCoord || !dropoffCoord) { setQuote(null); return; }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const distanceKm = haversineKm(pickupCoord, dropoffCoord);
    api.calculatePrice({ distanceKm, weightKg: WEIGHT_KG_BY_SIZE[size] })
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch((err) => { if (!cancelled) setQuoteError(err.message || "Couldn't get a quote"); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupCoord?.lat, pickupCoord?.lng, dropoffCoord?.lat, dropoffCoord?.lng, size]);

  const ready = name.trim() && phone.trim() && !!pickupCoord && !!dropoffCoord && !submitting;

  const handleCreate = async () => {
    if (!ready) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const instruction = `Recipient: ${name.trim()}${phone.trim() ? ` · ${phone.trim()}` : ""}`;
      const shipment = await api.createShipment({
        pickupLocation: { latitude: pickupCoord.lat, longitude: pickupCoord.lng, address: pickupText },
        dropoffLocation: { latitude: dropoffCoord.lat, longitude: dropoffCoord.lng, address: dropoffText, instruction },
        packageWeightKg: WEIGHT_KG_BY_SIZE[size],
        packageDescription: category,
      });

      const payment = await api.initiatePayment({ shipmentId: shipment.id, uiMethod: payMethod, phone: payPhone });

      // Only MPESA confirms (via the demo webhook shim) and moves on to
      // dispatch in this pass — CASH legitimately stays at "Awaiting
      // Payment" until someone collects cash for real. See api.js.
      if (payMethod === "mpesa") {
        await api.simulateProviderConfirmation(payment);
        try {
          await api.requestDispatch(shipment.id);
        } catch (e) {
          // Non-fatal: the shipment exists and is paid either way.
        }
      }

      onCreated();
    } catch (err) {
      setSubmitError(err.message || "Couldn't create this delivery");
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New delivery" onClose={onClose} wide>
      {savedContacts.length > 0 && (
        <>
          <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>QUICK PICK</p>
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {savedContacts.map((c) => (
              <button key={c.id} onClick={() => pickContact(c)} className="rounded-full px-3 py-1.5 whitespace-nowrap flex-shrink-0" style={{ backgroundColor: COLORS.paperDim }}>
                <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipient name" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="rounded-xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
      </div>

      <AddressField label="PICKUP ADDRESS" placeholder="Where the rider collects the package" text={pickupText} setText={setPickupText} coord={pickupCoord} setCoord={setPickupCoord} near={dropoffCoord} />
      <AddressField label="DROPOFF ADDRESS" placeholder="Where the recipient is" text={dropoffText} setText={setDropoffText} coord={dropoffCoord} setCoord={setDropoffCoord} near={pickupCoord} />

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>PACKAGE</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {["Clothing", "Parcel", "Documents"].map((c) => (
          <button key={c} onClick={() => setCategory(c)} className="rounded-xl py-2.5" style={{ backgroundColor: category === c ? COLORS.teal : COLORS.paperDim }}>
            <span className="text-xs font-bold" style={{ color: category === c ? COLORS.paper : COLORS.inkFaint }}>{c}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        {["Small", "Medium", "Large"].map((s) => (
          <button key={s} onClick={() => setSize(s)} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: size === s ? COLORS.ink : COLORS.paperDim }}>
            <span className="text-xs font-bold" style={{ color: size === s ? COLORS.paper : COLORS.inkFaint }}>{s}</span>
          </button>
        ))}
      </div>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>TIMING</p>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setScheduleMode("now")} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: scheduleMode === "now" ? COLORS.teal : COLORS.paperDim }}>
          <span className="text-xs font-bold" style={{ color: scheduleMode === "now" ? COLORS.paper : COLORS.inkFaint }}>Send now</span>
        </button>
        <button
          onClick={onGoToScheduled}
          title="Set up a recurring delivery on the Scheduled deliveries page"
          className="flex-1 rounded-xl py-2.5 flex items-center justify-center gap-1.5"
          style={{ backgroundColor: COLORS.paperDim }}
        >
          <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>Make recurring…</span>
        </button>
      </div>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>PAYMENT METHOD</p>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setPayMethod("cash")} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: payMethod === "cash" ? COLORS.teal : COLORS.paperDim }}>
          <span className="text-xs font-bold" style={{ color: payMethod === "cash" ? COLORS.paper : COLORS.inkFaint }}>Cash on delivery</span>
        </button>
        <button onClick={() => setPayMethod("mpesa")} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: payMethod === "mpesa" ? COLORS.teal : COLORS.paperDim }}>
          <span className="text-xs font-bold" style={{ color: payMethod === "mpesa" ? COLORS.paper : COLORS.inkFaint }}>M-Pesa</span>
        </button>
      </div>
      {payMethod === "mpesa" && (
        <input value={payPhone} onChange={(e) => setPayPhone(e.target.value)} placeholder="M-Pesa phone number" className="w-full rounded-xl px-4 py-3 text-sm font-semibold outline-none mb-4" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
      )}

      <div className="flex items-center justify-between rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: COLORS.paperDim }}>
        <span className="text-sm font-semibold" style={{ color: COLORS.inkFaint }}>Estimated fare</span>
        {quoteLoading ? (
          <Loader2 size={16} color={COLORS.inkFaint} className="spin" />
        ) : (
          <span className="text-base font-extrabold" style={{ color: COLORS.ink }}>
            {quote ? fmtTZS(quote.price) : pickupCoord && dropoffCoord ? "—" : "Set both locations"}
          </span>
        )}
      </div>
      {quoteError && <ErrorBanner>{quoteError}</ErrorBanner>}
      {submitError && <ErrorBanner>{submitError}</ErrorBanner>}

      <button onClick={handleCreate} disabled={!ready} className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 font-bold text-sm" style={{ backgroundColor: ready ? COLORS.teal : COLORS.paperDim, color: ready ? COLORS.paper : COLORS.inkFaint }}>
        {submitting && <Loader2 size={15} className="spin" />}
        {submitting ? "Creating…" : "Create delivery"}
      </button>
    </Modal>
  );
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState(null); // { user }

  const [page, setPage] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState(null);

  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState(null);
  const [scheduled, setScheduled] = useState([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledError, setScheduledError] = useState(null);
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState(null);
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState(null);
  const [business, setBusinessState] = useState({ name: "My Business", category: "", address: "", addressCoord: null });

  const [newDeliveryOpen, setNewDeliveryOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Restore/validate session on load — a cached user renders the
  // dashboard immediately (no login-screen flash); GET /auth/me confirms
  // the token still works and falls back to the login screen if not.
  useEffect(() => {
    if (!api.isAuthenticated()) { setAuthChecked(true); return; }
    const cached = api.currentUser();
    if (cached) setSession({ user: cached });
    api.fetchCurrentUser()
      .then((user) => setSession({ user }))
      .catch(() => { api.logout(); setSession(null); })
      .finally(() => setAuthChecked(true));
  }, []);

  // Overview (with its chart) is the default landing page, so kick off the
  // DeliveriesChart chunk fetch as soon as we know a session exists, in
  // parallel with the profile/orders loads below, instead of waiting for
  // OverviewPage to mount and request it cold — keeps the code-split win
  // from 3a without adding a Suspense flash on nearly every login.
  useEffect(() => {
    if (session?.user) preloadDeliveriesChart();
  }, [session?.user]);

  // Business profile now loaded from backend (GET /business/profile).
  // Syncs across devices. Auto-creates a minimal profile if none exists.
  useEffect(() => {
    if (!session?.user?.id) return;
    api.getBusinessProfile()
      .then((profile) => {
        setBusinessState({
          name: profile.businessName || session.user.fullName || "My Business",
          category: profile.category || "",
          address: profile.pickupAddress || "",
          addressCoord: profile.pickupLatitude && profile.pickupLongitude
            ? { lat: profile.pickupLatitude, lng: profile.pickupLongitude }
            : null,
          // Store the profile ID so we can update it later (no longer localStorage keyed).
          backendId: profile.id,
        });
      })
      .catch((err) => {
        // Fallback if profile fetch fails — initialize empty, will retry on save
        console.error("Failed to load profile:", err);
        setBusinessState({
          name: session.user.fullName || "My Business",
          category: "",
          address: "",
          addressCoord: null,
        });
      });
  }, [session?.user?.id]);

  const setBusiness = (next) => {
    setBusinessState(next);
    // Auto-save to backend when profile changes. For now, fire-and-forget
    // (a more polished UX might show a "saving..." indicator or queue edits).
    if (session?.user?.id) {
      api.updateBusinessProfile({
        businessName: next.name,
        category: next.category || null,
        pickupAddress: next.address || null,
        pickupLatitude: next.addressCoord?.lat || null,
        pickupLongitude: next.addressCoord?.lng || null,
      }).catch((err) => {
        console.error("Failed to save profile:", err);
      });
    }
  };

  const refreshOrders = () => {
    setOrdersLoading(true);
    setOrdersError(null);
    return api.listShipments({ limit: 100 })
      .then((rows) => setOrders(rows.map(mapShipmentToOrder)))
      .catch((err) => setOrdersError(err.message || "Request failed"))
      .finally(() => setOrdersLoading(false));
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    refreshOrders();
    // Light polling so status changes (rider assigned, delivered, etc.)
    // show up without a manual refresh — no WebSocket wired up for this
    // app in this pass (the customer app's /tracking namespace is
    // per-shipment and rider-location-focused; a dashboard-wide feed
    // would be a reasonable next piece, not this one).
    const id = setInterval(refreshOrders, 20000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    setCustomersLoading(true);
    setCustomersError(null);
    api.listCustomers()
      .then(setCustomers)
      .catch((err) => setCustomersError(err.message || "Couldn't load customers"))
      .finally(() => setCustomersLoading(false));
  }, [session?.user?.id]);

  const handleCustomerAdded = (created) => setCustomers((prev) => [created, ...prev]);

  const handleCustomerDelete = (id) => {
    // Optimistic-ish: only remove from state once the delete actually
    // succeeds, so a failed request (network blip, or someone else's
    // entry somehow — shouldn't happen given server-side ownership
    // checks, but don't assume) doesn't silently desync the list.
    return api.deleteCustomer(id)
      .then(() => setCustomers((prev) => prev.filter((c) => c.id !== id)))
      .catch((err) => setCustomersError(err.message || "Couldn't remove this customer"));
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    setStaffLoading(true);
    setStaffError(null);
    api.listStaff()
      .then(setStaff)
      .catch((err) => setStaffError(err.message || "Couldn't load staff"))
      .finally(() => setStaffLoading(false));
  }, [session?.user?.id]);

  const handleStaffAdded = (created) => setStaff((prev) => [created, ...prev]);

  const handleStaffToggleActive = (row) => {
    const nextStatus = row.status === "ACTIVE" ? "PENDING" : "ACTIVE";
    return api.updateStaff(row.id, { status: nextStatus })
      .then((updated) => setStaff((prev) => prev.map((s) => (s.id === row.id ? updated : s))))
      .catch((err) => setStaffError(err.message || "Couldn't update this team member"));
  };

  const handleStaffRemove = (id) => {
    return api.removeStaff(id)
      .then(() => setStaff((prev) => prev.filter((s) => s.id !== id)))
      .catch((err) => setStaffError(err.message || "Couldn't remove this team member"));
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    setScheduledLoading(true);
    setScheduledError(null);
    api.listScheduledDeliveries()
      .then(setScheduled)
      .catch((err) => setScheduledError(err.message || "Couldn't load schedules"))
      .finally(() => setScheduledLoading(false));
  }, [session?.user?.id]);

  const handleScheduleAdded = (created) => setScheduled((prev) => [created, ...prev]);

  const handleScheduleToggleActive = (row) => {
    return api.updateScheduledDelivery(row.id, { active: !row.active })
      .then((updated) => setScheduled((prev) => prev.map((s) => (s.id === row.id ? updated : s))))
      .catch((err) => setScheduledError(err.message || "Couldn't update this schedule"));
  };

  const handleScheduleDelete = (id) => {
    return api.deleteScheduledDelivery(id)
      .then(() => setScheduled((prev) => prev.filter((s) => s.id !== id)))
      .catch((err) => setScheduledError(err.message || "Couldn't remove this schedule"));
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    setPaymentsLoading(true);
    setPaymentsError(null);
    api.listPaymentHistory({ limit: 100 })
      .then(setPayments)
      .catch((err) => setPaymentsError(err.message || "Couldn't load payment history"))
      .finally(() => setPaymentsLoading(false));
  }, [session?.user?.id]);

  const handleLogout = () => {
    api.logout();
    setSession(null);
    setOrders([]);
  };

  if (!authChecked) return <SplashScreen />;
  if (!session) return <LoginScreen onAuthed={(user) => setSession({ user })} />;

  const stats = statsFor(orders);
  const chartData = weeklyChartData(orders);

  const titles = { overview: "Overview", orders: "Orders", customers: "Customers", scheduled: "Scheduled deliveries", staff: "Staff", billing: "Billing", settings: "Settings" };

  let pageContent;
  if (page === "overview") pageContent = <OverviewPage orders={orders} stats={stats} chartData={chartData} loading={ordersLoading} error={ordersError} onNewDelivery={() => setNewDeliveryOpen(true)} onOpenOrder={setSelectedOrder} setPage={setPage} />;
  else if (page === "orders") pageContent = <OrdersPage orders={orders} loading={ordersLoading} error={ordersError} onNewDelivery={() => setNewDeliveryOpen(true)} onOpenOrder={setSelectedOrder} />;
  else if (page === "customers") pageContent = <CustomersPage customers={customers} loading={customersLoading} error={customersError} onAdd={handleCustomerAdded} onDelete={handleCustomerDelete} />;
  else if (page === "scheduled") pageContent = <ScheduledPage scheduled={scheduled} loading={scheduledLoading} error={scheduledError} onAdd={handleScheduleAdded} onToggleActive={handleScheduleToggleActive} onDelete={handleScheduleDelete} business={business} />;
  else if (page === "staff") pageContent = <StaffPage staff={staff} loading={staffLoading} error={staffError} onAdd={handleStaffAdded} onToggleActive={handleStaffToggleActive} onRemove={handleStaffRemove} />;
  else if (page === "billing") pageContent = <BillingPage payments={payments} loading={paymentsLoading} error={paymentsError} />;
  else if (page === "settings") pageContent = <SettingsPage business={business} setBusiness={setBusiness} />;

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: COLORS.paperDim, fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Manrope', sans-serif; box-sizing: border-box; }
        .tr-row:hover { background-color: ${COLORS.paperDim}; }
        .modal-pop { animation: modalpop 0.18s ease-out; }
        @keyframes modalpop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background-color: #C9C2AE; border-radius: 8px; }
        @media (prefers-reduced-motion: reduce) {
          .modal-pop { animation: none !important; }
          .spin { animation: none !important; }
        }
      `}</style>

      <Sidebar page={page} setPage={setPage} open={sidebarOpen} setOpen={setSidebarOpen} user={session.user} business={business} onLogout={handleLogout} />

      <div className="flex flex-col min-h-screen lg:pl-60">
        <TopBar title={titles[page]} onMenuClick={() => setSidebarOpen(true)} onNewDelivery={() => setNewDeliveryOpen(true)} />
        <div className="flex-1 p-5 lg:p-8">{pageContent}</div>
      </div>

      {newDeliveryOpen && (
        <NewDeliveryModal
          onClose={() => setNewDeliveryOpen(false)}
          onCreated={() => { setNewDeliveryOpen(false); refreshOrders(); }}
          onPickupResolved={(address, addressCoord) => setBusiness({ ...business, address, addressCoord })}
          savedContacts={customers}
          business={business}
          businessPhone={session.user.phone}
          onGoToScheduled={() => { setNewDeliveryOpen(false); setPage("scheduled"); }}
        />
      )}
      {selectedOrder && <OrderModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
    </div>
  );
}

export default App;
