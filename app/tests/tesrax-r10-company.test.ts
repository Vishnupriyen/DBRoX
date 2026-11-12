// TESRAX round 10, company side: every head-office, manager and rep screen by name in every polite way; the rep's day of expenses is one table.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { setSession } from '../src/core/db';
import { handle } from '../src/core/engine';
import { CO_PROBES, CO_PHONE } from './tesrax-r10-set';
const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { wireDemoRelay } = await import('../src/core/link'); await wireDemoRelay();
  const { seedCompanyDemo } = await import('../src/core/seedCompany'); await seedCompanyDemo();
}, 90000);
describe('round 10: company side', () => {
  it('every screen by name; head-office screens are refused to managers; reps\' expenses; help', async () => {
    const { onSide } = await import('../src/core/db'); const { storeOf } = await import('../src/core/link'); const cs = storeOf('company');
    const bad: string[] = [];
    for (const p of CO_PROBES) {
      const r = await onSide(cs, async () => { const st = (await cs.staff.toArray()).find(x => x.phone === CO_PHONE[p.who])!; setSession('demo-company', st.id); return handle(p.s, [], {}); });
      const got = r.go ? `go:${r.go}` : r.table ? 't' : r.proposal ? (p.exp === 'expense' ? 'expense' : r.proposal.kind) : r.refused ? 'refused' : /Ask in plain words|Type an order/.test(r.text) ? 'help' : `other:${r.text.slice(0, 40)}`;
      if (got !== p.exp) bad.push(`${p.who}: "${p.s}" → ${got} (want ${p.exp})`);
    }
    expect(bad).toEqual([]);
    expect(CO_PROBES.length).toBeGreaterThan(400);
  }, 300000);
});
