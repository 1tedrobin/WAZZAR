/* ========================================================================
   WAZZAR RIDER APP — standalone build, split out of the original combined
   WAZZAR Suite prototype. Owns nothing about Customer/Business/Admin.
   ======================================================================== */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  MapPin, ChevronLeft, ChevronRight, Star, Phone, MessageCircle, Camera, Check, CheckCircle2, Circle, Wallet, Bike, Signal, Wifi, BatteryFull, Package, Home, User, Sparkles, Navigation, ShieldAlert, TrendingUp, Clock, Download,
} from "lucide-react";
import * as api from "./api";

// Dar es Salaam fallback center — used only before the browser grants a
// real GPS fix (see useGeolocation below). Not a mock job location
// anymore; every actual delivery's coordinates come from the shipment
// the backend returns.
const RIDER_BASE = { lat: -6.779, lng: 39.198 };

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
  coral: "#E1483B",
  land: "#E4E9DD",
  water: "#BEDFE2",
  road: "#CBD3C2",
};

const fmtTZS = (n) => `TZS ${n.toLocaleString("en-US")}`;

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

const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });

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

// Real browser geolocation, high-accuracy mode, only ever fired by an
// explicit user action (never automatically) — .request() is called when
// the rider taps "Go online," and the browser's own permission prompt is
// the consent gate.
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

// Builds the same shape the old LEG_CONFIG mock had, but from a real
// shipment's pickupLocation/dropoffLocation (see CreateShipmentDto on
// the backend — {latitude, longitude, address, instruction}). The
// backend has no per-leg contact-name field, so contactName falls back
// to a role label rather than inventing a person's name.
function legConfigFor(shipment, riderPos) {
  if (!shipment) return null;
  const pickup = shipment.pickupLocation;
  const dropoff = shipment.dropoffLocation;
  const pickupPos = { lat: pickup.latitude, lng: pickup.longitude };
  const dropoffPos = { lat: dropoff.latitude, lng: dropoff.longitude };
  return {
    pickup: {
      pinColor: COLORS.teal,
      startPos: riderPos,
      targetPos: pickupPos,
      instruction: pickup.instruction || pickup.address,
      contactName: "Sender",
      contactRole: "Pickup contact",
      ctaLabel: "I've arrived at pickup",
    },
    dropoff: {
      pinColor: COLORS.amber,
      startPos: pickupPos,
      targetPos: dropoffPos,
      instruction: dropoff.instruction || dropoff.address,
      contactName: "Recipient",
      contactRole: "Drop-off contact",
      ctaLabel: "I've arrived at destination",
    },
  };
}

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
      style={{ backgroundColor: disabled ? COLORS.paperDim : COLORS.amber, color: disabled ? COLORS.inkFaint : COLORS.paper, ...style }}
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

function SOSButton() {
  return (
    <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, backgroundColor: COLORS.paper }}>
      <ShieldAlert size={16} color={COLORS.coral} />
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

// Real upload via POST /uploads — was a fake toggle button before (see
// MASTER_GAPS_AND_ROADMAP.md, "File/photo upload endpoint"). `url`
// being set is what "done" means now; `onFile` receives the picked
// File and is expected to call api.uploadFile and store the result.
function UploadBox({ label, url, uploading, onFile }) {
  const inputRef = useRef(null);
  const done = !!url;
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files && e.target.files[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current && inputRef.current.click()}
        disabled={uploading}
        className="w-full flex items-center justify-between gap-2 rounded-2xl py-3 px-4"
        style={{ backgroundColor: done ? COLORS.tealSoft : COLORS.paperDim, border: done ? `1.5px solid ${COLORS.teal}` : `1.5px dashed ${COLORS.inkFaint}` }}
      >
        <div className="flex items-center gap-2">
          <Camera size={16} color={done ? COLORS.teal : COLORS.inkFaint} />
          <span className="text-xs font-bold" style={{ color: done ? COLORS.teal : COLORS.inkFaint }}>
            {uploading ? "Uploading…" : label}
          </span>
        </div>
        {done && <CheckCircle2 size={16} color={COLORS.teal} />}
      </button>
    </>
  );
}

function ChecklistRow({ label, checked, onToggle }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-3 rounded-2xl py-3 px-4" style={{ backgroundColor: COLORS.paperDim }}>
      {checked ? <CheckCircle2 size={20} color={COLORS.teal} /> : <Circle size={20} color={COLORS.inkFaint} />}
      <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{label}</span>
    </button>
  );
}

// Live map: real OpenStreetMap tiles via Leaflet, loaded from cdnjs at
// runtime. Same approach as the Customer app — tiles are color-graded via
// a CSS filter on Leaflet's tile pane so they read as "WAZZAR's map," while
// pins/route/rider marker are custom-drawn on top and stay fully vivid.
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

function LiveMap({ center, zoom = 14.6, interactive, pins, routeCoords, riderPos, pulse, fitPoints, accuracyCenter, accuracyRadius, onLocate, locating }) {
  const { ready, failed } = useLeafletReady();
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const staticLayerRef = useRef(null);
  const riderMarkerRef = useRef(null);

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
      {onLocate && (
        <button
          onClick={onLocate}
          className="absolute flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ bottom: 14, right: 14, width: 40, height: 40, backgroundColor: COLORS.paper, boxShadow: "0 4px 14px rgba(16,34,28,0.28)" }}
        >
          {locating ? (
            <div className="locate-spin" style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${COLORS.paperDim}`, borderTopColor: COLORS.teal }} />
          ) : (
            <Navigation size={17} color={COLORS.teal} />
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
/* Auth & Registration                                                     */
/* ---------------------------------------------------------------------- */

function SplashScreen({ onNext }) {
  return (
    <div className="h-full flex flex-col items-center justify-between px-8 pb-10" style={{ backgroundColor: COLORS.ink }}>
      <div className="w-full"><StatusBar light /></div>
      <div className="flex flex-col items-center text-center">
        <div className="rounded-3xl flex items-center justify-center mb-6" style={{ width: 84, height: 84, backgroundColor: COLORS.amber }}>
          <Bike size={36} color={COLORS.ink} />
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight" style={{ color: COLORS.paper }}>WAZZAR</h1>
        <p className="mt-3 text-sm font-semibold" style={{ color: COLORS.paper, opacity: 0.7 }}>For Riders</p>
        <p className="text-xs mt-1" style={{ color: COLORS.paper, opacity: 0.45 }}>Earn on your own schedule, riding for WAZZAR.</p>
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
          placeholder="712 345 678" inputMode="numeric"
          className="flex-1 bg-transparent outline-none font-bold text-base" style={{ color: COLORS.ink }}
        />
      </div>
      <div className="flex-1" />
      <div className="pb-4"><PrimaryButton onClick={onNext} disabled={phone.length < 9}>Continue</PrimaryButton></div>
    </div>
  );
}

function OtpScreen({ otp, setOtp, onNext, onBack, phone }) {
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
            key={i} ref={refs[i]} value={d} onChange={(e) => handleChange(i, e.target.value)} inputMode="numeric"
            className="flex-1 text-center text-xl font-extrabold rounded-2xl py-3 outline-none"
            style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink, border: d ? `2px solid ${COLORS.teal}` : "2px solid transparent" }}
          />
        ))}
      </div>
      <div className="mt-2"><SecondaryLink onClick={() => setOtp(["2", "6", "0", "9"])}>Didn't get it? Resend code</SecondaryLink></div>
      <div className="flex-1" />
      <div className="pb-4"><PrimaryButton onClick={onNext} disabled={otp.some((d) => !d)}>Verify</PrimaryButton></div>
    </div>
  );
}

function RegIdentityScreen({
  step, total, onBack, onNext, idNumber, setIdNumber, licenseNumber, setLicenseNumber,
  idDocumentUrl, licenseDocumentUrl, uploadingField, onUploadDocument,
}) {
  const ready = idNumber && licenseNumber && idDocumentUrl && licenseDocumentUrl;
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <FlowHeader title="Verify your identity" step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-3 flex flex-col gap-3">
        <p className="text-xs font-bold tracking-wide" style={{ color: COLORS.inkFaint }}>NATIONAL ID</p>
        <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className="rounded-2xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <UploadBox label="Upload national ID photo" url={idDocumentUrl} uploading={uploadingField === "id"} onFile={(f) => onUploadDocument("id", f)} />

        <p className="text-xs font-bold tracking-wide mt-2" style={{ color: COLORS.inkFaint }}>RIDING LICENCE</p>
        <input value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className="rounded-2xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <UploadBox label="Upload licence photo" url={licenseDocumentUrl} uploading={uploadingField === "license"} onFile={(f) => onUploadDocument("license", f)} />
      </div>
      <div className="px-5 pb-4 pt-2"><PrimaryButton onClick={onNext} disabled={!ready}>Continue</PrimaryButton></div>
    </div>
  );
}

function RegVehicleScreen({
  step, total, onBack, onNext, plate, setPlate, makeModel, setMakeModel,
  vehicleRegistrationDocumentUrl, insuranceDocumentUrl, uploadingField, onUploadDocument,
}) {
  const ready = plate && makeModel && vehicleRegistrationDocumentUrl && insuranceDocumentUrl;
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <FlowHeader title="Your motorcycle" step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-3 flex flex-col gap-3">
        <p className="text-xs font-bold tracking-wide" style={{ color: COLORS.inkFaint }}>PLATE NUMBER</p>
        <input value={plate} onChange={(e) => setPlate(e.target.value)} className="rounded-2xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <p className="text-xs font-bold tracking-wide mt-1" style={{ color: COLORS.inkFaint }}>MAKE & MODEL</p>
        <input value={makeModel} onChange={(e) => setMakeModel(e.target.value)} className="rounded-2xl px-4 py-3 text-sm font-semibold outline-none" style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }} />
        <UploadBox label="Upload registration document" url={vehicleRegistrationDocumentUrl} uploading={uploadingField === "registration"} onFile={(f) => onUploadDocument("registration", f)} />
        <UploadBox label="Upload insurance certificate" url={insuranceDocumentUrl} uploading={uploadingField === "insurance"} onFile={(f) => onUploadDocument("insurance", f)} />
      </div>
      <div className="px-5 pb-4 pt-2"><PrimaryButton onClick={onNext} disabled={!ready}>Continue</PrimaryButton></div>
    </div>
  );
}

function RegProfileScreen({ step, total, onBack, onNext, photoUploaded, setPhotoUploaded, contactName, setContactName, contactPhone, setContactPhone, agreed, setAgreed }) {
  const ready = photoUploaded && contactName && contactPhone && agreed;
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <FlowHeader title="Almost done" step={step} total={total} onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-5 pb-3">
        <div className="flex flex-col items-center mb-5">
          <button onClick={() => setPhotoUploaded(!photoUploaded)} className="rounded-full flex items-center justify-center mb-2" style={{ width: 84, height: 84, backgroundColor: photoUploaded ? COLORS.tealSoft : COLORS.paperDim, border: photoUploaded ? `2px solid ${COLORS.teal}` : `2px dashed ${COLORS.inkFaint}` }}>
            {photoUploaded ? <CheckCircle2 size={26} color={COLORS.teal} /> : <Camera size={22} color={COLORS.inkFaint} />}
          </button>
          <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>Profile photo</span>
        </div>

        <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>EMERGENCY CONTACT</p>
        <div className="rounded-2xl px-4 py-3 mb-4 flex flex-col gap-3" style={{ backgroundColor: COLORS.paperDim }}>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name" className="bg-transparent outline-none text-sm font-semibold" style={{ color: COLORS.ink }} />
          <div style={{ height: 1, backgroundColor: COLORS.paper }} />
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Contact phone" className="bg-transparent outline-none text-sm font-semibold" style={{ color: COLORS.ink }} />
        </div>

        <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ backgroundColor: COLORS.paperDim }}>
          <div className="pr-3">
            <p className="text-sm font-bold" style={{ color: COLORS.ink }}>Rider Partner Agreement</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>I've read and agree to the terms</p>
          </div>
          <ToggleSwitch checked={agreed} onChange={setAgreed} />
        </div>
      </div>
      <div className="px-5 pb-4 pt-2"><PrimaryButton onClick={onNext} disabled={!ready}>Submit for review</PrimaryButton></div>
    </div>
  );
}

// Real rider verification (PATCH /riders/:id/verify) is a single
// ADMIN/SUPER_ADMIN-only flip from ONBOARDING to ACTIVE — there's no
// per-document approval on the backend yet. So unlike the old mock
// (which faked each item turning green one at a time), this screen
// shows the four items as simply "submitted" and polls GET /riders/me
// for the one real status change that matters.
function PendingApprovalScreen({ onDone, checkStatus }) {
  const items = ["National ID", "Riding licence", "Vehicle documents", "Rider Partner Agreement"];

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const rider = await checkStatus();
        if (!cancelled && rider && rider.status === "ACTIVE") {
          onDone();
          return;
        }
      } catch (e) {
        console.error("Rider status check failed", e);
      }
      if (!cancelled) timer = setTimeout(poll, 4000);
    };
    let timer = setTimeout(poll, 4000);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="flex flex-col items-center text-center mt-10 mb-8">
        <div className="rounded-full flex items-center justify-center mb-4" style={{ width: 68, height: 68, backgroundColor: COLORS.amberSoft }}>
          <Clock size={28} color={COLORS.amberDeep} />
        </div>
        <h2 className="text-xl font-extrabold" style={{ color: COLORS.ink }}>Your documents are under review</h2>
        <p className="text-sm mt-2" style={{ color: COLORS.inkFaint }}>We'll notify you the moment you're approved to go online.</p>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: COLORS.paperDim }}>
        {items.map((label, i) => (
          <div key={label} className="flex items-center justify-between px-4 py-3.5" style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.paper}` }}>
            <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{label}</span>
            <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: COLORS.teal }}>
              <CheckCircle2 size={15} /> Submitted
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Home, Wallet, Account                                                   */
/* ---------------------------------------------------------------------- */

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: COLORS.paperDim }}>
      <Icon size={15} color={COLORS.teal} />
      <p className="text-base font-extrabold mt-1.5" style={{ color: COLORS.ink }}>{value}</p>
      <p className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>{label}</p>
    </div>
  );
}

function HomeScreen({ online, onToggleOnline, earningsToday, completedToday, rating, tab, setTab, geo, riderFirstName, searching }) {
  const activePos = geo.status === "granted" ? geo.coords : RIDER_BASE;
  return (
    <div className="h-full relative" style={{ backgroundColor: COLORS.land }}>
      <LiveMap
        center={activePos}
        riderPos={activePos}
        pulse={online}
        accuracyCenter={geo.status === "granted" ? geo.coords : null}
        accuracyRadius={geo.status === "granted" ? geo.accuracy : null}
        onLocate={geo.request}
        locating={geo.status === "locating"}
      />
      {!online && <div className="absolute inset-0" style={{ backgroundColor: COLORS.ink, opacity: 0.3, zIndex: 5 }} />}

      <div className="absolute top-0 left-0 right-0" style={{ zIndex: 10 }}>
        <StatusBar light={!online} />
        <div className="flex items-center justify-between px-5 mt-2">
          <div>
            <p className="text-xs font-semibold" style={{ color: online ? COLORS.inkFaint : COLORS.paper, opacity: online ? 1 : 0.75 }}>Habari,</p>
            <p className="text-xl font-extrabold" style={{ color: online ? COLORS.ink : COLORS.paper }}>{riderFirstName}</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ backgroundColor: online ? COLORS.green : COLORS.paper }}>
            <div className="rounded-full" style={{ width: 7, height: 7, backgroundColor: online ? COLORS.paper : COLORS.inkFaint }} />
            <span className="text-xs font-bold" style={{ color: online ? COLORS.paper : COLORS.inkFaint }}>{online ? "Online" : "Offline"}</span>
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 flex flex-col items-center" style={{ top: "36%", zIndex: 10 }}>
        <button
          onClick={onToggleOnline}
          className="rounded-full flex flex-col items-center justify-center transition-transform active:scale-95"
          style={{ width: 128, height: 128, backgroundColor: online ? COLORS.ink : COLORS.amber, boxShadow: "0 12px 30px rgba(16,34,28,0.35)" }}
        >
          <span className="text-sm font-extrabold" style={{ color: COLORS.paper }}>{online ? "GO" : "GO"}</span>
          <span className="text-sm font-extrabold" style={{ color: COLORS.paper }}>{online ? "OFFLINE" : "ONLINE"}</span>
        </button>
        {online && (
          <p className="text-xs font-semibold mt-3 text-center px-8" style={{ color: COLORS.ink }}>
            {geo.status === "locating" ? "Getting your GPS location…"
              : geo.status === "granted" ? `Searching nearby · GPS accuracy ±${Math.round(geo.accuracy)}m`
              : geo.status === "denied" ? "Location denied — showing approximate area"
              : "Searching for deliveries near you…"}
          </p>
        )}
      </div>

      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl px-5 pt-4" style={{ backgroundColor: COLORS.paper, boxShadow: "0 -8px 30px rgba(16,34,28,0.18)", zIndex: 10 }}>
        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <StatCard icon={TrendingUp} label="Earnings today" value={fmtTZS(earningsToday)} />
          <StatCard icon={Package} label="Deliveries today" value={completedToday} />
          <StatCard icon={Star} label="Rating" value={rating.toFixed(1)} />
          <StatCard icon={CheckCircle2} label="Acceptance rate" value="92%" />
        </div>
        <div className="flex items-center justify-around pt-2 pb-3" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
          {[
            { id: "home", label: "Home", icon: Home },
            { id: "wallet", label: "Wallet", icon: Wallet },
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

function WalletScreen({ balance, deliveries, earningsLoading, onBack, tab, setTab }) {
  const [expanded, setExpanded] = useState(false);
  const [provider, setProvider] = useState("mpesa");
  const [requested, setRequested] = useState(false);

  // Real payout history, one row per DELIVERED/COMPLETED shipment — from
  // GET /riders/me/earnings (added alongside this app; the backend had
  // no rider-facing earnings read before). No withdrawal-history rows
  // yet: there's no withdrawal endpoint on the backend, so "Withdraw"
  // below stays a UI-only demo action, same known-simplification style
  // as the Customer app's own payment-webhook self-call.
  const TX = (deliveries || []).map((d) => ({
    label: `Delivery payout · #${d.shipmentId.slice(0, 8)}`,
    amount: Math.round(parseFloat(d.payout || "0")),
    time: d.deliveredAt ? new Date(d.deliveredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—",
  }));

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="flex items-center gap-3 px-6 mt-2 mb-4">
        <h2 className="text-lg font-extrabold" style={{ color: COLORS.ink }}>Wallet</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-3">
        <div className="rounded-2xl px-5 py-5 mb-4" style={{ backgroundColor: COLORS.ink }}>
          <p className="text-xs font-semibold" style={{ color: COLORS.paper, opacity: 0.6 }}>Available balance</p>
          <p className="text-3xl font-extrabold mt-1" style={{ color: COLORS.paper }}>{fmtTZS(balance)}</p>
          <button onClick={() => { setExpanded(!expanded); setRequested(false); }} className="mt-4 flex items-center justify-center gap-2 rounded-xl py-3 w-full" style={{ backgroundColor: COLORS.amber }}>
            <Download size={15} color={COLORS.ink} />
            <span className="text-sm font-bold" style={{ color: COLORS.ink }}>Withdraw</span>
          </button>
        </div>

        {expanded && (
          <div className="rounded-2xl px-4 py-4 mb-4" style={{ backgroundColor: COLORS.paperDim }}>
            {!requested ? (
              <>
                <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>WITHDRAW TO</p>
                <div className="flex gap-2 mb-4">
                  {[{ id: "mpesa", label: "M-Pesa" }, { id: "tigo", label: "Tigo Pesa" }, { id: "airtel", label: "Airtel" }].map((p) => (
                    <button key={p.id} onClick={() => setProvider(p.id)} className="flex-1 rounded-xl py-2.5" style={{ backgroundColor: provider === p.id ? COLORS.teal : COLORS.paper }}>
                      <span className="text-xs font-bold" style={{ color: provider === p.id ? COLORS.paper : COLORS.inkFaint }}>{p.label}</span>
                    </button>
                  ))}
                </div>
                <PrimaryButton onClick={() => setRequested(true)}>Withdraw {fmtTZS(balance)}</PrimaryButton>
              </>
            ) : (
              <div className="flex items-center gap-3 py-2">
                <CheckCircle2 size={22} color={COLORS.teal} />
                <div>
                  <p className="text-sm font-bold" style={{ color: COLORS.ink }}>Withdrawal requested</p>
                  <p className="text-xs" style={{ color: COLORS.inkFaint }}>Funds usually arrive within minutes.</p>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>RECENT ACTIVITY</p>
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: COLORS.paperDim }}>
          {earningsLoading && (
            <div className="px-4 py-3.5"><span className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>Loading…</span></div>
          )}
          {!earningsLoading && TX.length === 0 && (
            <div className="px-4 py-3.5"><span className="text-xs font-semibold" style={{ color: COLORS.inkFaint }}>No completed deliveries yet.</span></div>
          )}
          {TX.map((t, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5" style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.paper}` }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: COLORS.ink }}>{t.label}</p>
                <p className="text-xs" style={{ color: COLORS.inkFaint }}>{t.time}</p>
              </div>
              <span className="text-sm font-extrabold" style={{ color: t.amount > 0 ? COLORS.green : COLORS.ink }}>
                {t.amount > 0 ? "+" : "−"}{fmtTZS(Math.abs(t.amount))}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-around pt-2 pb-4" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
        {[
          { id: "home", label: "Home", icon: Home },
          { id: "wallet", label: "Wallet", icon: Wallet },
          { id: "account", label: "Account", icon: User },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-1">
            <t.icon size={20} color={tab === t.id ? COLORS.amber : COLORS.inkFaint} strokeWidth={tab === t.id ? 2.6 : 2} />
            <span className="text-xs font-bold" style={{ color: tab === t.id ? COLORS.amber : COLORS.inkFaint }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountScreen({ tab, setTab, user, riderProfile }) {
  const fullName = (user && user.fullName) || "Rider";
  const initials = fullName.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "R";
  const phone = (user && user.phone) || "—";
  const ratingLabel = riderProfile && riderProfile.ratingAvg ? parseFloat(riderProfile.ratingAvg).toFixed(1) : "New";
  const vehicleLabel = riderProfile && (riderProfile.vehicleType || riderProfile.vehicleRegistration)
    ? `${riderProfile.vehicleType || "Vehicle"} · ${riderProfile.vehicleRegistration || "—"}`
    : "No vehicle on file";
  const rows = [
    { label: "Documents", value: riderProfile ? riderProfile.status : "" },
    { label: "License number", value: (riderProfile && riderProfile.licenseNumber) || "—" },
    { label: "Language", value: "English" },
    { label: "Support", value: "" },
  ];
  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <h2 className="text-lg font-extrabold px-6 mt-2 mb-6" style={{ color: COLORS.ink }}>Account</h2>
      <div className="flex-1 overflow-y-auto px-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="rounded-full flex items-center justify-center font-extrabold text-lg flex-shrink-0" style={{ width: 56, height: 56, backgroundColor: COLORS.teal, color: COLORS.paper }}>{initials}</div>
          <div className="flex-1">
            <p className="font-extrabold" style={{ color: COLORS.ink }}>{fullName}</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{phone}</p>
          </div>
          <div className="flex items-center gap-1 rounded-full px-2.5 py-1 flex-shrink-0" style={{ backgroundColor: COLORS.tealSoft }}>
            <Star size={12} color={COLORS.teal} fill={COLORS.teal} />
            <span className="text-xs font-bold" style={{ color: COLORS.teal }}>{ratingLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3 mb-5" style={{ backgroundColor: COLORS.paperDim }}>
          <Bike size={16} color={COLORS.inkFaint} />
          <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{vehicleLabel}</span>
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
      <div className="flex items-center justify-around pt-2 pb-4" style={{ borderTop: `1px solid ${COLORS.paperDim}` }}>
        {[
          { id: "home", label: "Home", icon: Home },
          { id: "wallet", label: "Wallet", icon: Wallet },
          { id: "account", label: "Account", icon: User },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className="flex flex-col items-center gap-1">
            <t.icon size={20} color={tab === t.id ? COLORS.amber : COLORS.inkFaint} strokeWidth={tab === t.id ? 2.6 : 2} />
            <span className="text-xs font-bold" style={{ color: tab === t.id ? COLORS.amber : COLORS.inkFaint }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Dispatch & Delivery workflow                                            */
/* ---------------------------------------------------------------------- */

function RequestScreen({ shipment, onAccept, onDecline, riderPos, accepting }) {
  useEffect(() => {
    const t = setTimeout(onDecline, 25000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipment.id]);

  const pickupPos = { lat: shipment.pickupLocation.latitude, lng: shipment.pickupLocation.longitude };
  const dropoffPos = { lat: shipment.dropoffLocation.latitude, lng: shipment.dropoffLocation.longitude };
  const toPickupKm = haversineKm(riderPos, pickupPos);
  const tripKm = toPickupKm + haversineKm(pickupPos, dropoffPos);
  const payout = Math.round(parseFloat(shipment.riderPayout || shipment.price || "0"));
  const packageLabel = shipment.packageDescription
    ? shipment.packageDescription
    : shipment.packageWeightKg
      ? `Parcel · ${shipment.packageWeightKg} kg`
      : "Parcel";

  return (
    <div className="h-full flex flex-col px-5" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="mt-4 mb-1 rounded-full overflow-hidden" style={{ height: 5, backgroundColor: COLORS.paperDim }}>
        <div className="countdown-bar" style={{ height: "100%", backgroundColor: COLORS.amber, animationDuration: "25s" }} />
      </div>
      <p className="text-xs font-bold text-center mt-3 mb-5 tracking-wide" style={{ color: COLORS.amberDeep }}>NEW DELIVERY REQUEST</p>

      <div className="rounded-3xl px-5 py-6 flex-1 flex flex-col" style={{ backgroundColor: COLORS.ink }}>
        <div className="text-center mb-5">
          <p className="text-xs font-semibold" style={{ color: COLORS.paper, opacity: 0.6 }}>You'll earn</p>
          <p className="text-4xl font-extrabold" style={{ color: COLORS.amber }}>{fmtTZS(payout)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div className="rounded-2xl px-3 py-3" style={{ backgroundColor: COLORS.inkSoft }}>
            <MapPin size={14} color={COLORS.teal} />
            <p className="text-sm font-bold mt-1" style={{ color: COLORS.paper }}>{toPickupKm.toFixed(1)} km</p>
            <p className="text-xs" style={{ color: COLORS.paper, opacity: 0.5 }}>To pickup</p>
          </div>
          <div className="rounded-2xl px-3 py-3" style={{ backgroundColor: COLORS.inkSoft }}>
            <Navigation size={14} color={COLORS.amber} />
            <p className="text-sm font-bold mt-1" style={{ color: COLORS.paper }}>{tripKm.toFixed(1)} km</p>
            <p className="text-xs" style={{ color: COLORS.paper, opacity: 0.5 }}>Total trip</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl px-3 py-3" style={{ backgroundColor: COLORS.inkSoft }}>
          <Package size={16} color={COLORS.paper} />
          <span className="text-sm font-semibold" style={{ color: COLORS.paper }}>{packageLabel}</span>
        </div>

        <div className="flex-1" />
        <div className="flex gap-3">
          <button onClick={onDecline} disabled={accepting} className="flex-1 rounded-2xl py-4 font-bold text-sm" style={{ backgroundColor: COLORS.inkSoft, color: COLORS.paper }}>Decline</button>
          <button onClick={onAccept} disabled={accepting} className="flex-1 rounded-2xl py-4 font-bold text-sm" style={{ backgroundColor: COLORS.amber, color: COLORS.ink, opacity: accepting ? 0.6 : 1 }}>{accepting ? "Accepting…" : "Accept"}</button>
        </div>
      </div>
    </div>
  );
}

function NavigateScreen({ leg, legConfig, orderLabel, onArrive, riderStartOverride }) {
  const cfg = legConfig[leg];
  const startPos = leg === "pickup" && riderStartOverride ? riderStartOverride : cfg.startPos;
  const { route } = useRoadRoute(startPos, cfg.targetPos);
  const routeCoords = route ? route.coords : [startPos, cfg.targetPos];
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
    const steps = [0.15, 0.4, 0.65, 0.9, 1];
    const timers = steps.map((s, i) => setTimeout(() => setProgress(s), 600 + i * 2400));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg, route]);

  const riderPos = pointAlongRoute(routeCoords, progress) || (progress > 0 ? cfg.targetPos : startPos);
  const distanceKm = route ? route.distanceKm : haversineKm(startPos, cfg.targetPos);
  const etaMin = route ? Math.max(1, Math.round(route.durationMin)) : Math.max(1, Math.round((distanceKm / 22) * 60));

  return (
    <div className="h-full relative" style={{ backgroundColor: COLORS.land }}>
      <LiveMap
        center={cfg.targetPos}
        fitPoints={[startPos, cfg.targetPos]}
        routeCoords={routeCoords}
        pins={[{ ...cfg.targetPos, color: cfg.pinColor }]}
        riderPos={riderPos}
      />
      <div className="absolute top-0 left-0 right-0" style={{ zIndex: 10 }}>
        <StatusBar />
        <div className="flex items-center justify-between px-5 mt-2">
          <SOSButton />
          <span className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: COLORS.paper, color: COLORS.teal }}>{orderLabel}</span>
        </div>
        <div className="mx-5 mt-3 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ backgroundColor: COLORS.paper, boxShadow: "0 6px 20px rgba(16,34,28,0.15)" }}>
          <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, backgroundColor: COLORS.amberSoft }}>
            <Navigation size={16} color={COLORS.amberDeep} />
          </div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{cfg.instruction}</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{distanceKm.toFixed(1)} km · {etaMin} min to {leg === "pickup" ? "pickup" : "destination"}</p>
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 rounded-t-3xl px-5 pt-4 pb-6" style={{ backgroundColor: COLORS.paper, boxShadow: "0 -8px 30px rgba(16,34,28,0.18)", zIndex: 10 }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full flex items-center justify-center font-extrabold flex-shrink-0" style={{ width: 44, height: 44, backgroundColor: COLORS.paperDim, color: COLORS.ink }}>
            {cfg.contactName.slice(0, 1)}
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold" style={{ color: COLORS.ink }}>{cfg.contactName}</p>
            <p className="text-xs" style={{ color: COLORS.inkFaint }}>{cfg.contactRole}</p>
          </div>
          <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, backgroundColor: COLORS.paperDim }}>
            <MessageCircle size={16} color={COLORS.ink} />
          </button>
          <button className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, backgroundColor: COLORS.ink }}>
            <Phone size={16} color={COLORS.paper} />
          </button>
        </div>
        <PrimaryButton onClick={onArrive}>{cfg.ctaLabel}</PrimaryButton>
      </div>
    </div>
  );
}

function VerifyPickupScreen({ checklist, setChecklist, otp, setOtp, onNext }) {
  const r0 = useRef(), r1 = useRef(), r2 = useRef(), r3 = useRef();
  const refs = [r0, r1, r2, r3];
  const handleChange = (i, val) => {
    const v = val.replace(/[^0-9]/g, "").slice(-1);
    const next = [...otp];
    next[i] = v;
    setOtp(next);
    if (v && i < 3) refs[i + 1].current?.focus();
  };
  const ready = checklist.matches && checklist.details && otp.every((d) => d);

  return (
    <div className="h-full flex flex-col px-5" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <h2 className="text-xl font-extrabold mt-4 mb-1" style={{ color: COLORS.ink }}>Confirm pickup</h2>
      <p className="text-sm mb-5" style={{ color: COLORS.inkFaint }}>Verify the package before you ride off.</p>

      <div className="flex items-center gap-2 rounded-2xl px-4 py-3 mb-4" style={{ backgroundColor: COLORS.tealSoft }}>
        <Package size={16} color={COLORS.teal} />
        <span className="text-sm font-semibold" style={{ color: COLORS.teal }}>Parcel · Medium · Fragile</span>
      </div>

      <div className="flex flex-col gap-2 mb-5">
        <ChecklistRow label="Package matches the description" checked={checklist.matches} onToggle={() => setChecklist((c) => ({ ...c, matches: !c.matches }))} />
        <ChecklistRow label="Pickup details confirmed" checked={checklist.details} onToggle={() => setChecklist((c) => ({ ...c, details: !c.details }))} />
      </div>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>ASK THE SENDER FOR THE 4-DIGIT PICKUP CODE</p>
      <div className="flex gap-3 mb-2">
        {otp.map((d, i) => (
          <input
            key={i} ref={refs[i]} value={d} onChange={(e) => handleChange(i, e.target.value)} inputMode="numeric"
            className="flex-1 text-center text-xl font-extrabold rounded-2xl py-3 outline-none"
            style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink, border: d ? `2px solid ${COLORS.teal}` : "2px solid transparent" }}
          />
        ))}
      </div>
      <SecondaryLink onClick={() => setOtp(["7", "3", "1", "5"])}>Customer showing code trouble? Auto-fill</SecondaryLink>

      <div className="flex-1" />
      <div className="pb-4"><PrimaryButton onClick={onNext} disabled={!ready}>Confirm pickup</PrimaryButton></div>
    </div>
  );
}

// `photoUrl` comes from a real POST /uploads call now (previously a
// fake toggle — see MASTER_GAPS_AND_ROADMAP.md, "File/photo upload
// endpoint"). `capture="environment"` opens the rear camera directly on
// mobile browsers that support it; falls back to a normal file picker
// otherwise.
function ProofOfDeliveryScreen({ photoUrl, uploading, onCapturePhoto, recipientName, setRecipientName, onComplete, submitting }) {
  const fileInputRef = useRef(null);
  const ready = !!photoUrl && recipientName.trim().length > 0;
  return (
    <div className="h-full flex flex-col px-5" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <h2 className="text-xl font-extrabold mt-4 mb-1" style={{ color: COLORS.ink }}>Capture proof of delivery</h2>
      <p className="text-sm mb-5" style={{ color: COLORS.inkFaint }}>This protects both you and the customer.</p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files && e.target.files[0];
          if (file) onCapturePhoto(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        disabled={uploading}
        className="w-full flex flex-col items-center justify-center gap-2 rounded-2xl mb-4"
        style={{ height: 160, backgroundColor: photoUrl ? COLORS.tealSoft : COLORS.paperDim, border: photoUrl ? `2px solid ${COLORS.teal}` : `2px dashed ${COLORS.inkFaint}` }}
      >
        {photoUrl ? <CheckCircle2 size={28} color={COLORS.teal} /> : <Camera size={26} color={COLORS.inkFaint} />}
        <span className="text-sm font-bold" style={{ color: photoUrl ? COLORS.teal : COLORS.inkFaint }}>
          {uploading ? "Uploading…" : photoUrl ? "Photo captured" : "Tap to take photo"}
        </span>
      </button>

      <p className="text-xs font-bold tracking-wide mb-2" style={{ color: COLORS.inkFaint }}>RECEIVED BY</p>
      <input
        value={recipientName}
        onChange={(e) => setRecipientName(e.target.value)}
        placeholder="Recipient's name"
        className="rounded-2xl px-4 py-3 mb-4 text-sm font-semibold outline-none"
        style={{ backgroundColor: COLORS.paperDim, color: COLORS.ink }}
      />

      <div className="w-full flex flex-col items-center justify-center gap-1 rounded-2xl py-6" style={{ backgroundColor: COLORS.paperDim, border: `1.5px dashed ${COLORS.inkFaint}` }}>
        <span className="text-xs font-bold" style={{ color: COLORS.inkFaint }}>Recipient signature (optional)</span>
      </div>

      <div className="flex-1" />
      <div className="pb-4"><PrimaryButton onClick={onComplete} disabled={!ready || submitting}>{submitting ? "Completing…" : "Complete delivery"}</PrimaryButton></div>
    </div>
  );
}

function CompleteScreen({ shipment, completedToday, customerRating, setCustomerRating, onBackOnline, finishing }) {
  const remaining = Math.max(0, 8 - (completedToday + 1));
  const fare = Math.round(parseFloat(shipment.price || "0"));
  const commission = Math.round(parseFloat(shipment.commission || "0"));
  const payout = Math.round(parseFloat(shipment.riderPayout || "0"));
  return (
    <div className="h-full flex flex-col px-6" style={{ backgroundColor: COLORS.paper }}>
      <StatusBar />
      <div className="flex flex-col items-center text-center mt-4 mb-5">
        <div className="rounded-full flex items-center justify-center mb-4 pop-in" style={{ width: 64, height: 64, backgroundColor: COLORS.green }}>
          <Check size={28} color={COLORS.paper} strokeWidth={3} />
        </div>
        <h2 className="text-2xl font-extrabold" style={{ color: COLORS.ink }}>Delivery complete!</h2>
      </div>

      <div className="rounded-2xl px-4 py-4 mb-4" style={{ backgroundColor: COLORS.paperDim }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm" style={{ color: COLORS.inkFaint }}>Delivery fare</span>
          <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>{fmtTZS(fare)}</span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm" style={{ color: COLORS.inkFaint }}>Platform commission</span>
          <span className="text-sm font-semibold" style={{ color: COLORS.ink }}>−{fmtTZS(commission)}</span>
        </div>
        <div style={{ height: 1, backgroundColor: COLORS.paper, margin: "8px 0" }} />
        <div className="flex items-center justify-between">
          <span className="text-base font-extrabold" style={{ color: COLORS.ink }}>Your payout</span>
          <span className="text-base font-extrabold" style={{ color: COLORS.amberDeep }}>{fmtTZS(payout)}</span>
        </div>
      </div>

      {remaining > 0 && (
        <div className="rounded-2xl px-4 py-3 mb-5 flex items-center gap-3" style={{ backgroundColor: COLORS.amberSoft }}>
          <Sparkles size={18} color={COLORS.amberDeep} />
          <p className="text-xs font-semibold flex-1" style={{ color: COLORS.amberDeep }}>{remaining} more {remaining === 1 ? "delivery" : "deliveries"} today unlocks a TZS 1,500 streak bonus.</p>
        </div>
      )}

      {/* No backend endpoint accepts a customer rating from the rider yet
          — this stays a local-only gesture, same as the pickup-code
          auto-fill, and isn't sent anywhere. */}
      <p className="text-sm font-bold text-center mb-3" style={{ color: COLORS.ink }}>Rate the customer</p>
      <div className="flex justify-center gap-2 mb-4">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setCustomerRating(n)}>
            <Star size={28} fill={n <= customerRating ? COLORS.amber : "none"} color={n <= customerRating ? COLORS.amber : COLORS.paperDim} strokeWidth={1.8} />
          </button>
        ))}
      </div>

      <div className="flex-1" />
      <div className="pb-4"><PrimaryButton onClick={onBackOnline} disabled={finishing}>{finishing ? "Finishing…" : "Back online"}</PrimaryButton></div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

function App() {
  const [screen, setScreen] = useState("splash");
  const [tab, setTab] = useState("home");
  const [error, setError] = useState(null);

  const [phone, setPhone] = useState("712345678");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [authBusy, setAuthBusy] = useState(false);

  const [user, setUser] = useState(null);
  const [riderProfile, setRiderProfile] = useState(null);

  // Registration form fields. vehicleType/vehicleRegistration/
  // licenseNumber and the four document URLs below all reach the
  // backend now (CreateRiderProfileDto) — idNumber has no matching DTO
  // field and stays a client-side-only value, same as before.
  const [idNumber, setIdNumber] = useState("AB1234567");
  const [licenseNumber, setLicenseNumber] = useState("DL-0294831");

  const [plate, setPlate] = useState("T 482 ABC");
  const [makeModel, setMakeModel] = useState("Yamaha Crux");

  // Real document URLs from POST /uploads — previously four fake toggle
  // buttons that went nowhere (see MASTER_GAPS_AND_ROADMAP.md, "File/
  // photo upload endpoint"). `uploadingField` tracks which one (if any)
  // is mid-upload so only that box shows a spinner state.
  const [idDocumentUrl, setIdDocumentUrl] = useState(null);
  const [licenseDocumentUrl, setLicenseDocumentUrl] = useState(null);
  const [vehicleRegistrationDocumentUrl, setVehicleRegistrationDocumentUrl] = useState(null);
  const [insuranceDocumentUrl, setInsuranceDocumentUrl] = useState(null);
  const [uploadingField, setUploadingField] = useState(null);

  // Profile photo has no matching field on the Rider entity/DTO at all
  // (unlike the four onboarding documents above), so it stays a local-
  // only gesture — nowhere real to send it yet.
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [online, setOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const geo = useGeolocation();

  const [earningsToday, setEarningsToday] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [walletTotal, setWalletTotal] = useState(0);
  const [walletDeliveries, setWalletDeliveries] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  const [availableShipment, setAvailableShipment] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [currentShipment, setCurrentShipment] = useState(null);

  const [pickupOtp, setPickupOtp] = useState(["", "", "", ""]);
  const [checklist, setChecklist] = useState({ matches: false, details: false });
  // Real proof-of-delivery photo URL from POST /uploads — previously a
  // fake toggle (see MASTER_GAPS_AND_ROADMAP.md, "File/photo upload
  // endpoint"). Passed as `photoUrl` into POST /shipments/:id/deliver,
  // which already accepted the field but had nothing real to send.
  const [podPhotoUrl, setPodPhotoUrl] = useState(null);
  const [podPhotoUploading, setPodPhotoUploading] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [podSubmitting, setPodSubmitting] = useState(false);
  const [customerRating, setCustomerRating] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const refreshEarnings = async () => {
    setEarningsLoading(true);
    try {
      const result = await api.getEarnings();
      setWalletTotal(Math.round(parseFloat(result.totalEarnings || "0")));
      setWalletDeliveries(result.deliveries || []);
    } catch (e) {
      console.error("Failed to load earnings", e);
    } finally {
      setEarningsLoading(false);
    }
  };

  // OTP "verify" — same known simplification as the Customer app: there's
  // no SMS provider wired up, so this authenticates against a per-device
  // password rather than a code the backend actually issued. Once
  // authenticated, decide where to land: no rider profile yet -> start
  // onboarding; profile exists but not ACTIVE -> pending review; ACTIVE
  // -> straight to home.
  const handleVerifyOtp = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      const result = await api.loginOrRegister(phone);
      setUser(result.user);
      const profile = await api.getMyRiderProfile();
      setRiderProfile(profile);
      if (!profile) {
        setScreen("reg-identity");
      } else if (profile.status !== "ACTIVE") {
        setScreen("pending");
      } else {
        await refreshEarnings();
        setScreen("home");
      }
    } catch (e) {
      console.error("Login/registration failed", e);
      setError("Couldn't verify that number. Check your connection and try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  // Uploads a single onboarding document via POST /uploads and stores
  // the returned URL against the right field. Previously each
  // UploadBox just flipped a local boolean — see
  // MASTER_GAPS_AND_ROADMAP.md ("File/photo upload endpoint").
  const DOCUMENT_SETTERS = {
    id: setIdDocumentUrl,
    license: setLicenseDocumentUrl,
    registration: setVehicleRegistrationDocumentUrl,
    insurance: setInsuranceDocumentUrl,
  };

  const handleUploadDocument = async (field, file) => {
    setUploadingField(field);
    setError(null);
    try {
      const result = await api.uploadFile(file);
      DOCUMENT_SETTERS[field](result.url);
    } catch (e) {
      console.error(`Upload failed for ${field}`, e);
      setError("Couldn't upload that file. Try again.");
    } finally {
      setUploadingField(null);
    }
  };

  const handleSubmitRegistration = async () => {
    setAuthBusy(true);
    setError(null);
    try {
      const profile = await api.createRiderProfile({
        vehicleType: makeModel,
        vehicleRegistration: plate,
        licenseNumber,
        idDocumentUrl,
        licenseDocumentUrl,
        vehicleRegistrationDocumentUrl,
        insuranceDocumentUrl,
      });
      setRiderProfile(profile);
      setScreen("pending");
    } catch (e) {
      console.error("Rider profile submission failed", e);
      setError("Couldn't submit your application. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const checkRiderStatus = async () => {
    const profile = await api.getMyRiderProfile();
    if (profile) setRiderProfile(profile);
    return profile;
  };

  const handleToggleOnline = async () => {
    setTogglingOnline(true);
    setError(null);
    try {
      if (!online) {
        await api.goOnline();
        setOnline(true);
        geo.request();
      } else {
        await api.goOffline();
        setOnline(false);
      }
    } catch (e) {
      console.error("Failed to toggle availability", e);
      setError("Couldn't update your online status. Try again.");
    } finally {
      setTogglingOnline(false);
    }
  };

  // While online, idle, and on the Home tab: poll the open delivery
  // queue (GET /shipments/available) for the next unassigned job. This
  // is the rider-facing counterpart to the admin/dispatcher queue —
  // there's no push/WebSocket layer yet, so polling is the honest
  // MVP-stage approach rather than faking a live feed.
  useEffect(() => {
    if (!(online && screen === "home" && !currentShipment)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const shipments = await api.getAvailableShipments({ limit: 1 });
        if (!cancelled && shipments && shipments.length > 0) {
          setAvailableShipment(shipments[0]);
          setScreen("request");
          return;
        }
      } catch (e) {
        console.error("Failed to poll available shipments", e);
      }
      if (!cancelled) timer = setTimeout(poll, 4000);
    };
    let timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [online, screen, currentShipment]);

  // Send a GPS ping every 20s while online and a fix is available — the
  // backend's tracking module (POST /rider/location) has nothing else
  // driving it yet.
  useEffect(() => {
    if (!online || geo.status !== "granted") return;
    const t = setInterval(() => {
      api.updateLocation({ latitude: geo.coords.lat, longitude: geo.coords.lng, accuracyMeters: geo.accuracy ? Math.round(geo.accuracy) : undefined })
        .catch((e) => console.error("Location ping failed", e));
    }, 20000);
    return () => clearInterval(t);
  }, [online, geo.status, geo.coords, geo.accuracy]);

  const handleAcceptShipment = async () => {
    if (!availableShipment) return;
    setAccepting(true);
    setError(null);
    try {
      const assigned = await api.acceptShipment(availableShipment.id);
      setCurrentShipment(assigned);
      setAvailableShipment(null);
      setScreen("navigate-pickup");
    } catch (e) {
      // 409 = someone else claimed it first — not a real error, just
      // means this rider keeps looking.
      if (e instanceof api.ApiError && e.status === 409) {
        setAvailableShipment(null);
        setScreen("home");
      } else {
        console.error("Failed to accept shipment", e);
        setError("Couldn't accept that delivery. Try again.");
        setAvailableShipment(null);
        setScreen("home");
      }
    } finally {
      setAccepting(false);
    }
  };

  const handleDeclineShipment = () => {
    setAvailableShipment(null);
    setScreen("home");
  };

  const resetJob = () => {
    setPickupOtp(["", "", "", ""]);
    setChecklist({ matches: false, details: false });
    setPodPhotoUrl(null);
    setRecipientName("");
    setCustomerRating(0);
    setCurrentShipment(null);
  };

  const handleArrivedAtPickup = () => {
    setScreen("verify-pickup");
    api.updateShipmentStatus(currentShipment.id, "PICKUP_IN_PROGRESS").catch((e) => console.error("Status update failed", e));
  };

  // The 4-digit "pickup code" checklist has no backend counterpart (no
  // code-issuing endpoint exists) — it's a real UX confirmation gesture,
  // just not one the server validates. Moving the shipment forward on
  // the server happens regardless, driven by the rider's own confirmation.
  const handleConfirmPickup = async () => {
    setScreen("navigate-dropoff");
    try {
      await api.updateShipmentStatus(currentShipment.id, "PICKED_UP");
    } catch (e) {
      console.error("Status update failed", e);
    }
  };

  useEffect(() => {
    if (screen !== "navigate-dropoff" || !currentShipment) return;
    api.updateShipmentStatus(currentShipment.id, "IN_TRANSIT").catch((e) => console.error("Status update failed", e));
  }, [screen, currentShipment]);

  const handleArrivedAtDropoff = async () => {
    setScreen("pod");
    try {
      await api.updateShipmentStatus(currentShipment.id, "OUT_FOR_DELIVERY");
    } catch (e) {
      console.error("Status update failed", e);
    }
  };

  // Uploads the proof-of-delivery photo taken/picked on the POD screen.
  // Previously `photoTaken` was just a boolean the UI flipped — see
  // MASTER_GAPS_AND_ROADMAP.md ("File/photo upload endpoint").
  const handleCapturePodPhoto = async (file) => {
    setPodPhotoUploading(true);
    setError(null);
    try {
      const result = await api.uploadFile(file);
      setPodPhotoUrl(result.url);
    } catch (e) {
      console.error("POD photo upload failed", e);
      setError("Couldn't upload the photo. Try again.");
    } finally {
      setPodPhotoUploading(false);
    }
  };

  const handleCompletePod = async () => {
    setPodSubmitting(true);
    setError(null);
    try {
      const delivered = await api.submitProofOfDelivery(currentShipment.id, {
        recipientName: recipientName.trim(),
        photoUrl: podPhotoUrl,
      });
      setCurrentShipment(delivered);
      setScreen("complete");
    } catch (e) {
      console.error("Proof of delivery failed", e);
      setError("Couldn't complete the delivery. Try again.");
    } finally {
      setPodSubmitting(false);
    }
  };

  const finishJobAndGoOnline = async () => {
    setFinishing(true);
    try {
      await api.completeShipment(currentShipment.id);
    } catch (e) {
      console.error("Failed to close out shipment", e);
    }
    setEarningsToday((e) => e + Math.round(parseFloat(currentShipment.riderPayout || "0")));
    setCompletedToday((c) => c + 1);
    resetJob();
    await refreshEarnings();
    setFinishing(false);
    setTab("home");
    setScreen("home");
  };

  const riderRealPos = geo.status === "granted" ? geo.coords : RIDER_BASE;
  const legConfig = currentShipment ? legConfigFor(currentShipment, riderRealPos) : null;

  let content;
  if (screen === "splash") content = <SplashScreen onNext={() => setScreen("phone")} />;
  else if (screen === "phone") content = <PhoneEntryScreen phone={phone} setPhone={setPhone} onNext={() => setScreen("otp")} onBack={() => setScreen("splash")} />;
  else if (screen === "otp") content = <OtpScreen otp={otp} setOtp={setOtp} phone={phone} onNext={handleVerifyOtp} onBack={() => setScreen("phone")} />;
  else if (screen === "reg-identity") {
    content = (
      <RegIdentityScreen step={1} total={3} onBack={() => setScreen("otp")} onNext={() => setScreen("reg-vehicle")}
        idNumber={idNumber} setIdNumber={setIdNumber} licenseNumber={licenseNumber} setLicenseNumber={setLicenseNumber}
        idDocumentUrl={idDocumentUrl} licenseDocumentUrl={licenseDocumentUrl}
        uploadingField={uploadingField} onUploadDocument={handleUploadDocument} />
    );
  } else if (screen === "reg-vehicle") {
    content = (
      <RegVehicleScreen step={2} total={3} onBack={() => setScreen("reg-identity")} onNext={() => setScreen("reg-profile")}
        plate={plate} setPlate={setPlate} makeModel={makeModel} setMakeModel={setMakeModel}
        vehicleRegistrationDocumentUrl={vehicleRegistrationDocumentUrl} insuranceDocumentUrl={insuranceDocumentUrl}
        uploadingField={uploadingField} onUploadDocument={handleUploadDocument} />
    );
  } else if (screen === "reg-profile") {
    content = (
      <RegProfileScreen step={3} total={3} onBack={() => setScreen("reg-vehicle")} onNext={handleSubmitRegistration}
        photoUploaded={photoUploaded} setPhotoUploaded={setPhotoUploaded} contactName={contactName} setContactName={setContactName}
        contactPhone={contactPhone} setContactPhone={setContactPhone} agreed={agreed} setAgreed={setAgreed} />
    );
  } else if (screen === "pending") {
    content = <PendingApprovalScreen checkStatus={checkRiderStatus} onDone={async () => { await refreshEarnings(); setScreen("home"); }} />;
  } else if (screen === "home") {
    if (tab === "wallet") content = <WalletScreen balance={walletTotal} deliveries={walletDeliveries} earningsLoading={earningsLoading} tab={tab} setTab={setTab} />;
    else if (tab === "account") content = <AccountScreen tab={tab} setTab={setTab} user={user} riderProfile={riderProfile} />;
    else content = <HomeScreen online={online} onToggleOnline={handleToggleOnline} earningsToday={earningsToday} completedToday={completedToday} rating={riderProfile && riderProfile.ratingAvg ? parseFloat(riderProfile.ratingAvg) : 5} tab={tab} setTab={setTab} geo={geo} riderFirstName={(user && user.fullName && user.fullName.split(" ")[0]) || "Rider"} />;
  } else if (screen === "request" && availableShipment) {
    content = <RequestScreen shipment={availableShipment} onAccept={handleAcceptShipment} onDecline={handleDeclineShipment} riderPos={riderRealPos} accepting={accepting} />;
  } else if (screen === "navigate-pickup" && currentShipment) {
    content = <NavigateScreen leg="pickup" legConfig={legConfig} orderLabel={`#${currentShipment.id.slice(0, 8).toUpperCase()}`} onArrive={handleArrivedAtPickup} riderStartOverride={geo.status === "granted" ? geo.coords : null} />;
  } else if (screen === "verify-pickup") {
    content = <VerifyPickupScreen checklist={checklist} setChecklist={setChecklist} otp={pickupOtp} setOtp={setPickupOtp} onNext={handleConfirmPickup} />;
  } else if (screen === "navigate-dropoff" && currentShipment) {
    content = <NavigateScreen leg="dropoff" legConfig={legConfig} orderLabel={`#${currentShipment.id.slice(0, 8).toUpperCase()}`} onArrive={handleArrivedAtDropoff} />;
  } else if (screen === "pod") {
    content = (
      <ProofOfDeliveryScreen
        photoUrl={podPhotoUrl} uploading={podPhotoUploading} onCapturePhoto={handleCapturePodPhoto}
        recipientName={recipientName} setRecipientName={setRecipientName} onComplete={handleCompletePod} submitting={podSubmitting}
      />
    );
  } else if (screen === "complete" && currentShipment) {
    content = <CompleteScreen shipment={currentShipment} completedToday={completedToday} customerRating={customerRating} setCustomerRating={setCustomerRating} onBackOnline={finishJobAndGoOnline} finishing={finishing} />;
  } else {
    // Any state relying on availableShipment/currentShipment that isn't
    // set yet (e.g. a hard refresh mid-job) falls back to Home rather
    // than rendering a screen with nothing to show.
    content = <HomeScreen online={online} onToggleOnline={handleToggleOnline} earningsToday={earningsToday} completedToday={completedToday} rating={5} tab="home" setTab={setTab} geo={geo} riderFirstName={(user && user.fullName && user.fullName.split(" ")[0]) || "Rider"} />;
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
        .pop-in { animation: pop 0.5s cubic-bezier(.34,1.56,.64,1); }
        @keyframes pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
        .locate-spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .leaflet-marker-icon.rider-marker { transition: transform 2.2s ease-in-out; }
        .countdown-bar { animation: shrinkbar 10s linear forwards; }
        @keyframes shrinkbar { from { width: 100%; } to { width: 0%; } }
        @media (prefers-reduced-motion: reduce) {
          .route-thread, .pulse-ring, .pop-in, .countdown-bar, .locate-spin { animation: none !important; }
          .leaflet-marker-icon.rider-marker { transition: none !important; }
        }
        .wazzar-statusbar { padding-top: max(env(safe-area-inset-top), 10px) !important; }
      `}</style>

      <div className="w-full h-full overflow-hidden relative" style={{ backgroundColor: COLORS.paper }}>
        {error && (
          <div className="absolute left-3 right-3 top-3 rounded-2xl px-4 py-3 flex items-center justify-between gap-3" style={{ zIndex: 50, backgroundColor: COLORS.coral, boxShadow: "0 6px 20px rgba(16,34,28,0.25)" }}>
            <span className="text-xs font-semibold flex-1" style={{ color: COLORS.paper }}>{error}</span>
            <button onClick={() => setError(null)} className="text-xs font-bold flex-shrink-0" style={{ color: COLORS.paper }}>Dismiss</button>
          </div>
        )}
        {content}
        {authBusy && (screen === "otp" || screen === "reg-profile") && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 60, backgroundColor: "rgba(16,34,28,0.35)" }}>
            <div className="rounded-2xl px-5 py-4" style={{ backgroundColor: COLORS.paper }}>
              <span className="text-sm font-bold" style={{ color: COLORS.ink }}>Please wait…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
