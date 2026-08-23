import { computeNextRunAt } from './scheduled-delivery-recurrence.util';

// All `after` timestamps below are plain UTC ISO strings; comments note
// what that instant is in EAT (UTC+3) so the expected results are easy
// to check by hand.
describe('computeNextRunAt', () => {
  it('picks later today (EAT) when that time hasn\'t passed yet', () => {
    // 2026-08-24 (Monday) 05:00 UTC = 08:00 EAT — before 09:00 EAT today.
    const after = new Date('2026-08-24T05:00:00.000Z');
    const next = computeNextRunAt([1], '09:00', after); // Mondays only

    // 09:00 EAT on the same Monday = 06:00 UTC.
    expect(next.toISOString()).toBe('2026-08-24T06:00:00.000Z');
  });

  it('rolls to the following week when today\'s time has already passed', () => {
    // 2026-08-24 (Monday) 07:00 UTC = 10:00 EAT — after 09:00 EAT today.
    const after = new Date('2026-08-24T07:00:00.000Z');
    const next = computeNextRunAt([1], '09:00', after);

    // Next Monday, 09:00 EAT = 06:00 UTC, 7 days later.
    expect(next.toISOString()).toBe('2026-08-31T06:00:00.000Z');
  });

  it('never returns a time equal to `after` — always strictly later', () => {
    // Exactly 09:00 EAT on a Monday.
    const after = new Date('2026-08-24T06:00:00.000Z');
    const next = computeNextRunAt([1], '09:00', after);

    expect(next.getTime()).toBeGreaterThan(after.getTime());
    // Should skip to next Monday, not fire again the same instant.
    expect(next.toISOString()).toBe('2026-08-31T06:00:00.000Z');
  });

  it('finds the nearest of several weekdays ("weekdays" schedule)', () => {
    // Saturday 2026-08-22 10:00 UTC = 13:00 EAT.
    const after = new Date('2026-08-22T10:00:00.000Z');
    const next = computeNextRunAt([1, 2, 3, 4, 5], '09:00', after); // Mon-Fri

    // Nearest weekday at 09:00 EAT is Monday 2026-08-24 -> 06:00 UTC.
    expect(next.toISOString()).toBe('2026-08-24T06:00:00.000Z');
  });

  it('supports a single-day-of-week schedule (e.g. "Saturdays")', () => {
    // Sunday 2026-08-23 00:00 UTC = 03:00 EAT.
    const after = new Date('2026-08-23T00:00:00.000Z');
    const next = computeNextRunAt([6], '12:00', after); // Saturdays only

    // Next Saturday is 2026-08-29, 12:00 EAT = 09:00 UTC.
    expect(next.toISOString()).toBe('2026-08-29T09:00:00.000Z');
  });

  it('throws for an empty daysOfWeek array', () => {
    expect(() => computeNextRunAt([], '09:00', new Date())).toThrow(
      /at least one day/,
    );
  });

  it('throws for a malformed timeOfDay', () => {
    expect(() => computeNextRunAt([1], '9:00', new Date())).toThrow(/HH:mm/);
    expect(() => computeNextRunAt([1], '25:00', new Date())).toThrow(/HH:mm/);
    expect(() => computeNextRunAt([1], 'noon', new Date())).toThrow(/HH:mm/);
  });
});
