// TESRAX round 9, company side: Distributor claims, Travel & expenses, and "team today" (was opening Team).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { wireDemoRelay } = await import('../src/core/link'); await wireDemoRelay();
  const { seedCompanyDemo } = await import('../src/core/seedCompany'); await seedCompanyDemo();
}, 90000);
const say = async (phone: string, t: string) => {
  const { onSide, setSession } = await import('../src/core/db'); const { storeOf } = await import('../src/core/link'); const co = storeOf('company');
  const { handleCompany } = await import('../src/core/companyEngine');
  return onSide(co, async () => { const s = (await co.staff.toArray()).find(x => x.phone === phone)!; setSession('demo-company', s.id); return handleCompany(t, s.role); });
};
const HO = '9100000001', ARUN = '9100000004';
describe('company side screens by name', () => {
  it('head office: "distributor claims", "team today", "team"', async () => {
    expect((await say(HO, 'open distributor claims')).go).toBe('cl-inbox');
    expect((await say(HO, 'team today')).go).toBe('fd-team');
    expect((await say(HO, 'my team')).go).toBe('co-team');
  });
  it('rep: "travel and expenses", "my expenses"', async () => {
    expect((await say(ARUN, 'open travel and expenses')).go).toBe('fd-expenses');
    expect((await say(ARUN, 'my expenses')).go).toBe('fd-expenses');
    expect((await say(ARUN, 'my day')).go).toBe('fd-day');
  });
});
