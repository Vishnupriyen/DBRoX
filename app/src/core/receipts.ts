// Collection receipts: every collection gets a running receipt number (R/<financial year>/<n>) the shop can be shown and
// sent on WhatsApp. With a server the number comes from it, like bills; without signal the collection is still saved
// (money is never held up) and gets its number at the next sync. No server (demo): a counter on this phone.
import { inr, showDate, showTime } from './i18n';
import { ChangeSet, db, getSettings, newId, today } from './db';
import { finYear } from './billing';
import { nextNumbers, PENDING_MARK, isPendingNumber, server } from './sync';
import type { Payment } from './types';

export async function receiptNumber(cs: ChangeSet): Promise<string> {
  const fy = finYear(today());
  if (await server()) {
    let first: number | null = null;
    try { first = (await nextNumbers('receipt', 1))?.first ?? null; } catch { first = null; }
    return first === null ? `R/${fy}${PENDING_MARK}${newId().slice(-6)}` : `R/${fy}/${String(first).padStart(5, '0')}`;
  }
  const st = await getSettings();
  const n = st.nextReceiptNo ?? (await db.payments.filter(p => !!p.receiptNo).count()) + 1;
  cs.put('settings', { ...st, nextReceiptNo: n + 1 }, 'receipt number');
  return `R/${fy}/${String(n).padStart(5, '0')}`;
}

/** before a sync: every collection still waiting gives way to its server number (without signal they keep waiting) */
export async function numberPendingReceipts() {
  const pend = (await db.payments.toArray()).filter(p => isPendingNumber(p.receiptNo));
  if (!pend.length) return 0;
  let got: { first: number } | null;
  try { got = await nextNumbers('receipt', Math.min(pend.length, 20)); } catch { return 0; }
  if (!got) return 0;
  let next = got.first;
  const cs = new ChangeSet({ noAudit: true });
  for (const p of pend.slice(0, 20)) {
    const no = p.receiptNo!;
    cs.put('payments', { ...p, receiptNo: `${no.slice(0, no.indexOf(PENDING_MARK))}/${String(next++).padStart(5, '0')}` });
  }
  await cs.commit('Receipt numbers from the server');
  return cs.size;
}

/** the receipt as the shop reads it (shown on the phone, sent on WhatsApp) */
export async function receiptText(p: Payment) {
  const st = await getSettings();
  const shop = await db.shops.get(p.shopId);
  const by = (await db.staff.get(p.collectedBy))?.name.split(' (')[0] ?? '';
  const bills = (await Promise.all(p.allocations.map(async a => (await db.invoices.get(a.invoiceId))?.number ?? (await db.openingDues.get(a.invoiceId))?.ref ?? ''))).filter(Boolean);
  const no = isPendingNumber(p.receiptNo) ? 'number at next sync' : p.receiptNo ?? '';
  return [
    `${st.firmName} — Receipt ${no}`,
    `${showDate(p.date)} ${showTime(p.createdAt)}`,
    `Received from ${shop?.name ?? ''}: ${inr(p.amount)} by ${p.mode.toUpperCase()}${p.ref ? ` (${p.ref})` : ''}${p.mode === 'cheque' && p.chequeDate ? `, cheque dated ${showDate(p.chequeDate)}` : ''}`,
    bills.length ? `Against: ${bills.join(', ')}` : '',
    p.advance > 0 ? `Kept as advance: ${inr(p.advance)}` : '',
    by ? `Collected by ${by}` : '',
  ].filter(Boolean).join('\n');
}
