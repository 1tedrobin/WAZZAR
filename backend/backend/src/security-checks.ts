// Boot-time production safety net. Fails loud (refuses to start) rather
// than silently running with unsafe settings — see
// docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md, "Phase 2.5 — Hardening"
// for why each of these matters. This only ever blocks startup when
// NODE_ENV=production; local/dev/test boot exactly as before.
export function assertProductionSafeConfig(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const problems: string[] = [];

  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.trim() === '') {
    problems.push(
      'CORS_ORIGIN is unset — in production this must be a comma-separated ' +
        'list of allowed origins (e.g. https://app.wazzar.tz), never left open.',
    );
  }

  if (!process.env.MPESA_WEBHOOK_SECRET) {
    problems.push(
      'MPESA_WEBHOOK_SECRET is unset — webhook signature verification is ' +
        'silently skipped without it, meaning anyone could fake a payment ' +
        'callback.',
    );
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    problems.push(
      'STRIPE_WEBHOOK_SECRET is unset — same risk as above, for the Stripe webhook.',
    );
  }

  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    problems.push('JWT_SECRET / JWT_REFRESH_SECRET must both be set in production.');
  } else if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    problems.push(
      'JWT_SECRET and JWT_REFRESH_SECRET are identical — they must be two ' +
        'different random strings, or a leaked refresh token can be replayed ' +
        'as an access token.',
    );
  }

  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error('\nWAZZAR refuses to start in production with unsafe configuration:\n');
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error('\nFix the above in your .env and restart.\n');
    process.exit(1);
  }
}
