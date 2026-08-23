import '@testing-library/jest-dom';

// jsdom has no ResizeObserver — recharts' <ResponsiveContainer> (used on
// the Overview page) needs one to mount at all. This is a standard,
// widely-used no-op polyfill for tests, not app-specific behavior.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
