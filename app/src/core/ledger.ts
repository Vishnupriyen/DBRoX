import { db, today } from './db';
import type { Invoice, Shop } from './types';

// Money rules. Plain code, never AI: every number must be exact and explainable.
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoiceBalance { invoice: Invoice; paid: number; credited: number; balance: number; overdueDays: number }

export async function invoiceBalances(shopId?: string): Promise<InvoiceBalance[]> {
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
  return live.map(invoice => {
    const paid = paidBy.get(invoice.id) ?? 0;
    const credited = credBy.get(invoice.id) ?? 0;
    const balance = r2(invoice.total - paid - credited);
    const days = shops.get(invoice.shopId)?.creditDays ?? 0;
    const due = new Date(invoice.date).getTime() + days * 86400000;
    const overdueDays = balance > 0.5 ? Math.max(0, Math.floor((t - due) / 86400000)) : 0;
    return { invoice, paid, credited, balance, overdueDays };
  }).sort((a, b) => a.invoice.date.localeCompare(b.invoice.date) || a.invoice.number.localeCompare(b.invoice.number));
}

export async function shopOutstanding(shopId: string) {
  const bal = (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
  const advance = (await db.payments.where('shopId').equals(shopId).toArray())
    .filter(p => p.status === 'ok').reduce((s, p) => s + (p.advance || 0), 0);
  return {
    total: r2(bal.reduce((s, b) => s + b.balance, 0) - advance),
    overdue: r2(bal.filter(b => b.overdueDays > 0).reduce((s, b) => s + b.balance, 0)),
    maxOverdueDays: Math.max(0, ...bal.map(b => b.overdueDays)),
    bills: bal,
    advance,
  };
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

export function isB2B(shop: Shop) { return !!shop.gstin && shop.gstin.length === 15; }

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
