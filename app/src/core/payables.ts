// What the distributor owes each company: company bills (purchases) − payments made − company credit notes.
// A payment or a company credit note is set against the oldest open company bills first, and kept on each bill
// (settlements), so every rupee paid is traceable to a bill. Plain code, exact to the paisa.
import { ChangeSet, db, today } from './db';
import { inr } from './i18n';
import { r2 } from './ledger';
import type { Purchase } from './types';

const open = (p: Purchase) => r2(p.total - (p.paid ?? 0) - (p.credited ?? 0));

/** per company: billed, paid, credited and still due */
export async function companyPayables() {
  const out = new Map<string, { billed: number; paid: number; credited: number; due: number; bills: number; oldest: string }>();
  for (const p of await db.purchases.toArray()) {
    const v = out.get(p.companyId) ?? { billed: 0, paid: 0, credited: 0, due: 0, bills: 0, oldest: p.date };
    v.billed = r2(v.billed + p.total); v.paid = r2(v.paid + (p.paid ?? 0)); v.credited = r2(v.credited + (p.credited ?? 0));
    v.due = r2(v.billed - v.paid - v.credited);
    if (open(p) > 0.5) { v.bills++; if (p.date < v.oldest) v.oldest = p.date; }
    out.set(p.companyId, v);
  }
  return out;
}

/** record a payment made to a company, or a credit note received from it (claim settled), against its oldest open bills */
export async function recordCompanyPayment(input: { companyId: string; amount: number; kind: 'payment' | 'credit_note'; ref?: string; mode?: string; date?: string }) {
  const amount = r2(Number(input.amount));
  if (!(amount > 0)) throw new Error('Amount must be more than 0.');
  const bills = (await db.purchases.where('companyId').equals(input.companyId).toArray()).filter(p => open(p) > 0.005).sort((a, b) => a.date.localeCompare(b.date) || a.billNo.localeCompare(b.billNo));
  const due = r2(bills.reduce((a, p) => a + open(p), 0));
  if (amount > due + 0.5) throw new Error(`${inr(amount)} is more than the ${inr(due)} you owe this company. Check the amount.`);
  const cs = new ChangeSet();
  const date = input.date ?? today();
  let left = amount;
  for (const p of bills) {
    if (left <= 0) break;
    const take = r2(Math.min(left, open(p)));
    left = r2(left - take);
    const s = { date, amount: take, kind: input.kind, ref: input.ref?.trim() || undefined, mode: input.mode };
    cs.put<Purchase>('purchases', { ...p, ...(input.kind === 'payment' ? { paid: r2((p.paid ?? 0) + take) } : { credited: r2((p.credited ?? 0) + take) }), settlements: [...(p.settlements ?? []), s] }, input.kind === 'payment' ? 'paid to company' : 'company credit note');
  }
  await cs.commit(input.kind === 'payment' ? 'Payment to company' : 'Company credit note');
}
