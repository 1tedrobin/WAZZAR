import { Component, Suspense, useEffect, useState } from "react";

// Shared safety wrapper for every ThreeUI/Three.js visual component in the
// app. Nothing that renders WebGL should be dropped straight into a screen —
// it should go through this guard first, so the same three checks (WebGL
// support, reduced-motion, render-time errors) don't have to be reimplemented
// per component. Visual components stay pure/presentational (props in,
// pixels out) — this file owns none of their data fetching.

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

class VisualErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    // Swallow — a broken decorative visual must never take the screen
    // down with it. Fallback (or nothing) renders instead.
    console.warn("[WazzarVisual] disabled after render error:", error?.message || error);
  }
  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}

// Wrap any ThreeUI/Three.js component: <WebGLGuard fallback={...}><Thing /></WebGLGuard>
// - No WebGL → fallback (or null), never a blank crash.
// - prefers-reduced-motion → fallback (or null), never forced motion.
// - Render error at any point → fallback (or null), rest of the screen unaffected.
// - Otherwise → lazily mounts children inside a Suspense boundary so a
//   code-split visual module never blocks first paint of the screen it sits on.
export default function WebGLGuard({ children, fallback = null }) {
  const [ok, setOk] = useState(null); // null = not yet checked

  useEffect(() => {
    setOk(supportsWebGL() && !prefersReducedMotion());
  }, []);

  if (ok === null) return fallback; // avoid a flash of WebGL content before the check runs
  if (!ok) return fallback;

  return (
    <VisualErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </VisualErrorBoundary>
  );
}
