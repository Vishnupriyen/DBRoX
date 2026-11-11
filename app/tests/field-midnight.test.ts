// A rep who works past midnight (found 11 Nov 2026 at 11.30 pm): the day started before midnight is still open after it,
// so the rep can keep recording km and end it — never "Start your day first" with an open day on the phone.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

beforeAll(async () => {
  const { seedDemo } = await import('../src/core/seed'); await seedDemo();
  const { db, setSession } = await import('../src/core/db');
  setSession('demo', (await db.staff.toArray()).find(s => s.role === 'owner')!.id);
}, 90000);
afterEach(() => { vi.useRealTimers(); });

describe('a day that runs past midnight', () => {
  it('stays open after midnight and ends with its km; a new day can start after it ends', async () => {
    const { startDay, addPoint, endDay, myDay } = await import('../src/core/field');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 11, 23, 30));
    await startDay({ lat: 11.4066, lng: 79.2577, acc: 10 });
    vi.setSystemTime(new Date(2026, 10, 11, 23, 50));
    await addPoint({ lat: 11.4166, lng: 79.2577, acc: 10 });
    vi.setSystemTime(new Date(2026, 10, 12, 0, 15));
    expect((await myDay())?.date).toBe('2026-11-11');
    expect(await addPoint({ lat: 11.4266, lng: 79.2577, acc: 10 })).toBe(true);
    vi.setSystemTime(new Date(2026, 10, 12, 0, 35));
    const r = await endDay({ lat: 11.4366, lng: 79.2577, acc: 10 });
    expect(r.km).toBeGreaterThan(2.5);
    await expect(endDay(null)).rejects.toThrow();
    // the ended day belongs to yesterday; today is a fresh day
    expect(await myDay()).toBeUndefined();
    await startDay(null);
    expect((await myDay())?.date).toBe('2026-11-12');
  });
});
