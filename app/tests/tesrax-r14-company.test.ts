// TESRAX round 14, company side (12 Nov 2026, owner: "every report it should send"): sales, stock at distributors, shops,
// team today, targets as files for head office and managers; a rep's own travel claim. Screens still open by name.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
const sent: { name: string; sheets: { name: string; header: string[]; rows: (string | number)[][] }[] }[] = [];
vi.mock('../src/core/readers', async (orig) => ({ ...(await orig<object>()), downloadWorkbook: async (name: string, sheets: never) => { sent.push({ name, sheets }); } }));
const store = new Map<string, string>();
beforeAll(async () => {
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  if (!(globalThis as { window?: unknown }).window) Object.assign(globalThis, { window: new EventTarget() });
  const { wireDemoRelay } = await import('../src/core/link'); await wireDemoRelay();
  const { seedCompanyDemo } = await import('../src/core/seedCompany'); await seedCompanyDemo();
}, 90000);
const say = async (phone: string, t: string, run = false) => {
  const { onSide, setSession } = await import('../src/core/db'); const { storeOf } = await import('../src/core/link'); const co = storeOf('company');
  const { handleCompany } = await import('../src/core/companyEngine');
  return onSide(co, async () => {
    const s = (await co.staff.toArray()).find(x => x.phone === phone)!; setSession('demo-company', s.id);
    const r = await handleCompany(t, s.role);
    if (run && r.actions) { sent.length = 0; await r.actions[0].run(); await new Promise(res => setTimeout(res, 20)); }
    return r;
  });
};
const HO = '9100000001', DIVYA = '9100000003', ARUN = '9100000004';
describe('company reports as files', () => {
  it('head office: "send sales october" — by distributor and by product, sell-through', async () => {
    const r = await say(HO, 'send sales october', true);
    expect(r.text).toMatch(/^Sales Oct 2026: to distributors ₹/);
    expect(sent[0].sheets.map(s => s.name)).toEqual(['By distributor', 'By product']);
    expect(sent[0].sheets[0].rows.some(x => x[0] === 'Total')).toBe(true);
  });
  for (const [t, file] of [['stock excel', 'Stock-at-distributors'], ['send shop list', 'Shops'], ['team today report excel', 'Team-today'], ['targets excel', 'Targets']] as const)
    it(`head office: "${t}"`, async () => { const r = await say(HO, t, true); expect(r.actions?.[0].label).toBe('Send as Excel'); expect(sent[0].name).toMatch(new RegExp(`^${file}`)); });
  it('a rep: "my travel claim excel" is their own claim; company reports are refused', async () => {
    const r = await say(ARUN, 'send my travel claim excel', true);
    expect(r.text).toMatch(/^Travel .*: .*km, total ₹/);
    expect((await say(ARUN, 'stock excel')).refused).toBe(true);
    expect((await say(ARUN, 'targets excel')).refused).toBe(true);
  });
  it('without a file word the screens still open', async () => {
    expect((await say(HO, 'team today')).go).toBe('fd-team');
    expect((await say(ARUN, 'my expenses')).go).toBe('fd-expenses');
  });
});
