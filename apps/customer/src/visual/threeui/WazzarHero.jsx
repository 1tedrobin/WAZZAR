import { lazy } from "react";
import WebGLGuard from "./WebGLGuard";

// Code-split: `three` + the ThreeUI runtime only download once a device has
// actually reached the splash screen, and only if that device can render
// WebGL — the plain COLORS.ink background (today's default, unchanged) is
// the fallback in every other case, so nothing ever looks broken.
const HeroField = lazy(() => import("./HeroField"));

// Absolutely-positioned, non-interactive backdrop. Sits behind the existing
// SplashScreen content (wordmark + copy + CTA), never on top of it —
// pointer-events-none so it can never intercept the "Get started" tap.
export default function WazzarHero() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <WebGLGuard fallback={null}>
        <HeroField />
      </WebGLGuard>
    </div>
  );
}
