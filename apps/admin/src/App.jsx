/* ========================================================================
   WAZZAR ADMIN CONSOLE — wired to the real backend.

   What "wired" means here: every page below either calls a real endpoint
   in wazzar-backend/backend, or is an honest "not available" state
   explaining which backend module is missing. Nothing renders fabricated
   data. See README_ADMIN_WIRING.md for the full endpoint-by-endpoint
   breakdown and what a full Customers/Businesses/Analytics build would
   need on the backend side. (Support/ticketing now has a real backend
   module and is fully wired below — see the Support page.)

   Known real gaps this app works around, on purpose:
   - No GET /shipments (list) for admins — the backend hard-scopes that
     route to the caller's own customerId. Deliveries is a lookup-by-ID
     page, seeded with real IDs from the dispatch queue.
   - No GET /riders (list) or GET /riders/:id at all. Riders is a
     verify-by-ID action, plus the online/active subset the dispatch
     queue happens to return.
   - No GET /payments (list). Finance is lookup-by-ID plus the real
     GET /payments/reconcile/:date report.
   - Rider records have no name field in the database — only vehicle/
     license/rating — so riders are shown by ID + vehicle, not by name.
   ======================================================================== */

import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  Search, ChevronRight, Banknote, Bike, Package, TrendingUp,
  Users, Menu, Bell, X, Activity, Briefcase, LifeBuoy, AlertTriangle, Tag,
  RefreshCw, LogOut, Loader2, Lock,
} from "lucide-react";
import * as api from "./api";

// Lazy: keeps `recharts` out of the main bundle (it's the single cause
// of Rollup's >500kB chunk warning on this app) — only fetched as its
// own chunk when the Analytics tab actually renders. See RevenueChart.jsx.
const RevenueChart = lazy(() => import("./RevenueChart"));

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

const fmtTZS = (n) => `TZS ${Number(n || 0).toLocaleString("en-US")}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");

const NAV = [
  { id: "dispatch", label: "Dispatch", icon: Activity },
  { id: "deliveries", label: "Deliveries", icon: Package },
  { id: "riders", label: "Riders", icon: Bike },
  { id: "finance", label: "Finance", icon: Banknote },
  { id: "pricing", label: "Pricing", icon: Tag },
  { id: "analytics", label: "Analytics", icon: TrendingUp },
  { id: "customers", label: "Customers", icon: Users },
  { id: "businesses", label: "Businesses", icon: Briefcase },
  { id: "support", label: "Support", icon: LifeBuoy },
];

const NOT_WIRED = {};

/* ---------------------------------------------------------------------- */
/* Shared primitives                                                       */
/* ---------------------------------------------------------------------- */

const PILL_STYLES = {
  // Shipment statuses
  CREATED: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  QUOTED: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  CONFIRMED: { bg: COLORS.tealSoft, text: COLORS.teal },
  ASSIGNMENT_PENDING: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  ASSIGNED: { bg: COLORS.tealSoft, text: COLORS.teal },
  PICKUP_IN_PROGRESS: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  PICKED_UP: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  IN_TRANSIT: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  OUT_FOR_DELIVERY: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  DELIVERED: { bg: COLORS.greenSoft, text: COLORS.green },
  COMPLETED: { bg: COLORS.greenSoft, text: COLORS.green },
  CANCELLED: { bg: COLORS.coralSoft, text: COLORS.coral },
  // Rider statuses
  ONBOARDING: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  ACTIVE: { bg: COLORS.greenSoft, text: COLORS.green },
  INACTIVE: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  SUSPENDED: { bg: COLORS.coralSoft, text: COLORS.coral },
  // Payment statuses
  PENDING: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  PROCESSING: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  FAILED: { bg: COLORS.coralSoft, text: COLORS.coral },
  REFUNDED: { bg: COLORS.coralSoft, text: COLORS.coral },
  PARTIALLY_REFUNDED: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  PENDING_CASH_COLLECTION: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  // Support ticket statuses
  OPEN: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  IN_PROGRESS: { bg: COLORS.tealSoft, text: COLORS.teal },
  RESOLVED: { bg: COLORS.greenSoft, text: COLORS.green },
  CLOSED: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  // Support ticket priorities (share the pill component; distinct keys)
  LOW: { bg: COLORS.paperDim, text: COLORS.inkFaint },
  MEDIUM: { bg: COLORS.tealSoft, text: COLORS.teal },
  HIGH: { bg: COLORS.amberSoft, text: COLORS.amberDeep },
  URGENT: { bg: COLORS.coralSoft, text: COLORS.coral },
  // Rider per-document review statuses (share PENDING with payments above)
  APPROVED: { bg: COLORS.greenSoft, text: COLORS.green },
  REJECTED: { bg: COLORS.coralSoft, text: COLORS.coral },
};

function Pill({ status }) {
  const s = PILL_STYLES[status] || { bg: COLORS.paperDim, text: COLORS.inkFaint };
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap" style={{ backgroundColor: s.bg, color: s.text }}>
      {status}
    </span>
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

function DataTable({ columns, rows, onRowClick, emptyLabel = "No records." }) {
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
                  {emptyLabel}
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

function Modal({ title, onClose, children, maxWidth = 420 }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(16,34,28,0.5)", zIndex: 60 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-2xl w-full overflow-y-auto modal-pop" style={{ backgroundColor: COLORS.paper, maxWidth, maxHeight: "85vh" }}>
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
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-semibold flex-shrink-0" style={{ color: COLORS.inkFaint }}>{label}</span>
      <span className="text-sm font-semibold text-right" style={{ color: COLORS.ink, wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  backgroundColor: COLORS.paperDim,
  color: COLORS.ink,
  border: `1px solid ${COLORS.paperDim}`,
};
const inputClass = "rounded-xl px-3 py-2.5 text-sm outline-none w-full";

function PrimaryButton({ children, onClick, disabled, tone = "teal", type = "button" }) {
  const toneMap = {
    teal: { bg: COLORS.teal, text: COLORS.paper },
    coral: { bg: COLORS.coral, text: COLORS.paper },
    ink: { bg: COLORS.ink, text: COLORS.paper },
  };
  const t = toneMap[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
      style={{ backgroundColor: t.bg, color: t.text }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-50"
      style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }}
    >
      {children}
    </button>
  );
}

function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="animate-spin" color={COLORS.teal} />;
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-xl px-4 py-3 mb-4 text-sm font-semibold" style={{ backgroundColor: COLORS.coralSoft, color: COLORS.coral }}>
      {message}
    </div>
  );
}

function NotWiredPage({ pageId }) {
  return (
    <div className="rounded-2xl p-8 flex flex-col items-center text-center gap-3" style={{ backgroundColor: COLORS.paper, border: `1px dashed ${COLORS.paperDim}` }}>
      <Lock size={22} color={COLORS.inkFaint} />
      <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>Not wired up yet</p>
      <p className="text-sm max-w-md" style={{ color: COLORS.inkFaint }}>{NOT_WIRED[pageId]}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Data hook — manual fetch with loading/error, no silent fallback data   */
/* ---------------------------------------------------------------------- */

function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const reload = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((err) => { if (!cancelled) setState({ data: null, loading: false, error: err.message }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);

  return { ...state, reload };
}

/* ---------------------------------------------------------------------- */
/* Login                                                                    */
/* ---------------------------------------------------------------------- */

function LoginScreen({ onLoggedIn }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await api.login(phone, password);
      onLoggedIn(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-5" style={{ backgroundColor: COLORS.paperDim, fontFamily: "'Manrope', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap'); * { font-family: 'Manrope', sans-serif; box-sizing: border-box; }`}</style>
      <form onSubmit={submit} className="w-full rounded-2xl p-6 flex flex-col gap-4" style={{ maxWidth: 380, backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <div>
          <div className="rounded-xl flex items-center justify-center font-extrabold mb-3" style={{ width: 40, height: 40, backgroundColor: COLORS.amber, color: COLORS.ink }}>T</div>
          <p className="text-lg font-extrabold" style={{ color: COLORS.ink }}>WAZZAR Admin</p>
          <p className="text-xs mt-1" style={{ color: COLORS.inkFaint }}>
            Sign in with an account that already has the ADMIN, SUPER_ADMIN, or DISPATCHER role.
            There is no admin self-signup — that role is granted out-of-band by an existing admin
            (see the backend README's "Known simplifications").
          </p>
        </div>
        <ErrorBanner message={error} />
        <Field label="Phone">
          <input className={inputClass} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255712345678" required />
        </Field>
        <Field label="Password">
          <input className={inputClass} style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? <Spinner size={14} /> : "Sign in"}
        </PrimaryButton>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Layout                                                                   */
/* ---------------------------------------------------------------------- */

function Sidebar({ page, setPage, open, setOpen, user, onLogout }) {
  return (
    <>
      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 lg:hidden z-40" style={{ backgroundColor: "rgba(16,34,28,0.5)" }} />}
      <div
        className={`fixed top-0 left-0 h-screen w-60 flex flex-col z-50 transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ backgroundColor: COLORS.ink }}
      >
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <div className="rounded-xl flex items-center justify-center font-extrabold flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.amber, color: COLORS.ink }}>T</div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: COLORS.paper }}>WAZZAR</p>
            <p className="text-xs" style={{ color: COLORS.paper, opacity: 0.5 }}>Admin Console</p>
          </div>
        </div>
        <div className="flex-1 px-3 flex flex-col gap-1 overflow-y-auto">
          {NAV.map((n) => {
            const active = page === n.id;
            const disabled = !!NOT_WIRED[n.id];
            return (
              <button
                key={n.id}
                onClick={() => { setPage(n.id); setOpen(false); }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ backgroundColor: active ? COLORS.inkSoft : "transparent" }}
              >
                <n.icon size={17} color={COLORS.teal} strokeWidth={active ? 2.4 : 2} style={{ opacity: active ? 1 : 0.55 }} />
                <span className="text-sm font-semibold flex-1 text-left" style={{ color: COLORS.paper, opacity: active ? 1 : 0.7 }}>{n.label}</span>
                {disabled && <Lock size={12} color={COLORS.paper} style={{ opacity: 0.35 }} />}
              </button>
            );
          })}
        </div>
        <div className="px-5 py-5 flex items-center gap-3" style={{ borderTop: `1px solid ${COLORS.inkSoft}` }}>
          <div className="rounded-full flex items-center justify-center font-extrabold text-xs flex-shrink-0" style={{ width: 32, height: 32, backgroundColor: COLORS.teal, color: COLORS.paper }}>
            {(user?.fullName || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate" style={{ color: COLORS.paper }}>{user?.fullName}</p>
            <p className="text-xs truncate" style={{ color: COLORS.paper, opacity: 0.5 }}>{(user?.roles || []).join(", ")}</p>
          </div>
          <button onClick={onLogout} className="flex-shrink-0" title="Log out">
            <LogOut size={15} color={COLORS.paper} style={{ opacity: 0.6 }} />
          </button>
        </div>
      </div>
    </>
  );
}

function TopBar({ title, onMenuClick, onRefresh, refreshing }) {
  return (
    <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ backgroundColor: COLORS.paper, borderBottom: `1px solid ${COLORS.paperDim}`, zIndex: 30 }}>
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="lg:hidden rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paperDim }}>
          <Menu size={18} color={COLORS.ink} />
        </button>
        <h1 className="text-lg font-extrabold" style={{ color: COLORS.ink }}>{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button onClick={onRefresh} className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paperDim }}>
            <RefreshCw size={15} color={COLORS.ink} className={refreshing ? "animate-spin" : ""} />
          </button>
        )}
        <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paperDim }}>
          <Bell size={16} color={COLORS.ink} />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dispatch page — GET /dispatch/queue                                     */
/* ---------------------------------------------------------------------- */

const PENDING_COLUMNS = [
  { key: "id", label: "Shipment", render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}…</span> },
  { key: "pickup", label: "Pickup", render: (r) => r.pickupLocation?.address || "—" },
  { key: "dropoff", label: "Dropoff", render: (r) => r.dropoffLocation?.address || "—" },
  { key: "weight", label: "Weight", render: (r) => (r.packageWeightKg ? `${r.packageWeightKg} kg` : "—") },
  { key: "createdAt", label: "Created", render: (r) => fmtDate(r.createdAt) },
];

const ONLINE_RIDER_COLUMNS = [
  { key: "id", label: "Rider", render: (r) => <span className="font-mono text-xs">{r.id.slice(0, 8)}…</span> },
  { key: "vehicleType", label: "Vehicle", render: (r) => r.vehicleType || "—" },
  { key: "vehicleRegistration", label: "Plate", render: (r) => r.vehicleRegistration || "—" },
  { key: "ratingAvg", label: "Rating", render: (r) => (r.ratingAvg ? Number(r.ratingAvg).toFixed(1) : "—") },
];

function AssignModal({ shipment, onClose, onAssigned }) {
  const { data: candidates, loading, error } = useLoad(() => api.getDispatchCandidates(shipment.id), [shipment.id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const doAssign = async (riderId) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.assignShipment(shipment.id, riderId, `Dispatched by admin console`);
      onAssigned();
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  };

  const doAutoAssign = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.autoAssignShipment(shipment.id, `Auto-assigned via admin console`);
      onAssigned();
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Assign shipment ${shipment.id.slice(0, 8)}…`} onClose={onClose}>
      <div className="flex flex-col gap-3 mb-4">
        <Row label="Pickup" value={shipment.pickupLocation?.address} />
        <Row label="Dropoff" value={shipment.dropoffLocation?.address} />
      </div>
      <ErrorBanner message={actionError} />
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : candidates.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: COLORS.inkFaint }}>No online, active riders available to offer this to right now.</p>
      ) : (
        <>
          <p className="text-xs font-bold mb-2" style={{ color: COLORS.inkFaint }}>Ranked candidates (nearest pickup first)</p>
          <div className="flex flex-col gap-2 mb-4">
            {candidates.map((c, i) => (
              <div key={c.id} className="rounded-xl px-3 py-2.5 flex items-center justify-between gap-3" style={{ backgroundColor: COLORS.paperDim }}>
                <div>
                  <p className="text-sm font-bold" style={{ color: COLORS.ink }}>#{i + 1} · {c.vehicleType || "Rider"} {c.vehicleRegistration || ""}</p>
                  <p className="text-xs font-mono" style={{ color: COLORS.inkFaint }}>{c.id}</p>
                </div>
                <button disabled={busy} onClick={() => doAssign(c.id)} className="rounded-lg px-3 py-1.5 text-xs font-bold flex-shrink-0 disabled:opacity-50" style={{ backgroundColor: COLORS.teal, color: COLORS.paper }}>
                  Assign
                </button>
              </div>
            ))}
          </div>
          <PrimaryButton onClick={doAutoAssign} disabled={busy} tone="ink">
            {busy ? <Spinner size={14} /> : "Auto-assign top candidate"}
          </PrimaryButton>
        </>
      )}
    </Modal>
  );
}

function DispatchPage() {
  const { data, loading, error, reload } = useLoad(() => api.getDispatchQueue(), []);
  const [assignTarget, setAssignTarget] = useState(null);

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>;
  if (error) return <ErrorBanner message={error} />;

  const { pendingShipments, onlineRiders } = data;

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard icon={Package} label="Awaiting dispatch" value={pendingShipments.length} />
        <StatCard icon={Bike} label="Online & active riders" value={onlineRiders.length} />
      </div>

      <p className="text-sm font-extrabold mb-3" style={{ color: COLORS.ink }}>Pending shipments</p>
      <p className="text-xs mb-3" style={{ color: COLORS.inkFaint }}>Click a row to see ranked candidates and assign a rider.</p>
      <DataTable columns={PENDING_COLUMNS} rows={pendingShipments} onRowClick={setAssignTarget} emptyLabel="Nothing waiting on dispatch." />

      <p className="text-sm font-extrabold mb-3 mt-6" style={{ color: COLORS.ink }}>Online riders</p>
      <DataTable columns={ONLINE_RIDER_COLUMNS} rows={onlineRiders} emptyLabel="No riders currently online." />

      {assignTarget && (
        <AssignModal
          shipment={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => { setAssignTarget(null); reload(); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Deliveries page — no list endpoint exists, so this is a lookup-by-ID    */
/* page. Pending shipment IDs from the dispatch queue are offered as       */
/* quick picks since they're real IDs an admin can actually use.           */
/* ---------------------------------------------------------------------- */

const SHIPMENT_STATUS_OPTIONS = [
  "CREATED", "QUOTED", "CONFIRMED", "ASSIGNMENT_PENDING",
  "PICKUP_IN_PROGRESS", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY",
  "COMPLETED", "CANCELLED",
];

function ShipmentDetail({ id, onChanged }) {
  const { data: shipment, loading, error, reload } = useLoad(() => api.getShipment(id), [id]);
  const { data: history } = useLoad(() => api.getShipmentHistory(id), [id]);
  const [nextStatus, setNextStatus] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [pod, setPod] = useState(undefined); // undefined = not fetched, null = fetched, none

  useEffect(() => {
    if (shipment && (shipment.status === "DELIVERED" || shipment.status === "COMPLETED")) {
      api.getProofOfDelivery(id).then(setPod).catch(() => setPod(null));
    } else {
      setPod(undefined);
    }
  }, [shipment, id]);

  const submitStatus = async (e) => {
    e.preventDefault();
    if (!nextStatus) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.updateShipmentStatus(id, nextStatus, reason || undefined);
      setNextStatus("");
      setReason("");
      reload();
      onChanged?.();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-10"><Spinner size={22} /></div>;
  if (error) return <ErrorBanner message={error} />;
  if (!shipment) return null;

  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-xs" style={{ color: COLORS.inkFaint }}>{shipment.id}</span>
        <Pill status={shipment.status} />
      </div>
      <div className="flex flex-col gap-3 mb-5">
        <Row label="Customer ID" value={shipment.customerId} />
        <Row label="Rider ID" value={shipment.riderId || "Not yet assigned"} />
        <Row label="Pickup" value={shipment.pickupLocation?.address} />
        <Row label="Dropoff" value={shipment.dropoffLocation?.address} />
        <Row label="Weight" value={shipment.packageWeightKg ? `${shipment.packageWeightKg} kg` : "—"} />
        <Row label="Price" value={shipment.price ? fmtTZS(shipment.price) : "—"} />
        <Row label="Commission" value={shipment.commission ? fmtTZS(shipment.commission) : "—"} />
        <Row label="Rider payout" value={shipment.riderPayout ? fmtTZS(shipment.riderPayout) : "—"} />
        <Row label="Created" value={fmtDate(shipment.createdAt)} />
        <Row label="Delivered" value={fmtDate(shipment.deliveredAt)} />
      </div>

      {pod && (
        <div className="rounded-xl p-3 mb-5" style={{ backgroundColor: COLORS.tealSoft }}>
          <p className="text-xs font-bold mb-1" style={{ color: COLORS.teal }}>Proof of delivery</p>
          <p className="text-xs" style={{ color: COLORS.teal }}>Recipient: {pod.recipientName || "—"}</p>
        </div>
      )}

      {history && history.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-bold mb-2" style={{ color: COLORS.inkFaint }}>History</p>
          <div className="flex flex-col gap-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-xs" style={{ color: COLORS.inkFaint }}>
                <span><Pill status={h.status} /> {h.reason ? `— ${h.reason}` : ""}</span>
                <span>{fmtDate(h.changedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submitStatus} className="flex flex-col gap-3 pt-4" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
        <p className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>
          Update status (ASSIGNED and DELIVERED aren't reachable here — use Dispatch to assign, and the rider deliver flow for delivery)
        </p>
        <ErrorBanner message={actionError} />
        <div className="flex gap-2">
          <select className={inputClass} style={inputStyle} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
            <option value="">Choose next status…</option>
            {SHIPMENT_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input className={inputClass} style={inputStyle} placeholder="Reason (optional, goes on the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy || !nextStatus}>
          {busy ? <Spinner size={14} /> : "Update status"}
        </PrimaryButton>
      </form>
    </div>
  );
}

function DeliveriesPage() {
  const [lookupInput, setLookupInput] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [quickPicks, setQuickPicks] = useState([]);

  useEffect(() => {
    api.getDispatchQueue()
      .then((q) => setQuickPicks(q.pendingShipments || []))
      .catch(() => {});
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (lookupInput.trim()) setActiveId(lookupInput.trim());
  };

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: COLORS.inkFaint }}>
        There's no "list all shipments" endpoint an admin can call — paste a shipment ID to look it up.
      </p>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-xl px-3 py-2 mb-4" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <Search size={15} color={COLORS.inkFaint} />
        <input value={lookupInput} onChange={(e) => setLookupInput(e.target.value)} placeholder="Shipment ID (UUID)" className="flex-1 bg-transparent outline-none text-sm font-mono" style={{ color: COLORS.ink }} />
        <SecondaryButton type="submit">Look up</SecondaryButton>
      </form>

      {quickPicks.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-bold mb-2" style={{ color: COLORS.inkFaint }}>Quick picks — pending shipments from the dispatch queue</p>
          <div className="flex gap-2 flex-wrap">
            {quickPicks.map((s) => (
              <button key={s.id} onClick={() => { setLookupInput(s.id); setActiveId(s.id); }} className="rounded-full px-3 py-1.5 text-xs font-mono" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }}>
                {s.id.slice(0, 8)}…
              </button>
            ))}
          </div>
        </div>
      )}

      {activeId && <ShipmentDetail id={activeId} onChanged={() => {}} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Riders page — still no list endpoint, so lookup is by-ID. GET           */
/* /riders/:id now exists though, so a looked-up rider shows full detail:  */
/* document URLs, per-document review state, and the whole-application     */
/* verify action — plus the online-riders subset the dispatch queue        */
/* happens to expose.                                                      */
/* ---------------------------------------------------------------------- */

const RIDER_DOCUMENTS = [
  { type: "ID", label: "ID document", urlKey: "idDocumentUrl" },
  { type: "LICENSE", label: "Driving license", urlKey: "licenseDocumentUrl" },
  { type: "VEHICLE_REGISTRATION", label: "Vehicle registration", urlKey: "vehicleRegistrationDocumentUrl" },
  { type: "INSURANCE", label: "Insurance", urlKey: "insuranceDocumentUrl" },
];

function RiderDocumentRow({ rider, doc, onReviewed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const url = rider[doc.urlKey];
  const review = rider.documentReviews?.[doc.type];
  const status = review?.status || "PENDING";

  const decide = async (decision) => {
    setError(null);
    let reason;
    if (decision === "REJECTED") {
      reason = window.prompt(`Reason for rejecting ${doc.label.toLowerCase()}:`);
      if (!reason || !reason.trim()) return;
    }
    setBusy(true);
    try {
      const updated = await api.reviewRiderDocument(rider.id, doc.type, decision, reason);
      onReviewed(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-3" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold" style={{ color: COLORS.ink }}>{doc.label}</p>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold underline" style={{ color: COLORS.teal }}>
              View document
            </a>
          ) : (
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>Not uploaded</p>
          )}
          {review?.reason && (
            <p className="text-xs mt-1" style={{ color: COLORS.coral }}>Reason: {review.reason}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Pill status={status} />
          {url && (
            <>
              <SecondaryButton onClick={() => decide("APPROVED")} disabled={busy}>
                {busy ? <Spinner size={12} /> : "Approve"}
              </SecondaryButton>
              <PrimaryButton tone="coral" onClick={() => decide("REJECTED")} disabled={busy}>
                Reject
              </PrimaryButton>
            </>
          )}
        </div>
      </div>
      <ErrorBanner message={error} />
    </div>
  );
}

function RiderLookupResult({ rider, onChanged }) {
  const [current, setCurrent] = useState(rider);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState(null);

  const verify = async () => {
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      const updated = await api.verifyRider(current.id);
      setCurrent(updated);
      onChanged();
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{current.vehicleType || "Rider"} · {current.vehicleRegistration || "—"}</p>
          <p className="text-xs font-mono" style={{ color: COLORS.inkFaint }}>{current.id}</p>
        </div>
        <Pill status={current.status} />
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <Row label="License number" value={current.licenseNumber || "—"} />
        <Row label="Insurance expires" value={current.insuranceExpiresAt || "—"} />
        <Row label="Documents verified" value={fmtDate(current.documentsVerifiedAt)} />
      </div>

      <ErrorBanner message={verifyError} />
      {current.status !== "ACTIVE" && (
        <div className="mb-4">
          <PrimaryButton onClick={verify} disabled={verifyBusy}>
            {verifyBusy ? <Spinner size={14} /> : "Verify whole application → ACTIVE"}
          </PrimaryButton>
        </div>
      )}

      <p className="text-xs font-bold mb-1" style={{ color: COLORS.inkFaint }}>Documents</p>
      <p className="text-xs mb-2" style={{ color: COLORS.inkFaint }}>
        Per-document approve/reject is independent of the whole-application verify above — use it
        to record a decision on one document without blocking the rest.
      </p>
      <div>
        {RIDER_DOCUMENTS.map((doc) => (
          <RiderDocumentRow key={doc.type} rider={current} doc={doc} onReviewed={setCurrent} />
        ))}
      </div>
    </div>
  );
}

function RidersPage() {
  const { data: queue, loading, error, reload: reloadQueue } = useLoad(() => api.getDispatchQueue(), []);
  const [riderId, setRiderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [rider, setRider] = useState(null);
  const [lookupError, setLookupError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!riderId.trim()) return;
    setBusy(true);
    setLookupError(null);
    setRider(null);
    try {
      const found = await api.getRider(riderId.trim());
      setRider(found);
    } catch (err) {
      setLookupError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <p className="text-sm font-extrabold mb-1" style={{ color: COLORS.ink }}>Look up a rider</p>
        <p className="text-xs mb-4" style={{ color: COLORS.inkFaint }}>
          The backend still has no rider list endpoint — an admin needs the rider's ID from
          elsewhere (support contact, onboarding record, or the online riders below) to look one
          up, verify their whole application, or approve/reject individual documents.
        </p>
        <ErrorBanner message={lookupError} />
        <form onSubmit={submit} className="flex gap-2">
          <input className={inputClass} style={inputStyle} placeholder="Rider ID (UUID)" value={riderId} onChange={(e) => setRiderId(e.target.value)} />
          <PrimaryButton type="submit" disabled={busy}>{busy ? <Spinner size={14} /> : "Look up"}</PrimaryButton>
        </form>
      </div>

      {rider && <RiderLookupResult key={rider.id} rider={rider} onChanged={reloadQueue} />}

      <p className="text-sm font-extrabold mb-3" style={{ color: COLORS.ink }}>Online riders</p>
      <p className="text-xs mb-3" style={{ color: COLORS.inkFaint }}>
        Only riders who are ACTIVE and currently toggled online show up here — this is what
        GET /dispatch/queue returns, not a full rider directory. Riders have no name field in the
        database, so they're shown by ID and vehicle.
      </p>
      {loading ? (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <DataTable columns={ONLINE_RIDER_COLUMNS} rows={queue.onlineRiders} emptyLabel="No riders currently online." />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Finance page — GET /payments/reconcile/:date, plus lookup-by-ID for     */
/* refund / collect-cash. No GET /payments (list) endpoint exists.         */
/* ---------------------------------------------------------------------- */

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function RefundModal({ payment, onClose, onDone }) {
  const remaining = Number(payment.amount) - Number(payment.refundedAmount || 0);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.refundPayment(payment.id, reason, amount ? Number(amount) : undefined);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Issue refund" onClose={onClose}>
      <p className="text-xs mb-4" style={{ color: COLORS.inkFaint }}>Remaining refundable: {fmtTZS(remaining)}</p>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Reason (required)">
          <input className={inputClass} style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        <Field label="Amount (leave blank for full remaining refund)">
          <input className={inputClass} style={inputStyle} type="number" step="0.01" min="0.01" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <PrimaryButton type="submit" tone="coral" disabled={busy}>{busy ? <Spinner size={14} /> : "Issue refund"}</PrimaryButton>
      </form>
    </Modal>
  );
}

function PaymentLookup() {
  const [input, setInput] = useState("");
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showRefund, setShowRefund] = useState(false);

  const lookup = async (e) => {
    e?.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.getPaymentStatus(input.trim());
      setPayment(p);
    } catch (err) {
      setError(err.message);
      setPayment(null);
    } finally {
      setBusy(false);
    }
  };

  const doCollectCash = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await api.collectCash(payment.id);
      setPayment(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
      <p className="text-sm font-extrabold mb-1" style={{ color: COLORS.ink }}>Look up a payment</p>
      <p className="text-xs mb-4" style={{ color: COLORS.inkFaint }}>No payment list endpoint exists — paste a payment ID (e.g. from a shipment lookup's history, or a support inquiry).</p>
      <ErrorBanner message={error} />
      <form onSubmit={lookup} className="flex gap-2 mb-4">
        <input className={inputClass} style={inputStyle} placeholder="Payment ID (UUID)" value={input} onChange={(e) => setInput(e.target.value)} />
        <SecondaryButton type="submit" disabled={busy}>{busy ? <Spinner size={14} /> : "Look up"}</SecondaryButton>
      </form>

      {payment && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <Pill status={payment.status} />
            <span className="text-lg font-extrabold" style={{ color: COLORS.ink }}>{fmtTZS(payment.amount)}</span>
          </div>
          <div className="flex flex-col gap-3 mb-5">
            <Row label="Method" value={payment.method} />
            <Row label="Shipment ID" value={payment.shipmentId} />
            <Row label="Refunded so far" value={fmtTZS(payment.refundedAmount)} />
            <Row label="Completed" value={fmtDate(payment.completedAt)} />
          </div>
          <div className="flex gap-2">
            {payment.method === "CASH" && payment.status === "PENDING_CASH_COLLECTION" && (
              <PrimaryButton onClick={doCollectCash} disabled={busy}>Confirm cash collected</PrimaryButton>
            )}
            {(payment.status === "COMPLETED" || payment.status === "PARTIALLY_REFUNDED") && (
              <PrimaryButton onClick={() => setShowRefund(true)} tone="coral" disabled={busy}>Issue refund</PrimaryButton>
            )}
          </div>
        </div>
      )}

      {showRefund && payment && (
        <RefundModal
          payment={payment}
          onClose={() => setShowRefund(false)}
          onDone={() => { setShowRefund(false); lookup(); }}
        />
      )}
    </div>
  );
}

function ReconcilePanel() {
  const [date, setDate] = useState(todayIso());
  const { data: report, loading, error, reload } = useLoad(() => api.reconcile(date), [date]);

  return (
    <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>Daily reconciliation</p>
        <input type="date" className={inputClass} style={{ ...inputStyle, width: "auto" }} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : error ? (
        <ErrorBanner message={error} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <StatCard icon={Package} label="Payments completed" value={report.paymentsCompleted} />
            <StatCard icon={Banknote} label="Total amount" value={fmtTZS(report.totalAmount)} />
            <StatCard icon={AlertTriangle} label="Total refunded" value={fmtTZS(report.totalRefunded)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(report.byMethod).map(([method, m]) => (
              <div key={method} className="rounded-xl p-3" style={{ backgroundColor: COLORS.paperDim }}>
                <p className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>{method}</p>
                <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{m.count} payments</p>
                <p className="text-xs" style={{ color: COLORS.inkFaint }}>{fmtTZS(m.totalAmount)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FinancePage() {
  return (
    <div>
      <ReconcilePanel />
      <PaymentLookup />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Pricing page — full CRUD, real and admin-only, not in the original      */
/* wiring plan but genuinely supported by the backend.                     */
/* ---------------------------------------------------------------------- */

const PRICING_COLUMNS = [
  { key: "pricingMode", label: "Mode" },
  { key: "isActive", label: "Active", render: (r) => (r.isActive ? <Pill status="ACTIVE" /> : <Pill status="INACTIVE" />) },
  { key: "basePrice", label: "Base price", render: (r) => fmtTZS(r.basePrice) },
  { key: "platformCommissionPercent", label: "Commission %" },
  { key: "riderPayoutPercent", label: "Rider payout %" },
  { key: "effectiveFrom", label: "Effective from", render: (r) => fmtDate(r.effectiveFrom) },
];

function PricingConfigForm({ initial, onClose, onSaved, isNew }) {
  const [form, setForm] = useState({
    pricingMode: initial?.pricingMode || "DISTANCE",
    basePrice: initial?.basePrice || "",
    pricePerKm: initial?.pricePerKm || "",
    includedDistanceKm: initial?.includedDistanceKm || "",
    pricePerKg: initial?.pricePerKg || "",
    includedWeightKg: initial?.includedWeightKg || "",
    platformCommissionPercent: initial?.platformCommissionPercent || "",
    riderPayoutPercent: initial?.riderPayoutPercent || "",
    surgeMultiplier: initial?.surgeMultiplier || "",
    minPrice: initial?.minPrice || "",
    maxPrice: initial?.maxPrice || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const dto = {};
    Object.entries(form).forEach(([k, v]) => {
      if (v === "" || v === undefined) return;
      dto[k] = k === "pricingMode" ? v : Number(v);
    });
    try {
      if (isNew) await api.createPricingConfig(dto);
      else await api.updatePricingConfig(initial.id, dto);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? "New pricing config" : "Edit pricing config"} onClose={onClose} maxWidth={480}>
      <ErrorBanner message={error} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Pricing mode">
          <select className={inputClass} style={inputStyle} value={form.pricingMode} onChange={set("pricingMode")}>
            <option value="DISTANCE">DISTANCE</option>
            <option value="WEIGHT">WEIGHT</option>
            <option value="HYBRID">HYBRID</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base price (TZS)"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.basePrice} onChange={set("basePrice")} required /></Field>
          <Field label="Price / km"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.pricePerKm} onChange={set("pricePerKm")} /></Field>
          <Field label="Included distance (km)"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.includedDistanceKm} onChange={set("includedDistanceKm")} /></Field>
          <Field label="Price / kg"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.pricePerKg} onChange={set("pricePerKg")} /></Field>
          <Field label="Included weight (kg)"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.includedWeightKg} onChange={set("includedWeightKg")} /></Field>
          <Field label="Surge multiplier"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.surgeMultiplier} onChange={set("surgeMultiplier")} /></Field>
          <Field label="Platform commission %"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.platformCommissionPercent} onChange={set("platformCommissionPercent")} required /></Field>
          <Field label="Rider payout %"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.riderPayoutPercent} onChange={set("riderPayoutPercent")} required /></Field>
          <Field label="Min price"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.minPrice} onChange={set("minPrice")} /></Field>
          <Field label="Max price"><input className={inputClass} style={inputStyle} type="number" step="0.01" value={form.maxPrice} onChange={set("maxPrice")} /></Field>
        </div>
        <p className="text-xs" style={{ color: COLORS.inkFaint }}>Commission % + rider payout % must sum to 100.</p>
        <PrimaryButton type="submit" disabled={busy}>{busy ? <Spinner size={14} /> : isNew ? "Create config" : "Save changes"}</PrimaryButton>
      </form>
    </Modal>
  );
}

function PricingPage() {
  const { data: configs, loading, error, reload } = useLoad(() => api.getAllPricingConfigs(), []);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs" style={{ color: COLORS.inkFaint }}>Creating a new config deactivates whichever one is currently active.</p>
        <PrimaryButton onClick={() => setCreating(true)}>New config</PrimaryButton>
      </div>
      <DataTable columns={PRICING_COLUMNS} rows={configs} onRowClick={setEditing} />

      {(editing || creating) && (
        <PricingConfigForm
          initial={editing}
          isNew={creating}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); reload(); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Support page — ticket inbox + thread, first real backend module for    */
/* one of the 3 pages that used to be an honest NOT_WIRED stub.           */
/* ---------------------------------------------------------------------- */

const TICKET_COLUMNS = [
  { key: "subject", label: "Subject" },
  { key: "category", label: "Category" },
  { key: "priority", label: "Priority", render: (r) => <Pill status={r.priority} /> },
  { key: "status", label: "Status", render: (r) => <Pill status={r.status} /> },
  { key: "createdAt", label: "Opened", render: (r) => fmtDate(r.createdAt) },
];

const TICKET_STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const TICKET_PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TICKET_CATEGORY_OPTIONS = ["DELIVERY_ISSUE", "PAYMENT_ISSUE", "ACCOUNT_ISSUE", "OTHER"];

function TicketDetail({ ticketId, onClose, onChanged }) {
  const { data, loading, error, reload } = useLoad(() => api.getTicket(ticketId), [ticketId]);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [reply, setReply] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (data) {
      setStatus(data.ticket.status);
      setPriority(data.ticket.priority);
    }
  }, [data]);

  const saveFields = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.updateTicket(ticketId, { status, priority });
      await reload();
      onChanged();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.addTicketMessage(ticketId, reply.trim(), internalNote);
      setReply("");
      await reload();
      onChanged();
    } catch (e2) {
      setActionError(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Ticket" onClose={onClose} maxWidth={520}>
      {loading && <div className="flex justify-center py-8"><Spinner size={20} /></div>}
      {error && <ErrorBanner message={error} />}
      {data && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-extrabold mb-1" style={{ color: COLORS.ink }}>{data.ticket.subject}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Pill status={data.ticket.category} />
              <span className="text-xs" style={{ color: COLORS.inkFaint }}>Opened {fmtDate(data.ticket.createdAt)}</span>
            </div>
          </div>

          <ErrorBanner message={actionError} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select className={inputClass} style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
                {TICKET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className={inputClass} style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {TICKET_PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <SecondaryButton onClick={saveFields} disabled={busy}>
            {busy ? <Spinner size={14} /> : "Save status/priority"}
          </SecondaryButton>

          <div className="pt-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
            <p className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>Thread</p>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
              {data.messages.length === 0 && (
                <p className="text-xs" style={{ color: COLORS.inkFaint }}>No messages yet.</p>
              )}
              {data.messages.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl p-3 text-sm"
                  style={{
                    backgroundColor: m.isInternalNote ? COLORS.amberSoft : COLORS.paperDim,
                    color: COLORS.ink,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>
                      {m.authorRole}{m.isInternalNote ? " · internal note" : ""}
                    </span>
                    <span className="text-xs" style={{ color: COLORS.inkFaint }}>{fmtDate(m.createdAt)}</span>
                  </div>
                  {m.message}
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={sendReply} className="flex flex-col gap-2 pt-2">
            <textarea
              className={inputClass}
              style={{ ...inputStyle, minHeight: 80 }}
              placeholder="Write a reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: COLORS.inkFaint }}>
              <input type="checkbox" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)} />
              Internal note (not visible to the person who raised the ticket)
            </label>
            <PrimaryButton type="submit" disabled={busy || !reply.trim()}>
              {busy ? <Spinner size={14} /> : internalNote ? "Add internal note" : "Send reply"}
            </PrimaryButton>
          </form>
        </div>
      )}
    </Modal>
  );
}

function SupportPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [activeId, setActiveId] = useState(null);

  const { data, loading, error, reload } = useLoad(
    () => api.listTickets({ status: statusFilter, category: categoryFilter, priority: priorityFilter }),
    [statusFilter, categoryFilter, priorityFilter],
  );

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <select className={inputClass} style={{ ...inputStyle, width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {TICKET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={inputClass} style={{ ...inputStyle, width: "auto" }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {TICKET_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={inputClass} style={{ ...inputStyle, width: "auto" }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          {TICKET_PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <DataTable
        columns={TICKET_COLUMNS}
        rows={data.tickets}
        onRowClick={(row) => setActiveId(row.id)}
        emptyLabel="No tickets match these filters."
      />

      {activeId && (
        <TicketDetail ticketId={activeId} onClose={() => setActiveId(null)} onChanged={reload} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Businesses page — read-only list/detail over BUSINESS-role accounts.   */
/* No suspend/edit action here; see admin-businesses.controller.ts's      */
/* header comment for why that's a deliberately separate decision.        */
/* ---------------------------------------------------------------------- */

const BUSINESS_COLUMNS = [
  { key: "businessName", label: "Business", render: (r) => r.businessName || <span style={{ color: COLORS.inkFaint }}>No profile yet</span> },
  { key: "fullName", label: "Account name" },
  { key: "phone", label: "Phone" },
  { key: "status", label: "Status", render: (r) => <Pill status={r.status} /> },
  { key: "createdAt", label: "Joined", render: (r) => fmtDate(r.createdAt) },
];

function BusinessDetail({ businessId, onClose }) {
  const { data, loading, error } = useLoad(() => api.getBusiness(businessId), [businessId]);

  return (
    <Modal title="Business account" onClose={onClose} maxWidth={440}>
      {loading && <div className="flex justify-center py-8"><Spinner size={20} /></div>}
      {error && <ErrorBanner message={error} />}
      {data && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>
              {data.businessName || "No profile yet"}
            </p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{data.category || "No category set"}</p>
          </div>
          <Row label="Account name" value={data.fullName} />
          <Row label="Phone" value={data.phone} />
          <Row label="Email" value={data.email || "—"} />
          <Row label="Status" value={<Pill status={data.status} />} />
          <Row label="Verified" value={data.verifiedAt ? fmtDate(data.verifiedAt) : "Not verified"} />
          <Row label="Joined" value={fmtDate(data.createdAt)} />
          {data.profile?.pickupAddress && <Row label="Default pickup" value={data.profile.pickupAddress} />}
          <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
            <StatCard icon={Users} label="Staff" value={data.staffCount} />
            <StatCard icon={Briefcase} label="Saved customers" value={data.customerCount} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function BusinessesPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeId, setActiveId] = useState(null);

  const { data, loading, error } = useLoad(
    () => api.listBusinesses({ search, status: statusFilter }),
    [search, statusFilter],
  );

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} color={COLORS.inkFaint} className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={inputClass}
            style={{ ...inputStyle, paddingLeft: 32 }}
            placeholder="Search name, phone, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={inputClass} style={{ ...inputStyle, width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="DELETED">DELETED</option>
        </select>
      </div>

      {loading && <div className="flex justify-center py-16"><Spinner size={24} /></div>}
      {error && <ErrorBanner message={error} />}
      {data && (
        <DataTable
          columns={BUSINESS_COLUMNS}
          rows={data.businesses}
          onRowClick={(row) => setActiveId(row.id)}
          emptyLabel="No business accounts match these filters."
        />
      )}

      {activeId && <BusinessDetail businessId={activeId} onClose={() => setActiveId(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Customers page — read-only list/detail over CUSTOMER-role accounts.    */
/* Same shape as Businesses; shipmentCount stands in for staff/saved-     */
/* customer counts since customers have no profile table to join.        */
/* No suspend/edit action here, same reasoning as Businesses.             */
/* ---------------------------------------------------------------------- */

const CUSTOMER_COLUMNS = [
  { key: "fullName", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "shipmentCount", label: "Shipments" },
  { key: "status", label: "Status", render: (r) => <Pill status={r.status} /> },
  { key: "createdAt", label: "Joined", render: (r) => fmtDate(r.createdAt) },
];

function CustomerDetail({ customerId, onClose }) {
  const { data, loading, error } = useLoad(() => api.getCustomer(customerId), [customerId]);

  return (
    <Modal title="Customer account" onClose={onClose} maxWidth={440}>
      {loading && <div className="flex justify-center py-8"><Spinner size={20} /></div>}
      {error && <ErrorBanner message={error} />}
      {data && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{data.fullName}</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{data.phone}</p>
          </div>
          <Row label="Email" value={data.email || "—"} />
          <Row label="Status" value={<Pill status={data.status} />} />
          <Row label="Verified" value={data.verifiedAt ? fmtDate(data.verifiedAt) : "Not verified"} />
          <Row label="Joined" value={fmtDate(data.createdAt)} />
          <Row label="Last shipment" value={data.lastShipmentAt ? fmtDate(data.lastShipmentAt) : "No shipments yet"} />
          <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
            <StatCard icon={Package} label="Shipments" value={data.shipmentCount} />
            <StatCard icon={Package} label="Completed" value={data.completedShipmentCount} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function CustomersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [activeId, setActiveId] = useState(null);

  const { data, loading, error } = useLoad(
    () => api.listCustomers({ search, status: statusFilter }),
    [search, statusFilter],
  );

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} color={COLORS.inkFaint} className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className={inputClass}
            style={{ ...inputStyle, paddingLeft: 32 }}
            placeholder="Search name, phone, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className={inputClass} style={{ ...inputStyle, width: "auto" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="DELETED">DELETED</option>
        </select>
      </div>

      {loading && <div className="flex justify-center py-16"><Spinner size={24} /></div>}
      {error && <ErrorBanner message={error} />}
      {data && (
        <DataTable
          columns={CUSTOMER_COLUMNS}
          rows={data.customers}
          onRowClick={(row) => setActiveId(row.id)}
          emptyLabel="No customer accounts match these filters."
        />
      )}

      {activeId && <CustomerDetail customerId={activeId} onClose={() => setActiveId(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Analytics page — built from real daily reconciliation reports over the  */
/* last 7 days (the only time-series data the backend actually has).      */
/* ---------------------------------------------------------------------- */

function last7Dates() {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function AnalyticsPage() {
  const { data: trend, loading, error } = useLoad(async () => {
    const dates = last7Dates();
    const reports = await Promise.all(dates.map((d) => api.reconcile(d).catch(() => null)));
    return dates.map((d, i) => ({
      date: d.slice(5),
      revenue: reports[i] ? Number(reports[i].totalAmount) : 0,
      payments: reports[i] ? reports[i].paymentsCompleted : 0,
    }));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>;
  if (error) return <ErrorBanner message={error} />;

  const totalPayments = trend.reduce((s, d) => s + d.payments, 0);
  const totalRevenue = trend.reduce((s, d) => s + d.revenue, 0);

  return (
    <div>
      <p className="text-xs mb-4" style={{ color: COLORS.inkFaint }}>
        Built from GET /payments/reconcile/:date for each of the last 7 days — the only
        time-series data the backend exposes today. There is no dedicated analytics module
        (city breakdowns, delivery-time averages, retention) yet.
      </p>
      <div className="rounded-2xl p-5 mb-6" style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.paperDim}` }}>
        <p className="text-sm font-extrabold mb-4" style={{ color: COLORS.ink }}>Completed payment volume, last 7 days</p>
        <Suspense fallback={<div className="flex justify-center py-16"><Spinner size={20} /></div>}>
          <RevenueChart
            trend={trend}
            tealColor={COLORS.teal}
            inkFaintColor={COLORS.inkFaint}
            formatTZS={fmtTZS}
          />
        </Suspense>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={Banknote} label="Total, 7 days" value={fmtTZS(totalRevenue)} />
        <StatCard icon={Package} label="Payments completed, 7 days" value={totalPayments} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

const TITLES = {
  dispatch: "Dispatch", deliveries: "Deliveries", riders: "Riders",
  finance: "Finance", pricing: "Pricing", analytics: "Analytics",
  customers: "Customers", businesses: "Businesses", support: "Support",
};

function AppShell({ user, onLogout }) {
  const [page, setPage] = useState("dispatch");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    api.logout();
    onLogout();
  };

  const { isAdmin, isDispatcher } = api.roleSummary();
  const showRoleWarning = user && !isAdmin && !isDispatcher;

  let pageContent;
  if (NOT_WIRED[page]) pageContent = <NotWiredPage pageId={page} />;
  else if (page === "dispatch") pageContent = <DispatchPage />;
  else if (page === "deliveries") pageContent = <DeliveriesPage />;
  else if (page === "riders") pageContent = <RidersPage />;
  else if (page === "finance") pageContent = <FinancePage />;
  else if (page === "pricing") pageContent = <PricingPage />;
  else if (page === "analytics") pageContent = <AnalyticsPage />;
  else if (page === "support") pageContent = <SupportPage />;
  else if (page === "businesses") pageContent = <BusinessesPage />;
  else if (page === "customers") pageContent = <CustomersPage />;

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: COLORS.paperDim, fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Manrope', sans-serif; box-sizing: border-box; }
        .tr-row:hover { background-color: ${COLORS.paperDim}; }
        .modal-pop { animation: modalpop 0.18s ease-out; }
        @keyframes modalpop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background-color: #C9C2AE; border-radius: 8px; }
        @media (prefers-reduced-motion: reduce) {
          .modal-pop { animation: none !important; }
        }
      `}</style>

      <Sidebar page={page} setPage={setPage} open={sidebarOpen} setOpen={setSidebarOpen} user={user} onLogout={handleLogout} />

      <div className="flex flex-col min-h-screen lg:pl-60">
        <TopBar title={TITLES[page]} onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 p-5 lg:p-8">
          {showRoleWarning && (
            <ErrorBanner message="This account has no ADMIN, SUPER_ADMIN, or DISPATCHER role — every action below will be rejected by the backend with a 403." />
          )}
          {pageContent}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => api.currentUser());

  if (!api.isAuthenticated() || !user) {
    return <LoginScreen onLoggedIn={setUser} />;
  }

  return <AppShell key={user.id} user={user} onLogout={() => setUser(null)} />;
}

export default App;
