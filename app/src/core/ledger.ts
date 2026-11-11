import { db, today } from './db';
import type { Invoice, Shop } from './types';

// Money rules. Plain code, never AI: every number must be exact and explainable.
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceBalance { invoice: Invoice; paid: number; credited: number; balance: number; overdueDays: number }

export async function invoiceBalances(shopId?: string): Promise<InvoiceBalance[]> { return (await balancesAndAdvance(shopId)).rows; }

async function balancesAndAdvance(shopId?: string): Promise<{ rows: InvoiceBalance[]; advanceLeft: Map<string, number> }> {
  const invs = shopId
    ? await db.invoices.where('shopId').equals(shopId).toArray()
    : await db.invoices.toArray();
  const live = invs.filter(i => !i.cancelled);
  const pays = (shopId ? await db.payments.where('shopId').equals(shopId).toArray() : await db.payments.toArray())
    .filter(p => p.status !== 'cancelled' && p.status !== 'bounced');
  const cns = shopId ? await db.creditNotes.where('shopId').equals(shopId).toArray() : await db.creditNotes.toArray();
  const paidBy = new Map<string, number>();
  for (const p of pays) for (const a of p.allocations) paidBy.set(a.invoiceId, (paidBy.get(a.invoiceId) ?? 0) + a.amount);
  const credBy = new Map<string, number>();
  for (const c of cns) credBy.set(c.invoiceId, (credBy.get(c.invoiceId) ?? 0) + c.total);
  const shops = new Map((await db.shops.toArray()).map(s => [s.id, s]));
  const t = new Date(today()).getTime();
  // Shop advance = excess paid + anything paid against a bill that was later cancelled. It is carried to the
  // shop's oldest open bills automatically, so every screen shows the same balance (locked spec 15.1 Collection).
  const cancelledIds = new Set(invs.filter(i => i.cancelled).map(i => i.id));
  const advBy = new Map<string, number>();
  for (const p of pays) { let a = p.advance || 0; for (const x of p.allocations) if (cancelledIds.has(x.invoiceId)) a += x.amount; if (a) advBy.set(p.shopId, r2((advBy.get(p.shopId) ?? 0) + a)); }
  const rows = live.map(invoice => {
    const paid = paidBy.get(invoice.id) ?? 0;
    const credited = credBy.get(invoice.id) ?? 0;
    const balance = r2(invoice.total - paid - credited);
    const days = shops.get(invoice.shopId)?.creditDays ?? 0;
    const due = new Date(invoice.date).getTime() + days * 86400000;
    const overdueDays = balance > 0.5 ? Math.max(0, Math.floor((t - due) / 86400000)) : 0;
    return { invoice, paid, credited, balance, overdueDays };
  }).sort((a, b) => a.invoice.date.localeCompare(b.invoice.date) || a.invoice.number.localeCompare(b.invoice.number));
  // a bill paid in full and then credited (credit note, modified bill) owes the shop money: that is advance too
  for (const r of rows) if (r.balance < 0) { advBy.set(r.invoice.shopId, r2((advBy.get(r.invoice.shopId) ?? 0) - r.balance)); r.paid = r2(r.paid + r.balance); r.balance = 0; }
  for (const r of rows) { const adv = advBy.get(r.invoice.shopId) ?? 0; if (adv > 0 && r.balance > 0) { const use = Math.min(adv, r.balance); r.balance = r2(r.balance - use); r.paid = r2(r.paid + use); advBy.set(r.invoice.shopId, r2(adv - use)); if (r.balance <= 0.5) r.overdueDays = 0; } }
  return { rows, advanceLeft: advBy };
}

export async function shopOutstanding(shopId: string) {
  // advance (excess paid, money on cancelled bills, bills credited below zero) is applied to the oldest bills
  // inside balancesAndAdvance; what is left over is the shop's unused advance
  const { rows, advanceLeft } = await balancesAndAdvance(shopId);
  const bal = rows.filter(b => b.balance > 0.5);
  const advance = r2(Math.max(0, advanceLeft.get(shopId) ?? 0));
  return {
    total: r2(bal.reduce((s, b) => s + b.balance, 0) - advance),
    overdue: r2(bal.filter(b => b.overdueDays > 0).reduce((s, b) => s + b.balance, 0)),
    maxOverdueDays: Math.max(0, ...bal.map(b => b.overdueDays)),
    bills: bal,
    advance,
  };
}

/** every shop's dues in one pass over the bills (the beat screen: one pass per shop took 7.8 s on a cheap phone) */
export interface ShopDue { total: number; overdue: number; maxOverdueDays: number; bills: number; amount: number; oldestDays: number }
export async function allOutstanding(): Promise<Map<string, ShopDue>> {
  const { rows, advanceLeft } = await balancesAndAdvance();
  const out = new Map<string, ShopDue>();
  const blank = (): ShopDue => ({ total: 0, overdue: 0, maxOverdueDays: 0, bills: 0, amount: 0, oldestDays: 0 });
  const now = Date.now();
  for (const b of rows) {
    if (b.balance <= 0.5) continue;
    const v = out.get(b.invoice.shopId) ?? blank();
    v.total = r2(v.total + b.balance); v.amount = r2(v.amount + b.balance); v.bills++;
    v.oldestDays = Math.max(v.oldestDays, Math.floor((now - new Date(b.invoice.date).getTime()) / 86400000));
    if (b.overdueDays > 0) v.overdue = r2(v.overdue + b.balance);
    v.maxOverdueDays = Math.max(v.maxOverdueDays, b.overdueDays);
    out.set(b.invoice.shopId, v);
  }
  for (const [shopId, adv] of advanceLeft) if (adv > 0) { const v = out.get(shopId) ?? blank(); v.total = r2(v.total - Math.max(0, adv)); out.set(shopId, v); }
  return out;
}

// Payment allocation: oldest bill first (default rule from the definition doc).
export async function allocateOldestFirst(shopId: string, amount: number) {
  const bills = (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
  let left = r2(amount);
  const allocations: { invoiceId: string; amount: number }[] = [];
  for (const b of bills) {
    if (left <= 0) break;
    const a = r2(Math.min(left, b.balance));
    allocations.push({ invoiceId: b.invoice.id, amount: a });
    left = r2(left - a);
  }
  return { allocations, advance: left > 0 ? left : 0 };
}

/** B2B only with a GSTIN that passes the format and check-digit test (a typo'd 15 characters is not a registration) */
export function isB2B(shop: Shop) { return !!shop.gstin && validGstin(shop.gstin.trim().toUpperCase()); }

// GSTIN format check (state code + PAN + entity + Z + checksum character).
export function validGstin(g: string): boolean {
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  return check === g[14];
}
