// The owner's two Home numbers (item 7, 14 Nov 2026) must agree with the screens behind them (tester, 14 Nov 2026):
// sales = net sales before GST after credit notes (Reports / GST / TESRAX); outstanding = what ACTIVE shops owe (Outstanding screen).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ChangeSet, db, setSession, today, activeShops } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { ownerNumbers } from '../src/core/ownerCard';
import { period, salesSummary } from '../src/core/reports';
import { invoiceBalances, r2 } from '../src/core/ledger';
import type { Role, Shop } from '../src/core/types';
const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));

describe("owner's Home numbers", () => {
  it('sales this month = Reports net before GST; a credit note this month lowers it', async () => {
    const before = await ownerNumbers();
    expect(before.sales).toBe((await salesSummary(period('month'))).net.taxable);
    const inv = (await db.invoices.toArray()).find(i => !i.cancelled && i.date.slice(0, 7) === today().slice(0, 7))!;
    const cs = new ChangeSet();
    cs.put('creditNotes', { number: 'CN/HOME/1', invoiceId: inv.id, shopId: inv.shopId, companyId: inv.companyId, date: today(), reason: 'return', lines: [{ productId: inv.lines[0].productId, line: 0, qty: 1, amount: 100, restock: false }], total: 100 } as never);
    await cs.commit('return');
    const after = await ownerNumbers();
    expect(after.sales).toBeLessThan(before.sales);
    expect(after.sales).toBe((await salesSummary(period('month'))).net.taxable);
  });
  it('outstanding = the Outstanding screen: a shop that is no longer active is not counted', async () => {
    const owing = (await invoiceBalances()).find(b => b.balance > 0.5)!;
    const shop = (await db.shops.get(owing.invoice.shopId))! as Shop;
    const cs = new ChangeSet(); cs.put<Shop>('shops', { ...shop, active: false }); await cs.commit('shop closed');
    const act = new Set((await activeShops()).map(s => s.id));
    const screen = r2((await invoiceBalances()).filter(b => b.balance > 0.5 && act.has(b.invoice.shopId)).reduce((a, b) => a + b.balance, 0));
    const all = r2((await invoiceBalances()).filter(b => b.balance > 0.5).reduce((a, b) => a + b.balance, 0));
    expect(screen).toBeLessThan(all);
    expect((await ownerNumbers()).outstanding).toBe(screen);
  });
});
