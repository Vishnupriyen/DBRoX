// The demo's "3 days ago" was worked out in UTC: between midnight and 5:30 AM in India it was one day older than the
// app's own "today", so demo results changed with the time of day (found by the million re-run past midnight, 10 Nov 2026).
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterAll } from 'vitest';
import { db, today, daysFrom } from '../src/core/db';
import { seedDemo } from '../src/core/seed';

afterAll(() => { vi.useRealTimers(); });
describe('demo dates', () => {
  it('are counted from the local day, also just after midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T00:30:00+05:30')); // 00:30 in India = 19:00 the day before in UTC
    await seedDemo();
    const dates = (await db.orders.toArray()).map(o => o.date);
    expect(dates.every(d => d <= today())).toBe(true);
    expect(dates).toContain(daysFrom(-3)); // 3 local days ago, whatever the time zone (the gate runs in UTC and in India)
    // the demo's own history never locks billing, also just after midnight
    const { billingLockedBy } = await import('../src/core/pipeline');
    expect(await billingLockedBy()).toBeNull();
  });
});

describe('dates written in words', () => {
  it('"November 3, 2026" is the 3rd in India too, never the 2nd', async () => {
    vi.useRealTimers();
    const { toIsoDate } = await import('../src/core/readers');
    expect(toIsoDate('November 3, 2026')).toBe('2026-11-03');
    expect(toIsoDate('Tuesday, 3 November 2026')).toBe('2026-11-03');
  });
  it('the day before a lock date is one day before, in local days', async () => {
    const { dayBefore } = await import('../src/core/db');
    expect(dayBefore('2026-12-01')).toBe('2026-11-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
});

describe('the day of a saved record', () => {
  it('is its local day: 1 Nov 01:30 in India is 1 Nov, not 31 Oct', async () => {
    const { localDay } = await import('../src/core/db');
    const t = new Date(2026, 10, 1, 1, 30).toISOString(); // 1 Nov 01:30 local
    expect(localDay(t)).toBe('2026-11-01');
  });
});
