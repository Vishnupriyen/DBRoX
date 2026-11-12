// The shop statement as a file (12 Nov 2026, owner: "every report it should send"). Same figures as the Shop statement
// screen: every bill, payment, credit note and old due, oldest first, the balance after each, closing = balance due.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
const sent: { name: string; sheets: { name: string; header: string[]; rows: (string | number)[][] }[] }[] = [];
vi.mock('../src/core/readers', async (orig) => ({ ...(await orig<object>()), downloadWorkbook: async (name: string, sheets: never) => { sent.push({ name, sheets }); } }));
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { sendStatement, shopStatement, withBalance } from '../src/core/statement';
import type { Role } from '../src/core/types';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; setSession('demo', ids.owner!); });

async function busiest() {
  const shops = await db.shops.toArray(); let best = shops[0], n = -1;
  for (const s of shops) { const d = await shopStatement(s.id); if (d && d.rows.length > n) { n = d.rows.length; best = s; } }
  return best;
}
describe('shop statement file', () => {
  it('the file closes on the balance due, and each balance follows from the one before', async () => {
    const shop = await busiest(); const d = (await shopStatement(shop.id))!;
    expect(d.rows.length).toBeGreaterThan(1);
    sent.length = 0; await sendStatement(shop.id);
    const rows = sent[0].sheets[0].rows.slice(1); // after the column names
    const closing = rows[rows.length - 1];
    expect(closing[1]).toBe('Balance due');
    expect(closing[5]).toBeCloseTo(d.due.total, 2);
    const body = rows.slice(0, -1); let bal = Number(body[0][5]) - Number(body[0][3] || 0) + Number(body[0][4] || 0);
    for (const r of body) { bal = Math.round((bal + Number(r[3] || 0) - Number(r[4] || 0)) * 100) / 100; expect(Number(r[5])).toBeCloseTo(bal, 2); }
    expect(sent[0].sheets[0].header[0]).toContain(shop.name);
  });
  it('a period starts from the opening balance before it', async () => {
    const shop = await busiest(); const d = (await shopStatement(shop.id))!;
    const dates = withBalance(d).map(r => r.at.slice(0, 10)).sort(); const from = dates[Math.floor(dates.length / 2)];
    sent.length = 0; await sendStatement(shop.id, from, '2099-12-31');
    const rows = sent[0].sheets[0].rows.slice(1);
    expect(rows[0][1]).toBe('Opening balance');
    const before = withBalance(d).reverse().filter(r => r.at.slice(0, 10) < from);
    expect(rows[0][5]).toBe(before.length ? before[before.length - 1].balance : 0);
  });
});
describe('TESRAX: "send <shop> statement"', () => {
  it('owner gets the balance in words and a Send statement button', async () => {
    setSession('demo', ids.owner!);
    const shop = await busiest();
    const r = await handle(`send ${shop.name} statement`, [], {});
    expect(r.text).toMatch(new RegExp(`^${shop.name}: balance due ₹`));
    expect(r.actions?.[0].label).toBe('Send statement (Excel)');
    sent.length = 0; await r.actions![0].run(); await new Promise(res => setTimeout(res, 50));
    expect(sent[0].name).toMatch(/^Statement-/);
  });
  it('"<shop> ledger october" is that period; "bank statement" with no shop is still the Bank screen', async () => {
    const shop = await busiest();
    expect((await handle(`${shop.name} ledger october`, [], {})).text).toMatch(/statement for/);
    expect((await handle('bank statement', [], {})).go).toBe('bank');
  });
  it('godown is told who can', async () => {
    setSession('demo', ids.godown!);
    const shop = await busiest();
    const r = await handle(`${shop.name} statement`, [], {});
    expect(r.refused).toBe(true);
    setSession('demo', ids.owner!);
  });
});
