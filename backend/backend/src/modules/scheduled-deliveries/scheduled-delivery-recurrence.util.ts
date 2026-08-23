// Pure date math for "when does this recurring schedule next fire?" —
// deliberately isolated from ScheduledDeliveriesService so it can be
// unit-tested without a database or a NestJS testing module, the same
// way tracking/eta.util.ts's haversine calc is kept separate from
// TrackingGateway.
//
// WAZZAR only operates in Tanzania today (see the phase-model docs),
// which runs on EAT (UTC+3) year-round — no DST. A `timeOfDay` of
// "09:00" on this entity always means 9am Dar es Salaam time, not 9am
// wherever the backend process happens to be running. That matters
// because this backend has no guarantee of running with TZ=Africa/Dar_es_Salaam
// (containers/CI usually default to UTC) — if this util used the
// server's local Date getters (getDay()/getHours()) instead of a fixed
// offset computed from UTC, a schedule's actual fire time would silently
// depend on how the box it happened to be deployed on was configured.
// A fixed +3h offset applied to UTC sidesteps that entirely.
const EAT_OFFSET_MINUTES = 180;

function toEatWallClock(date: Date): Date {
  return new Date(date.getTime() + EAT_OFFSET_MINUTES * 60000);
}

function fromEatWallClock(eatWallClock: Date): Date {
  return new Date(eatWallClock.getTime() - EAT_OFFSET_MINUTES * 60000);
}

// daysOfWeek uses the same numbering as Date#getUTCDay(): 0 = Sunday
// ... 6 = Saturday. timeOfDay is a 24-hour "HH:mm" string, e.g. "09:00"
// or "19:30". Returns the next instant (strictly after `after`) that is
// both one of daysOfWeek and at timeOfDay in EAT — e.g. "next Monday or
// today-if-still-ahead at 07:30 Dar es Salaam time."
//
// Always strictly after `after`, never equal to it — this is what keeps
// the cron job (which calls this with `after = now` right after firing)
// from computing a nextRunAt that's immediately due again on the same
// tick.
export function computeNextRunAt(
  daysOfWeek: number[],
  timeOfDay: string,
  after: Date = new Date(),
): Date {
  if (!daysOfWeek || daysOfWeek.length === 0) {
    throw new Error('daysOfWeek must contain at least one day (0-6)');
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay);
  if (!match) {
    throw new Error(`timeOfDay must be "HH:mm" (24-hour), got "${timeOfDay}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const afterEat = toEatWallClock(after);

  // Walk forward one day at a time. 8 iterations (0..7 inclusive)
  // always covers a full week plus one, so this is guaranteed to find
  // a match given a valid, non-empty daysOfWeek — it can never fall
  // through to the error below in practice; the throw exists only to
  // fail loudly instead of returning `undefined` if that invariant is
  // ever broken (e.g. a stray value outside 0-6 slipping past the DTO
  // validator some other way).
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidateEat = new Date(
      Date.UTC(
        afterEat.getUTCFullYear(),
        afterEat.getUTCMonth(),
        afterEat.getUTCDate() + dayOffset,
        hour,
        minute,
        0,
        0,
      ),
    );
    if (!daysOfWeek.includes(candidateEat.getUTCDay())) continue;
    if (candidateEat.getTime() <= afterEat.getTime()) continue;
    return fromEatWallClock(candidateEat);
  }

  throw new Error(
    `Could not compute a next run time for daysOfWeek=${JSON.stringify(daysOfWeek)}, timeOfDay=${timeOfDay} — this should be unreachable`,
  );
}
