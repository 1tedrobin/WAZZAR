import { estimateEtaSeconds, haversineDistanceMeters } from './eta.util';

// Two well-known Dar es Salaam points, roughly ~1.3km apart along Samora
// Avenue / Morogoro Road — used as a sanity check, not an exact fixture.
const MOROGORO_RD = { latitude: -6.792, longitude: 39.208 };
const SAMORA_AVE = { latitude: -6.801, longitude: 39.215 };

describe('haversineDistanceMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistanceMeters(MOROGORO_RD, MOROGORO_RD)).toBe(0);
  });

  it('is symmetric (a to b equals b to a)', () => {
    expect(haversineDistanceMeters(MOROGORO_RD, SAMORA_AVE)).toBeCloseTo(
      haversineDistanceMeters(SAMORA_AVE, MOROGORO_RD),
    );
  });

  it('returns a plausible distance for two nearby Dar es Salaam points', () => {
    const distance = haversineDistanceMeters(MOROGORO_RD, SAMORA_AVE);
    // Straight-line, not road distance — just bounding it to a sane range.
    expect(distance).toBeGreaterThan(500);
    expect(distance).toBeLessThan(2000);
  });
});

describe('estimateEtaSeconds', () => {
  it('returns 0 for identical coordinates', () => {
    expect(estimateEtaSeconds(MOROGORO_RD, MOROGORO_RD)).toBe(0);
  });

  it('scales with distance (farther apart takes longer)', () => {
    const near = estimateEtaSeconds(MOROGORO_RD, SAMORA_AVE);
    const far = estimateEtaSeconds(MOROGORO_RD, { latitude: -6.9, longitude: 39.3 });
    expect(far).toBeGreaterThan(near);
  });

  it('always returns a non-negative integer number of seconds', () => {
    const eta = estimateEtaSeconds(MOROGORO_RD, SAMORA_AVE);
    expect(Number.isInteger(eta)).toBe(true);
    expect(eta).toBeGreaterThanOrEqual(0);
  });
});
