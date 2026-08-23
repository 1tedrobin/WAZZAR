// Single source of truth for "who is allowed to call this API from a
// browser", used by both the HTTP CORS config (main.ts) and the
// tracking WebSocket gateway (tracking.gateway.ts). Previously each
// had its own setting (open HTTP CORS, `origin: '*'` on the gateway) —
// keeping one function means they can't silently drift apart again.
//
// CORS_ORIGIN is a comma-separated list, e.g.:
//   CORS_ORIGIN=https://app.wazzar.tz,https://admin.wazzar.tz
//
// Unset in local dev: falls back to true (reflect any origin), which
// is fine for `npm run dev` on localhost but must never happen in
// production — see security-checks.ts, which refuses to boot in
// production if CORS_ORIGIN is unset.
export function corsOrigin(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw.trim() === '') {
    return true;
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
