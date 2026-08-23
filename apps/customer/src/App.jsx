/* ========================================================================
   WAZZAR CUSTOMER APP — standalone build, split out of the original combined
   WAZZAR Suite prototype. Owns nothing about Rider/Business/Admin.
   ======================================================================== */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  MapPin, Search, ChevronLeft, ChevronRight, Star, Phone, MessageCircle, Camera, Check, CheckCircle2, Circle, Zap, Wallet, CreditCard, Banknote, Bike, Radar, Signal, Wifi, BatteryFull, FileText, Package, UtensilsCrossed, Pill, Smartphone, Shirt, Home, History, User, Sparkles, LocateFixed, Receipt, Activity,
} from "lucide-react";
import * as api from "./api";

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
  land: "#E4E9DD",
  water: "#BEDFE2",
  road: "#CBD3C2",
};

const fmtTZS = (n) => `TZS ${n.toLocaleString("en-US")}`;

const CATEGORIES = [
  { id: "docs", label: "Documents", icon: FileText },
  { id: "parcel", label: "Parcel", icon: Package },
  { id: "food", label: "Food", icon: UtensilsCrossed },
  { id: "medicine", label: "Medicine", icon: Pill },
  { id: "electronics", label: "Electronics", icon: Smartphone },
  { id: "clothing", label: "Clothing", icon: Shirt },
];

const STATES = [
  { id: 1, label: "Order Placed", desc: "Order confirmed, searching will begin shortly." },
  { id: 2, label: "Searching Rider", desc: "Live search radius expanding on the map." },
  { id: 3, label: "Rider Assigned", desc: "Your rider's details are shown below." },
  { id: 4, label: "Rider Arriving", desc: "Live ETA to your pickup point." },
  { id: 5, label: "Picked Up", desc: "Pickup confirmed with photo & OTP proof." },
  { id: 6, label: "In Transit", desc: "Rider is on the way to the drop-off." },
  { id: 7, label: "Near Destination", desc: "Rider is close to the recipient." },
  { id: 8, label: "Delivered", desc: "Proof of delivery captured." },
  { id: 9, label: "Completed", desc: "Receipt issued — rate your rider." },
];

// Default coordinates for Dar es Salaam (Mlimani City, Ubungo) — fallback
// if geolocation fails or is denied. User's actual device location will be
// used if granted; otherwise these defaults appear on first load. The actual
// pickup/dropoff points become state below, replaceable by map drag or search.
const DEFAULT_PICKUP_COORD = { lat: -6.7736, lng: 39.2044 };  // Mlimani City Mall
const DEFAULT_DROPOFF_COORD = { lat: -6.7667, lng: 39.2472 }; // Mikocheni B
const RIDER_START = { lat: -6.779, lng: 39.198 };
const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

// Great-circle distance in km — used everywhere a distance figure is shown
// so the numbers are computed from real coordinates, not hardcoded strings.
function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

// Interpolate a point a given fraction of the way along a multi-point path
// (real road geometry), by real cumulative distance rather than point index.
function pointAlongRoute(coords, fraction) {
  if (!coords || coords.length < 2) return null;
  const segLens = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversineKm(coords[i - 1], coords[i]);
    segLens.push(d);
    total += d;
  }
  if (total === 0) return coords[0];
  const target = total * Math.min(1, Math.max(0, fraction));
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (acc + segLens[i] >= target) {
      const t = segLens[i] === 0 ? 0 : (target - acc) / segLens[i];
      return lerp(coords[i], coords[i + 1], t);
    }
    acc += segLens[i];
  }
  return coords[coords.length - 1];
}

// Real road-following route via OSRM's public routing engine — free, no API
// key, same keyless-infrastructure category as the OSM tiles. Falls back
// gracefully (caller uses a straight line) if unreachable.
async function fetchRoadRoute(from, to) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code === "Ok" && data.routes && data.routes[0]) {
      return {
        coords: data.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        distanceKm: data.routes[0].distance / 1000,
        durationMin: data.routes[0].duration / 60,
      };
    }
  } catch (e) { /* network/CORS/timeout — caller falls back to a straight line */ }
  return null;
}

function useRoadRoute(from, to) {
  const [route, setRoute] = useState(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetchRoadRoute(from, to).then((r) => {
      if (cancelled) return;
      if (r) { setRoute(r); setStatus("ok"); } else { setStatus("fallback"); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.lat, from.lng, to.lat, to.lng]);
  return { route, status };
}

// Reverse geocoding via Nominatim (OpenStreetMap's free geocoder) — turns a
// dragged/detected coordinate into a readable address. Fires only on
// drag-end / a location grant, so it stays well within usage limits.
async function reverseGeocode(coord) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coord.lat}&lon=${coord.lng}&zoom=17&addressdetails=0`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.display_name ? data.display_name.split(",").slice(0, 3).join(",").trim() : null;
  } catch (e) { return null; }
}

// Forward geocoding / place search — turns whatever the user is typing
// into a short list of real matching places (name + coordinates), via
// the backend's GET /geocode/search (a Nominatim adapter). Previously
// this called Nominatim directly from the browser; routing it through
// the backend instead is the geocoding slice of
// MASTER_GAPS_AND_ROADMAP.md's frontend-wiring follow-up. Tanzania-only
// for now, matching the rest of the app's DEFAULT_PICKUP/DROPOFF area.
async function searchPlaces(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const results = await api.searchAddresses(query.trim(), "tz");
    if (!Array.isArray(results)) return [];
    return results.map((r) => ({
      label: r.address.split(",").slice(0, 3).join(",").trim(),
      lat: r.latitude,
      lng: r.longitude,
    }));
  } catch (e) { return []; }
}

// Debounced live search-as-you-type, backing the location picker's
// suggestion list with real place matches instead of a fixed static list.
function usePlaceSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!query || query.trim().length < 2) { setResults([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      searchPlaces(query).then((r) => { if (!cancelled) { setResults(r); setLoading(false); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return { results, loading };
}

// Real browser geolocation, high-accuracy mode, only ever fired by an
// explicit user action (never automatically) — .request() is called from a
// button tap, and the browser's own permission prompt is the consent gate.
function useGeolocation() {
  const [state, setState] = useState({ status: "idle", coords: null, accuracy: null });
  const request = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "unsupported", coords: null, accuracy: null });
      return;
    }
    setState((s) => ({ ...s, status: "locating" }));
    navigator.geolocation.getCurrentPosition(
      (pos) => setState({ status: "granted", coords: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracy: pos.coords.accuracy }),
      () => setState({ status: "denied", coords: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };
  return { ...state, request };
}

const DEFAULT_PICKUP = "";
const DEFAULT_DROPOFF = "";

/* ---------------------------------------------------------------------- */
/* Shared primitives                                                       */
/* ---------------------------------------------------------------------- */

function StatusBar({ light = false }) {
  const c = light ? COLORS.paper : COLORS.ink;
  return (
    <div className="wazzar-statusbar flex items-center justify-between px-6 pt-3 pb-1 select-none">
      <span className="text-xs font-semibold" style={{ color: c, fontVariantNumeric: "tabular-nums" }}>9:41</span>
      <div className="flex items-center gap-1">
        <Signal size={13} strokeWidth={2.4} color={c} />
        <Wifi size={13} strokeWidth={2.4} color={c} />
        <BatteryFull size={15} strokeWidth={2.2} color={c} />
      </div>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 font-bold text-base transition-transform active:scale-95"
      style={{
        backgroundColor: disabled ? COLORS.paperDim : COLORS.amber,
        color: disabled ? COLORS.inkFaint : COLORS.paper,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryLink({ children, onClick }) {
  return (
    <button onClick={onClick} className="w-full text-center py-2 text-sm font-semibold" style={{ color: COLORS.teal }}>
      {children}
    </button>
  );
}

function BackButton({ onClick }) {
  return (
    <button onClick={onClick} className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paperDim }}>
      <ChevronLeft size={20} color={COLORS.ink} />
    </button>
  );
}

function FlowHeader({ title, step, total, onBack }) {
  return (
    <div className="px-5 pt-2 pb-3">
      <div className="flex items-center gap-3 mb-3">
        <BackButton onClick={onBack} />
        <div className="flex-1">
          <p className="text-xs font-bold tracking-wide" style={{ color: COLORS.teal }}>STEP {step} OF {total}</p>
          <h2 className="text-lg font-extrabold" style={{ color: COLORS.ink }}>{title}</h2>
        </div>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className="flex-1 rounded-full" style={{ height: 4, backgroundColor: i < step ? COLORS.amber : COLORS.paperDim }} />
        ))}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="rounded-full flex-shrink-0 transition-colors"
      style={{ width: 44, height: 26, backgroundColor: checked ? COLORS.amber : COLORS.inkFaint, opacity: checked ? 1 : 0.3, padding: 3 }}
    >
      <div className="rounded-full transition-transform" style={{ width: 20, height: 20, backgroundColor: COLORS.paper, transform: checked ? "translateX(18px)" : "translateX(0px)" }} />
    </button>
  );
}

// Live map: real OpenStreetMap tiles via Leaflet, loaded from cdnjs at
// runtime (no build-time package available for React artifacts, so the
// script/stylesheet are injected once and reused). Tiles are grayed and
// tinted with a CSS filter targeting Leaflet's own tile pane so they read
// as "WAZZAR's map" rather than default OSM styling — the pins, route
// thread, and rider marker are custom-drawn on top and stay fully vivid.
// Swapping this for Google Maps / Mapbox later only means changing this
// one component (per the blueprint's Map Abstraction rule).
function useLeafletReady() {
  const [state, setState] = useState({ ready: typeof window !== "undefined" && !!window.L, failed: false });
  useEffect(() => {
    if (window.L) { setState({ ready: true, failed: false }); return; }
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) { settled = true; setState({ ready: false, failed: true }); }
    }, 8000);
    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setState({ ready: true, failed: false });
    };
    const onFail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setState({ ready: false, failed: true });
    };
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);
    }
    const existing = document.getElementById("leaflet-js");
    if (existing) {
      existing.addEventListener("load", onReady);
      existing.addEventListener("error", onFail);
      if (window.L) onReady();
      return () => {
        clearTimeout(timeoutId);
        existing.removeEventListener("load", onReady);
        existing.removeEventListener("error", onFail);
      };
    }
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.async = true;
    script.onload = onReady;
    script.onerror = onFail;
    document.head.appendChild(script);
    return () => clearTimeout(timeoutId);
  }, []);
  return state;
}

// Pure-SVG fallback used only if Leaflet's script/tiles can't be reached —
// approximates real relative positions from the given coordinates so the
// screen is never blank, it just says plainly that it's a simplified view.
function FallbackMapSvg({ center, pins, routeCoords, riderPos, fitPoints }) {
  const pts = fitPoints && fitPoints.length > 1 ? fitPoints : [center];
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats) - 0.004, maxLat = Math.max(...lats) + 0.004;
  const minLng = Math.min(...lngs) - 0.004, maxLng = Math.max(...lngs) + 0.004;
  const latSpan = Math.max(maxLat - minLat, 0.006);
  const lngSpan = Math.max(maxLng - minLng, 0.006);
  const px = (p) => ({ x: ((p.lng - minLng) / lngSpan) * 380, y: (1 - (p.lat - minLat) / latSpan) * 420 });

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: COLORS.land }}>
      <svg viewBox="0 0 380 420" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
        {[60, 140, 220, 300, 380].map((y, i) => <line key={"h" + i} x1="0" y1={y} x2="380" y2={y} stroke={COLORS.road} strokeWidth="2" opacity="0.4" />)}
        {[60, 150, 240, 330].map((x, i) => <line key={"v" + i} x1={x} y1="0" x2={x} y2="420" stroke={COLORS.road} strokeWidth="2" opacity="0.4" />)}
        {routeCoords && routeCoords.length > 1 && (
          <polyline
            points={routeCoords.map((c) => { const p = px(c); return `${p.x},${p.y}`; }).join(" ")}
            fill="none" stroke={COLORS.amber} strokeWidth="4" strokeLinecap="round" strokeDasharray="2 12" className="route-thread"
          />
        )}
        {(pins || []).map((p, i) => {
          const pt = px(p);
          return <g key={i} transform={`translate(${pt.x},${pt.y})`}><circle r="11" fill={p.color} stroke={COLORS.paper} strokeWidth="3" /></g>;
        })}
        {riderPos && (() => {
          const pt = px(riderPos);
          return <g transform={`translate(${pt.x},${pt.y})`}><circle r="11" fill={COLORS.ink} stroke={COLORS.paper} strokeWidth="3" /></g>;
        })()}
      </svg>
      <div className="absolute left-0 right-0 flex justify-center" style={{ bottom: 10 }}>
        <span className="text-xs font-semibold rounded-full px-3 py-1.5" style={{ backgroundColor: "rgba(247,244,238,0.9)", color: COLORS.inkFaint }}>
          Simplified map — live tiles unavailable
        </span>
      </div>
    </div>
  );
}

function LiveMap({ center, zoom = 14.6, interactive, pins, routeCoords, riderPos, pulse, centerPin, fitPoints, onCenterChange, accuracyCenter, accuracyRadius, onLocate, locating }) {
  const { ready, failed } = useLeafletReady();
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const staticLayerRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const onCenterChangeRef = useRef(onCenterChange);
  useEffect(() => { onCenterChangeRef.current = onCenterChange; }, [onCenterChange]);

  useEffect(() => {
    if (!ready || failed || !holderRef.current || mapRef.current) return;
    const L = window.L;
    const container = holderRef.current;
    // React can mount/unmount/mount effects in quick succession (Strict Mode
    // and similar dev-time behavior). If a previous instance didn't fully
    // detach, Leaflet throws "Map container is already initialized" on the
    // next L.map() call — clearing this flag first avoids that crash.
    if (container._leaflet_id) delete container._leaflet_id;

    let map;
    try {
      map = L.map(container, {
        center: [center.lat, center.lng], zoom,
        zoomControl: false, attributionControl: false,
        dragging: !!interactive, scrollWheelZoom: false, doubleClickZoom: false,
        touchZoom: !!interactive, boxZoom: false, keyboard: false, tap: !!interactive,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);
      staticLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      map.on("dragend", () => {
        const c = map.getCenter();
        if (onCenterChangeRef.current) onCenterChangeRef.current({ lat: c.lat, lng: c.lng });
      });
    } catch (e) {
      console.error("LiveMap: Leaflet initialization failed", e);
      return;
    }

    const invalidateTimer = setTimeout(() => {
      if (mapRef.current === map) { try { map.invalidateSize(); } catch (e) { /* noop */ } }
    }, 150);

    return () => {
      clearTimeout(invalidateTimer);
      try { map.remove(); } catch (e) { /* already removed */ }
      if (mapRef.current === map) mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, failed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const L = window.L;
    staticLayerRef.current.clearLayers();

    if (fitPoints && fitPoints.length > 1) {
      map.fitBounds(fitPoints.map((p) => [p.lat, p.lng]), { padding: [34, 34], animate: true });
    } else {
      map.setView([center.lat, center.lng], zoom, { animate: true });
    }

    if (routeCoords && routeCoords.length > 1) {
      L.polyline(routeCoords.map((c) => [c.lat, c.lng]), { color: COLORS.amber, weight: 4, opacity: 0.9, dashArray: "2 12", className: "route-thread" }).addTo(staticLayerRef.current);
    }

    (pins || []).forEach((p) => {
      const icon = L.divIcon({ className: "", html: `<div style="width:22px;height:22px;border-radius:50%;background:${p.color};border:3px solid ${COLORS.paper};box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([p.lat, p.lng], { icon, interactive: false }).addTo(staticLayerRef.current);
    });

    if (pulse) {
      const icon = L.divIcon({ className: "", html: `<div class="pulse-ring" style="width:22px;height:22px;border-radius:50%;border:2px solid ${COLORS.amber}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([center.lat, center.lng], { icon, interactive: false }).addTo(staticLayerRef.current);
    }

    if (accuracyCenter && accuracyRadius) {
      L.circle([accuracyCenter.lat, accuracyCenter.lng], {
        radius: accuracyRadius, color: COLORS.teal, weight: 1.5, fillColor: COLORS.teal, fillOpacity: 0.12, opacity: 0.45,
      }).addTo(staticLayerRef.current);
      const dot = L.divIcon({ className: "", html: `<div style="width:14px;height:14px;border-radius:50%;background:${COLORS.teal};border:3px solid ${COLORS.paper};box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
      L.marker([accuracyCenter.lat, accuracyCenter.lng], { icon: dot, interactive: false }).addTo(staticLayerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, center.lat, center.lng, zoom, JSON.stringify(pins), JSON.stringify(routeCoords), pulse, JSON.stringify(fitPoints), accuracyCenter && accuracyCenter.lat, accuracyCenter && accuracyCenter.lng, accuracyRadius]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const L = window.L;
    if (!riderPos) {
      if (riderMarkerRef.current) { map.removeLayer(riderMarkerRef.current); riderMarkerRef.current = null; }
      return;
    }
    if (!riderMarkerRef.current) {
      const icon = L.divIcon({ className: "rider-marker", html: `<div style="width:20px;height:20px;border-radius:50%;background:${COLORS.ink};border:3px solid ${COLORS.paper};box-shadow:0 2px 8px rgba(0,0,0,0.4)"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
      riderMarkerRef.current = L.marker([riderPos.lat, riderPos.lng], { icon, interactive: false }).addTo(map);
    } else {
      riderMarkerRef.current.setLatLng([riderPos.lat, riderPos.lng]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, riderPos && riderPos.lat, riderPos && riderPos.lng]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: COLORS.land, zIndex: 0 }}>
      {failed ? (
        <FallbackMapSvg center={center} pins={pins} routeCoords={routeCoords} riderPos={riderPos} fitPoints={fitPoints} />
      ) : (
        <div ref={holderRef} className="absolute inset-0" style={{ zIndex: 0 }} />
      )}
      {centerPin && (
        <div className="absolute flex flex-col items-center" style={{ left: "50%", top: "50%", transform: "translate(-50%,-100%)", pointerEvents: "none" }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", backgroundColor: COLORS.amber, border: `3px solid ${COLORS.paper}`, boxShadow: "0 3px 8px rgba(0,0,0,0.35)" }} />
          <div style={{ width: 2, height: 14, backgroundColor: COLORS.amber }} />
        </div>
      )}
      {onLocate && (
        <button
          onClick={onLocate}
          className="absolute flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ bottom: 14, right: 14, width: 40, height: 40, backgroundColor: COLORS.paper, boxShadow: "0 4px 14px rgba(16,34,28,0.28)" }}
        >
          {locating ? (
            <div className="locate-spin" style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${COLORS.paperDim}`, borderTopColor: COLORS.teal }} />
          ) : (
            <LocateFixed size={18} color={COLORS.teal} />
          )}
        </button>
      )}
      <span className="absolute" style={{ bottom: 4, left: 6, fontSize: 9, fontWeight: 600, color: COLORS.inkFaint, opacity: 0.55, backgroundColor: "rgba(247,244,238,0.6)", padding: "1px 4px", borderRadius: 4, pointerEvents: "none" }}>
        {failed ? "Offline preview" : "© OpenStreetMap"}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Screens                                                                  */
/* ---------------------------------------------------------------------- */

function SplashScreen({ onNext }) {
  return (
    <div className="h-full flex flex-col items-center justify-between px-8 pb-10" style={{ backgroundColor: COLORS.ink }}>
      <div className="w-full"><StatusBar light /></div>
      <div className="flex flex-col items-center text-center">
        <div className="rounded-3xl flex items-center justify-center mb-6" style={{ width: 84, height: 84, backgroundColor: COLORS.amber }}>
          <span className="text-3xl font-extrabold" style={{ color: COLORS.ink }}>W</span>
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight" style={{ color: COLORS.paper }}>WAZZAR</h1>
        <p className="mt-3 text-sm font-semibold" style={{ color: COLORS.paper, opacity: 0.7 }}>Nitumie kupitia WAZZAR</p>
        <p className="text-xs mt-1" style={{ color: COLORS.paper, opacity: 0.45 }}>Send anything, anywhere in Dar es Salaam.</p>
      </div>
      <div className="w-full"><PrimaryButton onClick={onNext}>Get started</PrimaryButton></div>
    </div>
  );
}

function PhoneEntryScreen({ phone, setPhone, onNext, onBack }) {
  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="mt-2"><BackButton onClick={onBack} /></div>
      <div className="mt-8">
        <h2 className="text-2xl font-extrabold" style={{ color: COLORS.ink }}>What's your number?</h2>
        <p className="text-sm mt-1" style={{ color: COLORS.inkFaint }}>We'll text you a code to verify — no password needed.</p>
      </div>
      <div className="mt-8 flex items-center rounded-2xl px-4 py-4 gap-2" style={{ backgroundColor: COLORS.paperDim }}>
        <span className="font-bold" style={{ color: COLORS.ink }}>+255</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
          placeholder="712 345 678"
          inputMode="numeric"
          className="flex-1 bg-transparent outline-none font-bold text-base"
          style={{ color: COLORS.ink }}
        />
      </div>
      <div className="flex-1" />
      <div className="pb-4"><PrimaryButton onClick={onNext} disabled={phone.length < 9}>Continue</PrimaryButton></div>
    </div>
  );
}

function OtpScreen({ otp, setOtp, onNext, onBack, phone, loading, error }) {
  const r0 = useRef(), r1 = useRef(), r2 = useRef(), r3 = useRef();
  const refs = [r0, r1, r2, r3];
  const handleChange = (i, val) => {
    const v = val.replace(/[^0-9]/g, "").slice(-1);
    const next = [...otp];
    next[i] = v;
    setOtp(next);
    if (v && i < 3) refs[i + 1].current?.focus();
  };
  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="mt-2"><BackButton onClick={onBack} /></div>
      <div className="mt-8">
        <h2 className="text-2xl font-extrabold" style={{ color: COLORS.ink }}>Enter the code</h2>
        <p className="text-sm mt-1" style={{ color: COLORS.inkFaint }}>Sent to +255 {phone || "712 345 678"}</p>
      </div>
      <div className="flex gap-3 mt-8">
        {otp.map((d, i) => (
          <input
            key={i}
            ref={refs[i]}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            inputMode="numeric"
            className="flex-1 text-center text-xl font-extrabold rounded-2xl py-3 outline-none"
            style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink, border: d ? `2px solid ${COLORS.teal}` : "2px solid transparent" }}
          />
        ))}
      </div>
      <div className="mt-2"><SecondaryLink onClick={() => setOtp(["4", "8", "1", "2"])}>Didn't get it? Resend code</SecondaryLink></div>
      {error && <p className="text-xs font-semibold mt-3" style={{ color: "#C0392B" }}>{error}</p>}
      <div className="flex-1" />
      <div className="pb-4">
        <PrimaryButton onClick={onNext} disabled={otp.some((d) => !d) || loading}>
          {loading ? "Verifying…" : "Verify"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function HomeScreenFull({ onSend, setTab, tab, pickupCoord, geo, user }) {
  const initials = user && user.fullName
    ? user.fullName.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";
  const located = geo.status === "granted";
  return (
    <div className="h-full relative" style={{ backgroundColor: COLORS.land }}>
      <LiveMap
        center={located ? geo.coords : pickupCoord}
        pins={located ? [] : [{ ...pickupCoord, color: COLORS.teal }]}
        accuracyCenter={located ? geo.coords : null}
        accuracyRadius={located ? geo.accuracy : null}
        onLocate={geo.request}
        locating={geo.status === "locating"}
      />
      <div className="absolute top-0 left-0 right-0" style={{ zIndex: 10 }}>
        <StatusBar />
        <div className="flex items-center justify-between px-5 mt-2">
          <div>
            <p className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>Nitumie kupitia</p>
            <p className="text-xl font-extrabold" style={{ color: COLORS.ink }}>WAZZAR</p>
          </div>
          <div className="rounded-full flex items-center justify-center font-bold" style={{ width: 40, height: 40, backgroundColor: COLORS.ink, color: COLORS.paper }}>{initials}</div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl px-5 pt-3" style={{ backgroundColor: COLORS.paper, boxShadow: "0 -8px 30px rgba(16,34,28,0.18)", zIndex: 10 }}>
        <div className="flex justify-center mb-3">
          <div className="rounded-full" style={{ width: 40, height: 4, backgroundColor: COLORS.paperDim }} />
        </div>

        <button onClick={onSend} className="w-full flex items-center gap-3 rounded-2xl px-4 py-4 mb-3" style={{ backgroundColor: COLORS.paperDim }}>
          <Search size={18} color={COLORS.inkFaint} />
          <span className="text-sm font-semibold" style={{ color: COLORS.inkFaint }}>Where should we pick up?</span>
        </button>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button onClick={onSend} className="rounded-2xl py-3.5 flex flex-col items-center gap-1.5" style={{ backgroundColor: COLORS.ink }}>
            <Package size={20} color={COLORS.amber} />
            <span className="text-xs font-bold" style={{ color: COLORS.paper }}>Tuma Kitu</span>
          </button>
          <button onClick={onSend} className="rounded-2xl py-3.5 flex flex-col items-center gap-1.5" style={{ backgroundColor: COLORS.tealSoft }}>
            <History size={20} color={COLORS.teal} />
            <span className="text-xs font-bold" style={{ color: COLORS.teal }}>Reorder</span>
          </button>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto">
          {["Home", "Work", "Mama's shop"].map((l) => (
            <button key={l} onClick={onSend} className="flex items-center gap-1.5 rounded-full px-3 py-2 whitespace-nowrap" style={{ backgroundColor: COLORS.paperDim }}>
              <MapPin size={13} color={COLORS.inkFaint} />
              <span className="text-xs font-semibold" style={{ color: COLORS.ink }}>{l}</span>
            </button>
          ))}
        </div>

        <div className="rounded-2xl px-4 py-3 mb-4 flex items-center gap-3" style={{ backgroundColor: COLORS.amberSoft }}>
          <Sparkles size={18} color={COLORS.amberDeep} />
          <p className="text-xs font-semibold flex-1" style={{ color: COLORS.amberDeep }}>Refer a friend, earn TZS 2,000 in delivery credit.</p>
        </div>

        <div className="flex items-center justify-around pt-2 pb-3" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
          {[
            { id: "home", label: "Home", icon: Home },
            { id: "activity", label: "Activity", icon: History },
            { id: "account", label: "Account", icon: User },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-1">
              <t.icon size={20} color={tab === t.id ? COLORS.amber : COLORS.inkFaint} strokeWidth={tab === t.id ? 2.6 : 2} />
              <span className="text-xs font-bold" style={{ color: tab === t.id ? COLORS.amber : COLORS.inkFaint }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityScreen({ onBack, onSend }) {
  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="flex items-center gap-3 mt-2 mb-2">
        <BackButton onClick={onBack} />
        <h2 className="text-lg font-extrabold" style={{ color: COLORS.ink }}>Activity</h2>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
        <div className="rounded-full flex items-center justify-center mb-4" style={{ width: 72, height: 72, backgroundColor: COLORS.paperDim }}>
          <History size={28} color={COLORS.inkFaint} />
        </div>
        <h3 className="font-extrabold text-base mb-1" style={{ color: COLORS.ink }}>No deliveries yet</h3>
        <p className="text-sm mb-6" style={{ color: COLORS.inkFaint }}>Every delivery you send will show up here, tracked from pickup to drop-off.</p>
        <PrimaryButton onClick={onSend}>Send your first package</PrimaryButton>
      </div>
    </div>
  );
}

function AccountScreen({ onBack, user }) {
  const fullName = (user && user.fullName) || "WAZZAR Customer";
  const initials = fullName.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "WC";
  const phoneLabel = (user && user.phone) || "—";
  const rows = [
    { label: "Saved addresses", value: "3" },
    { label: "Payment methods", value: "2" },
    { label: "Language", value: "English" },
    { label: "Support", value: "" },
  ];
  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="flex items-center gap-3 mt-2 mb-6">
        <BackButton onClick={onBack} />
        <h2 className="text-lg font-extrabold" style={{ color: COLORS.ink }}>Account</h2>
      </div>
      <div className="flex items-center gap-4 mb-6">
        <div className="rounded-full flex items-center justify-center font-extrabold text-lg flex-shrink-0" style={{ width: 56, height: 56, backgroundColor: COLORS.ink, color: COLORS.paper }}>{initials}</div>
        <div className="flex-1">
          <p className="font-extrabold" style={{ color: COLORS.ink }}>{fullName}</p>
          <p className="text-xs" style={{ color: COLORS.inkFaint }}>{phoneLabel}</p>
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: COLORS.paperDim }}>
        {rows.map((r, i) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-3.5" style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.paper}` }}>
            <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{r.label}</span>
            <div className="flex items-center gap-1.5">
              {r.value && <span className="text-sm" style={{ color: COLORS.inkFaint }}>{r.value}</span>}
              <ChevronRight size={16} color={COLORS.inkFaint} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationScreen({ type, value, setValue, onNext, onBack, step, total, coord, onCoordChange, pickupCoord, geo }) {
  const isDrop = type === "dropoff";
  const [geocoding, setGeocoding] = useState(false);

  // Only search-as-you-type off text the user actually typed — not text we
  // filled in ourselves after a map drag (that already has a precise coord,
  // a suggestions dropdown popping up right after would just be noise).
  const [userEdited, setUserEdited] = useState(false);
  const { results: liveSuggestions, loading: searching } = usePlaceSearch(userEdited ? value : "");

  const applyCoord = (next) => {
    onCoordChange(next);
    setGeocoding(true);
    reverseGeocode(next).then((addr) => {
      setGeocoding(false);
      if (addr) { setUserEdited(false); setValue(addr); }
    });
  };

  const handleTextChange = (e) => {
    setUserEdited(true);
    setValue(e.target.value);
  };

  const pickSuggestion = (item) => {
    setUserEdited(false);
    setValue(item.label);
    onCoordChange({ lat: item.lat, lng: item.lng });
  };

  const showLiveResults = userEdited && value.trim().length >= 2;

  return (
    <div className="h-full relative" style={{ backgroundColor: COLORS.land }}>
      <LiveMap
        center={coord}
        interactive
        centerPin
        pins={isDrop ? [{ ...pickupCoord, color: COLORS.teal }] : []}
        onCenterChange={applyCoord}
        accuracyCenter={!isDrop && geo.status === "granted" ? geo.coords : null}
        accuracyRadius={!isDrop && geo.status === "granted" ? geo.accuracy : null}
        onLocate={!isDrop ? geo.request : undefined}
        locating={!isDrop && geo.status === "locating"}
      />
      <div className="absolute top-0 left-0 right-0" style={{ backgroundColor: COLORS.paper, zIndex: 10 }}>
        <StatusBar />
        <FlowHeader title={isDrop ? "Where to?" : "Pickup location"} step={step} total={total} onBack={onBack} />
      </div>
      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl px-5 pt-4 pb-4" style={{ backgroundColor: COLORS.paper, boxShadow: "0 -8px 30px rgba(16,34,28,0.18)", zIndex: 10 }}>
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-1" style={{ backgroundColor: COLORS.paperDim }}>
          <MapPin size={16} color={isDrop ? COLORS.amber : COLORS.teal} />
          <input
            value={geocoding ? "Locating address…" : value}
            onChange={handleTextChange}
            placeholder={isDrop ? "Recipient's address" : "Search street, landmark..."}
            className="flex-1 bg-transparent outline-none text-sm font-semibold"
            style={{ color: COLORS.ink }}
            disabled={geocoding}
          />
          {!isDrop && geo.status === "granted" && (
            <span className="text-xs font-bold flex-shrink-0" style={{ color: COLORS.teal }}>±{Math.round(geo.accuracy)}m</span>
          )}
        </div>
        {!isDrop && (geo.status === "denied" || geo.status === "unsupported") ? (
          <p className="text-xs font-semibold mb-3 px-1" style={{ color: COLORS.inkFaint }}>
            Location unavailable — drag the map or search below.
          </p>
        ) : (
          <div className="mb-3" />
        )}

        <div className="mb-4">
          {showLiveResults ? (
            searching ? (
              <p className="text-xs font-semibold py-2 px-1" style={{ color: COLORS.inkFaint }}>Searching…</p>
            ) : liveSuggestions.length > 0 ? (
              liveSuggestions.map((s) => (
                <button key={`${s.label}-${s.lat}-${s.lng}`} onClick={() => pickSuggestion(s)} className="w-full flex items-center gap-3 py-2.5 text-left">
                  <MapPin size={14} color={isDrop ? COLORS.amber : COLORS.teal} />
                  <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{s.label}</span>
                </button>
              ))
            ) : (
              <p className="text-xs font-semibold py-2 px-1" style={{ color: COLORS.inkFaint }}>No matching places found.</p>
            )
          ) : null}
        </div>
        <PrimaryButton onClick={onNext} disabled={!value || geocoding}>Confirm {isDrop ? "drop-off" : "pickup"}</PrimaryButton>
      </div>
    </div>
  );
}

function PackageScreen({ step, total, onBack, onNext, category, setCategory, size, setSize, fragile, setFragile, recipient, setRecipient, recipientPhone, setRecipientPhone, cod, setCod }) {
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <FlowHeader title="Package details" step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-3">
        <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>WHAT ARE YOU SENDING?</p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button key={c.id} onClick={() => setCategory(c.id)} className="rounded-2xl py-3 flex flex-col items-center gap-1.5" style={{ backgroundColor: active ? COLORS.ink : COLORS.paperDim }}>
                <c.icon size={18} color={active ? COLORS.amber : COLORS.inkFaint} />
                <span className="text-xs font-bold" style={{ color: active ? COLORS.paper : COLORS.inkFaint }}>{c.label}</span>
              </button>
            );
          })}
        </div>

        <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>SIZE</p>
        <div className="flex gap-2 mb-5">
          {["Small", "Medium", "Large"].map((s) => {
            const active = size === s;
            return (
              <button key={s} onClick={() => setSize(s)} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: active ? COLORS.teal : COLORS.paperDim }}>
                <span className="text-xs font-bold" style={{ color: active ? COLORS.paper : COLORS.inkFaint }}>{s}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-2xl px-4 py-3 mb-5" style={{ backgroundColor: COLORS.paperDim }}>
          <div>
            <p className="text-sm font-bold" style={{ color: COLORS.ink }}>Fragile item</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>Handled with extra care</p>
          </div>
          <ToggleSwitch checked={fragile} onChange={setFragile} />
        </div>

        <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>RECIPIENT</p>
        <div className="rounded-2xl px-4 py-3 mb-3 flex flex-col gap-3" style={{ backgroundColor: COLORS.paperDim }}>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Recipient name" className="bg-transparent outline-none text-sm font-semibold" style={{ color: COLORS.ink }} />
          <div style={{ height: 1, backgroundColor: COLORS.paper }} />
          <input value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} placeholder="Recipient phone" className="bg-transparent outline-none text-sm font-semibold" style={{ color: COLORS.ink }} />
        </div>

        <button className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 mb-5" style={{ backgroundColor: COLORS.paperDim, border: `1.5px dashed ${COLORS.inkFaint}` }}>
          <Camera size={16} color={COLORS.inkFaint} />
          <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>Add a photo of the item</span>
        </button>

        <div className="flex items-center justify-between rounded-2xl px-4 py-3 mb-2" style={{ backgroundColor: COLORS.paperDim }}>
          <div>
            <p className="text-sm font-bold" style={{ color: COLORS.ink }}>Cash on delivery</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>Rider collects payment from recipient</p>
          </div>
          <ToggleSwitch checked={cod} onChange={setCod} />
        </div>
      </div>
      <div className="px-5 pb-4 pt-2"><PrimaryButton onClick={onNext} disabled={!recipient || !recipientPhone}>Get price</PrimaryButton></div>
    </div>
  );
}

function EstimateScreen({ step, total, onBack, onNext, express, setExpress, payment, setPayment, price, pickupCoord, dropoffCoord, routeCoords, etaMin, quoteLoading, quoteError, submitting, submitError }) {
  const baseEta = etaMin ? Math.round(etaMin) : 28;
  const expressEta = Math.max(8, Math.round(baseEta * 0.55));
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <FlowHeader title="Review & pay" step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-3">
        <div className="relative rounded-2xl mb-4 overflow-hidden" style={{ height: 130 }}>
          <LiveMap center={pickupCoord} fitPoints={[pickupCoord, dropoffCoord]} routeCoords={routeCoords} pins={[{ ...pickupCoord, color: COLORS.teal }, { ...dropoffCoord, color: COLORS.amber }]} />
        </div>

        <div className="flex items-center justify-between rounded-2xl px-4 py-3 mb-4" style={{ backgroundColor: COLORS.amberSoft }}>
          <div className="flex items-center gap-2">
            <Zap size={16} color={COLORS.amberDeep} />
            <div>
              <p className="text-sm font-bold" style={{ color: COLORS.amberDeep }}>Express delivery</p>
              <p className="text-xs" style={{ color: COLORS.amberDeep, opacity: 0.75 }}>{express ? `${expressEta} min` : `${baseEta} min`} · +TZS 1,200</p>
            </div>
          </div>
          <ToggleSwitch checked={express} onChange={setExpress} />
        </div>

        <div className="rounded-2xl px-4 py-4 mb-4" style={{ backgroundColor: COLORS.paperDim }}>
          {quoteLoading && <p className="text-sm" style={{ color: COLORS.inkFaint }}>Getting your quote…</p>}
          {quoteError && <p className="text-sm font-semibold" style={{ color: "#C0392B" }}>{quoteError}</p>}
          {!quoteLoading && !quoteError && price.rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between mb-2">
              <span className="text-sm" style={{ color: COLORS.inkFaint }}>{r.label}</span>
              <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{fmtTZS(r.amount)}</span>
            </div>
          ))}
          {!quoteLoading && !quoteError && (
            <>
              <div style={{ height: 1, backgroundColor: COLORS.paper, margin: "8px 0" }} />
              <div className="flex items-center justify-between">
                <span className="text-base font-extrabold" style={{ color: COLORS.ink }}>Total</span>
                <span className="text-base font-extrabold" style={{ color: COLORS.ink }}>{fmtTZS(price.total)}</span>
              </div>
            </>
          )}
        </div>

        <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>PAY WITH</p>
        <div className="flex gap-2 mb-2">
          {[
            { id: "momo", label: "Mobile Money", icon: Wallet },
            { id: "card", label: "Card", icon: CreditCard },
            { id: "cash", label: "Cash", icon: Banknote },
          ].map((p) => {
            const active = payment === p.id;
            return (
              <button key={p.id} onClick={() => setPayment(p.id)} className="flex-1 rounded-2xl py-3 flex flex-col items-center gap-1" style={{ backgroundColor: active ? COLORS.ink : COLORS.paperDim }}>
                <p.icon size={16} color={active ? COLORS.amber : COLORS.inkFaint} />
                <span className="text-xs font-bold" style={{ color: active ? COLORS.paper : COLORS.inkFaint }}>{p.label}</span>
              </button>
            );
          })}
        </div>
        {submitError && <p className="text-xs font-semibold mt-1" style={{ color: "#C0392B" }}>{submitError}</p>}
      </div>
      <div className="px-5 pb-4 pt-2">
        <PrimaryButton onClick={onNext} disabled={quoteLoading || !!quoteError || submitting}>
          {submitting ? "Placing order…" : `Confirm delivery · ${fmtTZS(price.total)}`}
        </PrimaryButton>
      </div>
    </div>
  );
}

function MatchingScreen({ onCancel, pickupCoord }) {
  return (
    <div className="h-full relative" style={{ backgroundColor: COLORS.land }}>
      <LiveMap center={pickupCoord} pins={[{ ...pickupCoord, color: COLORS.teal }]} pulse />
      <div className="absolute top-0 left-0 right-0" style={{ zIndex: 10 }}>
        <StatusBar />
        <div className="px-5 mt-2">
          <button onClick={onCancel} className="rounded-full px-4 py-2 text-xs font-bold" style={{ backgroundColor: COLORS.paper, color: COLORS.ink }}>Cancel</button>
        </div>
      </div>
      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl px-6 pt-6 pb-10 text-center" style={{ backgroundColor: COLORS.paper, zIndex: 10 }}>
        <div className="mx-auto mb-3 rounded-full flex items-center justify-center spin-slow" style={{ width: 52, height: 52, backgroundColor: COLORS.amberSoft }}>
          <Radar size={24} color={COLORS.amberDeep} />
        </div>
        <h3 className="font-extrabold text-lg mb-1" style={{ color: COLORS.ink }}>Finding your rider…</h3>
        <p className="text-sm" style={{ color: COLORS.inkFaint }}>Matching you with the nearest available rider.</p>
      </div>
    </div>
  );
}

// Rider position per tracking state: real road-route interpolation for the
// in-transit legs (6/7) when OSRM has resolved, straight-line lerp as a
// graceful fallback while it's loading or if it's unreachable.
function getRiderPosition(step, pickupCoord, dropoffCoord, routeCoords) {
  if (step === 3) return RIDER_START;
  if (step === 4) return lerp(RIDER_START, pickupCoord, 0.7);
  if (step === 5) return pickupCoord;
  if (step === 6) return (routeCoords && pointAlongRoute(routeCoords, 0.35)) || lerp(pickupCoord, dropoffCoord, 0.35);
  if (step === 7) return (routeCoords && pointAlongRoute(routeCoords, 0.75)) || lerp(pickupCoord, dropoffCoord, 0.75);
  if (step === 8 || step === 9) return dropoffCoord;
  return pickupCoord;
}

function TrackingScreen({ trackingStep, pickupCoord, dropoffCoord, routeCoords, orderId, liveRiderLocation, rider }) {
  const current = STATES.find((s) => s.id === trackingStep) || STATES[2];
  const showRider = trackingStep >= 3;
  // Real GPS wins the moment the rider's app has sent one ping; until
  // then (or if the connection drops), fall back to the simulated
  // position so the map never looks empty or frozen.
  const liveRiderPos = liveRiderLocation
    ? { lat: liveRiderLocation.latitude, lng: liveRiderLocation.longitude }
    : null;
  const riderPos = showRider ? (liveRiderPos || getRiderPosition(trackingStep, pickupCoord, dropoffCoord, routeCoords)) : null;

  // Use real rider data if available, else fallback gracefully
  const displayRider = rider || {
    name: "Rider",
    vehicleType: null,
    ratingAvg: null,
    ratingCount: 0,
  };
  return (
    <div className="h-full relative" style={{ backgroundColor: COLORS.land }}>
      <LiveMap
        center={pickupCoord}
        fitPoints={[pickupCoord, dropoffCoord]}
        routeCoords={routeCoords}
        pins={[{ ...pickupCoord, color: COLORS.teal }, { ...dropoffCoord, color: COLORS.amber }]}
        riderPos={riderPos}
      />
      <div className="absolute top-0 left-0 right-0" style={{ zIndex: 10 }}>
        <StatusBar />
        <div className="mx-5 mt-2 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: COLORS.paper, boxShadow: "0 6px 20px rgba(16,34,28,0.15)" }}>
          <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, backgroundColor: COLORS.amberSoft }}>
            <Bike size={16} color={COLORS.amberDeep} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{current.label}</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{current.desc}</p>
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {liveRiderPos && (
              <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: COLORS.amberDeep }}>
                <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: COLORS.amberDeep }} />
                LIVE GPS
              </span>
            )}
            <span className="text-xs font-bold" style={{ color: COLORS.teal }}>{orderId || "#"}</span>
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl px-5 pt-4 pb-6" style={{ backgroundColor: COLORS.paper, boxShadow: "0 -8px 30px rgba(16,34,28,0.18)", zIndex: 10 }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full flex items-center justify-center font-extrabold flex-shrink-0" style={{ width: 48, height: 48, backgroundColor: COLORS.teal, color: COLORS.paper }}>{displayRider.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}</div>
          <div className="flex-1">
            <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{displayRider.name}</p>
            <div className="flex items-center gap-1">
              {displayRider.ratingAvg && <Star size={11} fill={COLORS.amber} color={COLORS.amber} />}
              <span className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>
                {displayRider.ratingAvg ? `${displayRider.ratingAvg.toFixed(1)} · ` : ""}{displayRider.vehicleType || "Rider"}
              </span>
            </div>
          </div>
          <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, backgroundColor: COLORS.paperDim }}>
            <MessageCircle size={16} color={COLORS.ink} />
          </button>
          <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, backgroundColor: COLORS.ink }}>
            <Phone size={16} color={COLORS.paper} />
          </button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 130 }}>
          {STATES.map((s) => {
            const done = s.id < trackingStep;
            const active = s.id === trackingStep;
            return (
              <div key={s.id} className="flex items-center gap-2.5">
                {done ? <CheckCircle2 size={16} color={COLORS.teal} /> : <Circle size={16} color={active ? COLORS.amber : COLORS.paperDim} fill={active ? COLORS.amber : "none"} />}
                <span className="text-xs font-semibold" style={{ color: done || active ? COLORS.ink : COLORS.inkFaint, opacity: done || active ? 1 : 0.5 }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DeliveredScreen({ price, rating, setRating, tags, toggleTag, onSubmit, onSkip, submitting, riderName }) {
  // The star rating (1-5) is real — POST /shipments/:id/rate-rider.
  // These compliment tags have no matching backend field (the DTO is
  // just { rating }), so they stay a local-only gesture, same as before.
  const TAGS = ["Fast", "Polite", "Careful with package", "On time"];
  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="flex flex-col items-center text-center mt-4 mb-6">
        <div className="rounded-full flex items-center justify-center mb-4 pop-in" style={{ width: 68, height: 68, backgroundColor: COLORS.green }}>
          <Check size={30} color={COLORS.paper} strokeWidth={3} />
        </div>
        <h2 className="text-2xl font-extrabold" style={{ color: COLORS.ink }}>Delivered!</h2>
        <p className="text-sm mt-1" style={{ color: COLORS.inkFaint }}>Your package arrived safely. Receipt issued.</p>
      </div>

      <div className="rounded-2xl px-4 py-4 mb-6 flex items-center justify-between" style={{ backgroundColor: COLORS.paperDim }}>
        <div>
          <p className="text-xs" style={{ color: COLORS.inkFaint }}>Total paid</p>
          <p className="text-lg font-extrabold" style={{ color: COLORS.ink }}>{fmtTZS(price.total)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: COLORS.inkFaint }}>Duration</p>
          <p className="text-lg font-extrabold" style={{ color: COLORS.ink }}>28 min</p>
        </div>
      </div>

      <p className="text-sm font-bold text-center mb-3" style={{ color: COLORS.ink }}>Rate {riderName ? riderName.split(" ")[0] : "your rider"}</p>
      <div className="flex justify-center gap-2 mb-5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)}>
            <Star size={30} fill={n <= rating ? COLORS.amber : "none"} color={n <= rating ? COLORS.amber : COLORS.paperDim} strokeWidth={1.8} />
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 justify-center mb-6">
        {TAGS.map((t) => {
          const active = tags.includes(t);
          return (
            <button key={t} onClick={() => toggleTag(t)} className="rounded-full px-3 py-2" style={{ backgroundColor: active ? COLORS.teal : COLORS.paperDim }}>
              <span className="text-xs font-bold" style={{ color: active ? COLORS.paper : COLORS.inkFaint }}>{t}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />
      <div className="pb-4">
        <PrimaryButton onClick={onSubmit} disabled={rating === 0 || submitting}>
          {submitting ? "Submitting…" : "Submit rating"}
        </PrimaryButton>
        <SecondaryLink onClick={onSkip}>Skip for now</SecondaryLink>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

function App() {
  const [screen, setScreen] = useState("splash");
  const [tab, setTab] = useState("home");
  const [phone, setPhone] = useState("712345678");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [pickup, setPickup] = useState(DEFAULT_PICKUP);
  const [dropoff, setDropoff] = useState(DEFAULT_DROPOFF);
  const [pickupCoord, setPickupCoord] = useState(DEFAULT_PICKUP_COORD);
  const [dropoffCoord, setDropoffCoord] = useState(DEFAULT_DROPOFF_COORD);
  const geo = useGeolocation();
  const { route } = useRoadRoute(pickupCoord, dropoffCoord);
  const routeCoords = route ? route.coords : [pickupCoord, dropoffCoord];

  // Ask for location the moment the map screen first appears — same trigger
  // point Bolt/Uber use — rather than making the person hunt for a button.
  const hasAutoRequestedRef = useRef(false);
  useEffect(() => {
    if (screen === "home" && !hasAutoRequestedRef.current) {
      hasAutoRequestedRef.current = true;
      geo.request();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Once granted, your real position silently becomes the pickup point and
  // address — no separate "use my location" tap needed downstream.
  useEffect(() => {
    if (geo.status === "granted" && geo.coords) {
      setPickupCoord(geo.coords);
      reverseGeocode(geo.coords).then((addr) => { if (addr) setPickup(addr); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.status]);

  const [category, setCategory] = useState("parcel");
  const [size, setSize] = useState("Small");
  const [fragile, setFragile] = useState(false);
  const [recipient, setRecipient] = useState("Neema K.");
  const [recipientPhone, setRecipientPhone] = useState("0754 221 909");
  const [cod, setCod] = useState(false);
  const [express, setExpress] = useState(false);
  const [payment, setPayment] = useState("momo");

  const [trackingStep, setTrackingStep] = useState(1);
  const [liveRiderLocation, setLiveRiderLocation] = useState(null);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState([]);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  const toggleTag = (t) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  // Weight the backend's pricing model actually needs — the UI's size
  // picker doesn't map to kg anywhere else, so this is our own estimate,
  // not something the backend defines.
  const WEIGHT_KG_FOR_SIZE = { Small: 1, Medium: 3, Large: 8 };

  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  // Real quote from POST /pricing/calculate — replaces the old
  // client-side fake formula. Only the fields the backend's pricing
  // model actually prices (base + distance + weight + surge) show up;
  // size/fragile/express aren't priced server-side yet, so they no
  // longer appear as their own line items.
  useEffect(() => {
    if (screen !== "estimate") return;
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const distanceKm = route ? route.distanceKm : haversineKm(pickupCoord, dropoffCoord);
    api
      .calculatePrice({ distanceKm, weightKg: WEIGHT_KG_FOR_SIZE[size] })
      .then((q) => { if (!cancelled) setQuote(q); })
      .catch((err) => { if (!cancelled) setQuoteError(err.message || "Could not get a quote — check the backend is running."); })
      .finally(() => { if (!cancelled) setQuoteLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, size, route, pickupCoord.lat, pickupCoord.lng, dropoffCoord.lat, dropoffCoord.lng]);

  const price = useMemo(() => {
    if (!quote) return { rows: [], total: 0 };
    const rows = [
      { label: "Base fare", amount: Math.round(Number(quote.basePrice)) },
      { label: "Distance", amount: Math.round(Number(quote.distanceCharge)) },
      { label: `Weight (${WEIGHT_KG_FOR_SIZE[size]}kg est.)`, amount: Math.round(Number(quote.weightCharge)) },
      ...(Number(quote.surgeAmount) > 0 ? [{ label: "Surge", amount: Math.round(Number(quote.surgeAmount)) }] : []),
    ];
    return { rows, total: Math.round(Number(quote.price)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  const [shipment, setShipment] = useState(null);
  const [rider, setRider] = useState(null);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderError, setOrderError] = useState(null);

  const [user, setUser] = useState(null);

  const handleVerifyOtp = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const result = await api.loginOrRegister(phone);
      setUser(result.user);
      setScreen("home");
    } catch (err) {
      setAuthError(err.message || "Could not verify. Try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  // Real order placement: create the shipment (server computes its own
  // authoritative price the same way /pricing/calculate just previewed),
  // initiate payment, and — for MPESA/STRIPE — fire the demo webhook
  // shim so the mocked provider "confirms" without a real gateway. CASH
  // has no such shim: it genuinely waits on a rider/admin to confirm
  // collection, so the shipment will stay at QUOTED until that happens
  // elsewhere (there's no rider app wired up in this pass to do that).
  const handleConfirmOrder = async () => {
    setOrderError(null);
    setOrderSubmitting(true);
    try {
      const created = await api.createShipment({
        pickupLocation: { latitude: pickupCoord.lat, longitude: pickupCoord.lng, address: pickup },
        dropoffLocation: { latitude: dropoffCoord.lat, longitude: dropoffCoord.lng, address: dropoff },
        packageWeightKg: WEIGHT_KG_FOR_SIZE[size],
        packageDescription: `${category} · ${size}${fragile ? " · fragile" : ""} · to ${recipient} (${recipientPhone})`,
      });
      setShipment(created);

      const paymentRecord = await api.initiatePayment({ shipmentId: created.id, uiMethod: payment, phone });
      await api.simulateProviderConfirmation(paymentRecord);

      // Only succeeds once the shipment is actually CONFIRMED (i.e. not
      // for CASH, per the note above) — a failure here is expected and
      // silently ignored rather than blocking the order.
      try {
        await api.requestDispatch(created.id);
      } catch {
        /* not yet CONFIRMED — tracking screen will just show it hasn't progressed */
      }

      setScreen("matching");
    } catch (err) {
      setOrderError(err.message || "Could not place the order. Try again.");
    } finally {
      setOrderSubmitting(false);
    }
  };

  // Maps the backend's real ShipmentStatus onto the UI's 9-step tracker.
  // ASSIGNED..OUT_FOR_DELIVERY only ever appear here once a rider app is
  // wired up to actually accept and progress a shipment — until then a
  // real shipment will realistically sit at step 1 or 2.
  const STATUS_TO_STEP = {
    CREATED: 1, QUOTED: 1, CONFIRMED: 1,
    ASSIGNMENT_PENDING: 2,
    ASSIGNED: 3,
    PICKUP_IN_PROGRESS: 4,
    PICKED_UP: 5,
    IN_TRANSIT: 6,
    OUT_FOR_DELIVERY: 7,
    DELIVERED: 8,
    COMPLETED: 9,
  };

  // Polls the real shipment while watching it move through matching and
  // tracking — replaces the old fixed-timer simulation. No fake step
  // advancement: whatever this shows is whatever the backend actually
  // reports right now.
  useEffect(() => {
    if ((screen !== "matching" && screen !== "tracking") || !shipment) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const fresh = await api.getShipment(shipment.id);
        if (cancelled) return;
        setShipment(fresh);

        if (fresh.status === "CANCELLED") return;

        const step = STATUS_TO_STEP[fresh.status] ?? 1;
        setTrackingStep(step);

        if (screen === "matching" && step >= 2) setScreen("tracking");

        if (fresh.status === "DELIVERED") {
          api.completeShipment(fresh.id).catch(() => {});
          setScreen("delivered");
        }
      } catch {
        // transient network hiccup — retry on the next tick
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [screen, shipment?.id]);

  // Live rider GPS over the /tracking WebSocket — separate from the status
  // poll above (which still owns "what step are we on"). This only ever
  // supplies a real GPS fix (or null if the rider hasn't sent one yet);
  // the map falls back to the old simulated position while this is null,
  // and switches to the real one the moment a fix arrives. Reset whenever
  // the shipment changes so a stale rider position from a previous order
  // can't linger onscreen.
  useEffect(() => {
    setLiveRiderLocation(null);
    if ((screen !== "matching" && screen !== "tracking") || !shipment?.id) return;

    const unsubscribe = api.subscribeToShipmentTracking(shipment.id, (snapshot) => {
      setLiveRiderLocation(snapshot.riderLocation);
    });
    return unsubscribe;
  }, [screen, shipment?.id]);

  // Fetch rider public profile when assigned (riderId becomes available)
  useEffect(() => {
    if (!shipment?.riderId) { setRider(null); return; }
    api.getRiderPublicProfile(shipment.riderId)
      .then((data) => setRider(data))
      .catch(() => setRider(null));
  }, [shipment?.riderId]);

  const resetBooking = () => {
    setTrackingStep(1);
    setRating(0);
    setTags([]);
    setShipment(null);
    setOrderError(null);
    setQuote(null);
    if (geo.status === "granted" && geo.coords) {
      setPickupCoord(geo.coords);
      reverseGeocode(geo.coords).then((addr) => setPickup(addr || DEFAULT_PICKUP));
    } else {
      setPickup(DEFAULT_PICKUP);
      setPickupCoord(DEFAULT_PICKUP_COORD);
    }
    setDropoff(DEFAULT_DROPOFF);
    setDropoffCoord(DEFAULT_DROPOFF_COORD);
  };

  const goHome = () => { resetBooking(); setTab("home"); setScreen("home"); };

  // POST /shipments/:id/rate-rider — only fires when the customer
  // actually picks stars and taps Submit, never on Skip. A failure here
  // (already rated, transient network issue) doesn't block the customer
  // from finishing — they still land on Home either way.
  const handleSubmitRating = async () => {
    if (!shipment) { goHome(); return; }
    setRatingSubmitting(true);
    try {
      await api.rateRider(shipment.id, rating);
    } catch (err) {
      console.error("Rating submission failed", err);
    } finally {
      setRatingSubmitting(false);
      goHome();
    }
  };

  let content;
  if (screen === "splash") content = <SplashScreen onNext={() => setScreen("phone")} />;
  else if (screen === "phone") content = <PhoneEntryScreen phone={phone} setPhone={setPhone} onNext={() => setScreen("otp")} onBack={() => setScreen("splash")} />;
  else if (screen === "otp") content = <OtpScreen otp={otp} setOtp={setOtp} phone={phone} onNext={handleVerifyOtp} onBack={() => setScreen("phone")} loading={authLoading} error={authError} />;
  else if (screen === "home") {
    if (tab === "activity") content = <ActivityScreen onBack={() => setTab("home")} onSend={() => setScreen("pickup")} />;
    else if (tab === "account") content = <AccountScreen onBack={() => setTab("home")} user={user} />;
    else content = <HomeScreenFull onSend={() => setScreen("pickup")} tab={tab} setTab={setTab} pickupCoord={pickupCoord} geo={geo} user={user} />;
  } else if (screen === "pickup") {
    content = (
      <LocationScreen
        type="pickup" value={pickup} setValue={setPickup} step={1} total={4} onBack={goHome} onNext={() => setScreen("dropoff")}
        coord={pickupCoord} onCoordChange={setPickupCoord} pickupCoord={pickupCoord} geo={geo}
      />
    );
  } else if (screen === "dropoff") {
    content = (
      <LocationScreen
        type="dropoff" value={dropoff} setValue={setDropoff} step={2} total={4} onBack={() => setScreen("pickup")} onNext={() => setScreen("package")}
        coord={dropoffCoord} onCoordChange={setDropoffCoord} pickupCoord={pickupCoord} geo={geo}
      />
    );
  } else if (screen === "package") {
    content = (
      <PackageScreen
        step={3} total={4} onBack={() => setScreen("dropoff")} onNext={() => setScreen("estimate")}
        category={category} setCategory={setCategory} size={size} setSize={setSize}
        fragile={fragile} setFragile={setFragile} recipient={recipient} setRecipient={setRecipient}
        recipientPhone={recipientPhone} setRecipientPhone={setRecipientPhone} cod={cod} setCod={setCod}
      />
    );
  } else if (screen === "estimate") {
    content = (
      <EstimateScreen
        step={4} total={4} onBack={() => setScreen("package")} onNext={handleConfirmOrder}
        express={express} setExpress={setExpress} payment={payment} setPayment={setPayment} price={price}
        pickupCoord={pickupCoord} dropoffCoord={dropoffCoord} routeCoords={routeCoords} etaMin={route ? route.durationMin : null}
        quoteLoading={quoteLoading} quoteError={quoteError} submitting={orderSubmitting} submitError={orderError}
      />
    );
  } else if (screen === "matching") {
    content = <MatchingScreen onCancel={goHome} pickupCoord={pickupCoord} />;
  } else if (screen === "tracking") {
    content = <TrackingScreen trackingStep={trackingStep} pickupCoord={pickupCoord} dropoffCoord={dropoffCoord} routeCoords={routeCoords} orderId={shipment?.id ? `#${shipment.id.slice(0, 8).toUpperCase()}` : null} liveRiderLocation={liveRiderLocation} rider={rider} />;
  } else if (screen === "delivered") {
    content = (
      <DeliveredScreen
        price={price} rating={rating} setRating={setRating} tags={tags} toggleTag={toggleTag}
        onSubmit={handleSubmitRating} onSkip={goHome} submitting={ratingSubmitting} riderName={rider?.name}
      />
    );
  }

  return (
    <div className="wazzar-shell w-full" style={{ height: "100dvh", backgroundColor: COLORS.ink, fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Manrope', sans-serif; box-sizing: border-box; }
        html, body, #root { height: 100%; }
        .leaflet-tile-pane { filter: grayscale(0.42) saturate(0.7) brightness(1.05) contrast(0.97); }
        .leaflet-container { background: ${COLORS.land}; font-family: 'Manrope', sans-serif; }
        .route-thread { animation: dash 1.6s linear infinite; }
        @keyframes dash { to { stroke-dashoffset: -28; } }
        .pulse-ring { animation: pulse-grow 2.2s ease-out infinite; }
        @keyframes pulse-grow { 0% { transform: scale(1); opacity: 0.65; } 100% { transform: scale(3.4); opacity: 0; } }
        .spin-slow { animation: spin 2.6s linear infinite; }
        .locate-spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .pop-in { animation: pop 0.5s cubic-bezier(.34,1.56,.64,1); }
        @keyframes pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
        .leaflet-marker-icon.rider-marker { transition: transform 2s ease-in-out; }
        @media (prefers-reduced-motion: reduce) {
          .route-thread, .pulse-ring, .spin-slow, .pop-in, .locate-spin { animation: none !important; }
          .leaflet-marker-icon.rider-marker { transition: none !important; }
        }
        .wazzar-statusbar { padding-top: max(env(safe-area-inset-top), 10px) !important; }
      `}</style>

      <div className="w-full h-full overflow-hidden relative" style={{ backgroundColor: COLORS.paper }}>
        {content}
      </div>
    </div>
  );
}

export default App;
