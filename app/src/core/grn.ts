import { inr, plural } from './i18n';
// Step 4 — digital goods receipt (distributor side) and the order to the company.
// The company's bill arrives with its lines already in (from the company's own data: Hanubix or its SAP/Tally upload).
// The QR on a GST e-invoice holds only the header (seller, buyer, bill no, date, value, number of lines, main HSN, IRN),
// so it is used to CONFIRM this is the same bill — never as the source of the lines (independent review, 10 Nov 2026).
// Differences are typed the TESRAX way ("surf 2 case short, 1 case damaged"); on ✓ the stock goes in, the purchase is
// recorded as billed (GST input), and each difference becomes a claim line that points to the company bill and its IRN.
import { ChangeSet, daysFrom, db, getSettings, nowIso, session, today } from './db';
import { authHeader } from './secure';
import { bestProduct, norm, parseItemLines, toPieces } from './match';
import type { ClaimEntry, Inbound, PrimaryOrder, Product, Purchase, Receipt } from './types';
import { server } from './sync';

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- the e-invoice QR
export interface EinvQr { SellerGstin?: string; BuyerGstin?: string; DocNo?: string; DocDt?: string; TotInvVal?: number; ItemCnt?: number; MainHsnCode?: string; Irn?: string }
/** the signed QR is a JWT: its middle part holds {"data": "<json>"} with the bill header (the signature is NIC's) */
export function readEinvoiceQr(text: string): EinvQr | null {
  const parts = text.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)))));
    const data = typeof json.data === 'string' ? JSON.parse(json.data) : json.data ?? json;
    return data && (data.DocNo || data.Irn) ? data as EinvQr : null;
  } catch { return null; }
}
/** what does not match between the QR and the bill that arrived (empty = same bill) */
export function compareQr(inb: Inbound, qr: EinvQr, myGstin: string): string[] {
  const out: string[] = [];
  if (qr.DocNo && norm(qr.DocNo) !== norm(inb.number)) out.push(`QR bill number ${qr.DocNo}, this bill ${inb.number}`);
  if (qr.Irn && inb.irn && qr.Irn !== inb.irn) out.push('IRN on the QR is different');
  if (qr.TotInvVal != null && Math.abs(qr.TotInvVal - inb.total) > 1) out.push(`QR value ${inr(qr.TotInvVal)}, this bill ${inr(inb.total)}`);
  if (qr.ItemCnt != null && qr.ItemCnt !== inb.lines.length) out.push(`QR says ${plural(qr.ItemCnt, 'line')}, this bill has ${inb.lines.length}`);
  if (qr.BuyerGstin && myGstin && qr.BuyerGstin !== myGstin) out.push('The bill is made out to another GSTIN');
  return out;
}

// ---------------------------------------------------------------- differences, typed
export interface Diff { productId: string; qty: number }
const SHORT = /\b(short|shortage|missing|less|not received|not come|didn t come)\b/;
const DAMAGED = /\b(damaged|damage|broken|leak|leaked|leaking|torn|crushed|wet|expired)\b/;
/** "coconut oil 2 case short, 1 case sambar damaged" against THIS bill's products only */
export async function readDifferences(text: string, inb: Inbound): Promise<{ short: Diff[]; damaged: Diff[]; unclear: string[] }> {
  const products = (await db.products.bulkGet(inb.lines.map(l => l.productId))).filter((p): p is Product => !!p);
  const short: Diff[] = [], damaged: Diff[] = [], unclear: string[] = [];
  for (const part of text.split(/,|\n|;/).map(x => x.trim()).filter(Boolean)) {
    const n = norm(part);
    const kind = DAMAGED.test(n) ? 'damaged' : SHORT.test(n) ? 'short' : null;
    const rest = n.replace(SHORT, ' ').replace(DAMAGED, ' ').replace(/\s+/g, ' ').trim();
    const line = parseItemLines(rest)[0];
    const p = line ? bestProduct(products, line.productText).product : undefined;
    if (!kind || !line || !p) { unclear.push(part); continue; }
    (kind === 'short' ? short : damaged).push({ productId: p.id, qty: toPieces(line.qty, line.unit, p) });
  }
  return { short, damaged, unclear };
}

/** this phone's record of receiving a company bill (none = still to receive) */
export async function receiptOf(inboundId: string) { return db.receipts.get(inboundId); }

/** receive the company's bill: stock in (what came, in good condition), purchase as billed, differences as claim lines */
export async function receiveInbound(id: string, short: Diff[], damaged: Diff[]) {
  const inb = await db.inbound.get(id);
  if (!inb) throw new Error('Bill not found.');
  if (await db.receipts.get(id)) throw new Error('This bill is already received.');
  if (inb.cancelled) throw new Error('The company cancelled this bill.');
  if (inb.lines.some(l => !l.productId)) throw new Error('A product on this bill is not in your list yet. Sync once and open the bill again.');
  const sum = (list: Diff[], pid: string) => list.filter(d => d.productId === pid).reduce((a, d) => a + d.qty, 0);
  for (const d of [...short, ...damaged]) {
    if (!Number.isInteger(d.qty) || d.qty <= 0) throw new Error('A difference must be a whole number of pieces.');
    const l = inb.lines.find(x => x.productId === d.productId);
    if (!l) throw new Error('A difference is for a product that is not on this bill.');
  }
  for (const l of inb.lines) if (sum(short, l.productId) + sum(damaged, l.productId) > l.qty + (l.freeQty ?? 0)) throw new Error(`${l.name}: more short or damaged than the bill has.`);
  // two phones offline must not both put the goods into stock: the server lets one phone receive it
  const url = await server();
  if (url) {
    if (!navigator.onLine) throw new Error('Receiving a company bill needs internet for a moment (so two phones never receive it twice).');
    const r = await fetch(`${url}/v1/receipt/claim`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ inboundId: id }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not reach the server. Try again with internet.');
  }
  const me = session().userId;
  const month = today().slice(0, 7);
  const cs = new ChangeSet();
  for (const l of inb.lines) {
    const good = l.qty + (l.freeQty ?? 0) - sum(short, l.productId) - sum(damaged, l.productId);
    if (good > 0) cs.put('batches', { productId: l.productId, batch: l.batch || inb.number, expiry: l.expiry || daysFrom(365), mrp: l.mrp ?? 0, qty: good, godown: 'Main' }, 'stock in from company bill');
  }
  const purchase = cs.put<Purchase>('purchases', {
    companyId: inb.companyId, billNo: inb.number, date: inb.date, source: 'company',
    lines: inb.lines.map(l => ({ productId: l.productId, batch: l.batch ?? '', expiry: l.expiry ?? '', mrp: l.mrp ?? 0, qty: l.qty, freeQty: l.freeQty ?? 0, rate: l.rate, discount: 0, gst: l.gst, amount: l.taxable })),
    taxable: inb.taxable, tax: inb.tax, total: inb.total,
  } as Purchase, 'purchase from company bill');
  const coId = (pid: string) => inb.lines.find(l => l.productId === pid)!.coProductId;
  for (const [list, why] of [[short, 'Short at receipt'], [damaged, 'Damaged at receipt']] as [Diff[], string][]) for (const d of list) {
    const l = inb.lines.find(x => x.productId === d.productId)!;
    cs.put<ClaimEntry>('claimEntries', { companyId: inb.companyId, month, kind: 'shortage', productId: d.productId, qty: d.qty, amount: r2(d.qty * l.rate * (1 + l.gst / 100)), note: `${why} · ${l.name}`, refNumber: inb.number, irn: inb.irn } as ClaimEntry, 'receipt difference → claim');
  }
  const diff = short.length + damaged.length > 0;
  cs.put<Receipt>('receipts', { id: inb.id, inboundId: inb.id, companyId: inb.companyId, status: diff ? 'disputed' : 'received', receivedAt: nowIso(), receivedBy: me, purchaseId: purchase.id,
    short: short.map(d => ({ productId: coId(d.productId), qty: d.qty })), damaged: damaged.map(d => ({ productId: coId(d.productId), qty: d.qty })) } as Receipt, 'company bill received');
  await cs.commit(`Received ${inb.number}`);
  return { diff };
}

// ---------------------------------------------------------------- the order to the company (suggested)
export interface SuggestRow { productId: string; name: string; caseSize: number; perDay: number; stock: number; inTransit: number; cases: number }
/** what to order so stock covers `coverDays` after the goods take `leadDays` to come */
export async function suggestOrder(companyId: string, coverDays = 15, leadDays = 3): Promise<SuggestRow[]> {
  const products = (await db.products.where('companyId').equals(companyId).toArray()).filter(p => p.active);
  const since = daysFrom(-30), t = today();
  const sold = new Map<string, number>();
  for (const i of await db.invoices.where('companyId').equals(companyId).toArray()) if (!i.cancelled && i.date >= since) for (const l of i.lines) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty + l.freeQty);
  const transit = new Map<string, number>();
  const got = new Set((await db.receipts.toArray()).map(r => r.inboundId));
  for (const i of await db.inbound.where('companyId').equals(companyId).toArray()) if (!got.has(i.id) && !i.cancelled) for (const l of i.lines) transit.set(l.productId, (transit.get(l.productId) ?? 0) + l.qty + (l.freeQty ?? 0));
  const out: SuggestRow[] = [];
  for (const p of products) {
    const stock = (await db.batches.where('productId').equals(p.id).toArray()).filter(b => b.expiry >= t).reduce((a, b) => a + b.qty, 0);
    const perDay = (sold.get(p.id) ?? 0) / 30, inTransit = transit.get(p.id) ?? 0;
    const need = perDay * (coverDays + leadDays) - stock - inTransit;
    out.push({ productId: p.id, name: p.name, caseSize: p.caseSize, perDay: r2(perDay), stock, inTransit, cases: need > 0 ? Math.ceil(need / p.caseSize) : 0 });
  }
  return out.sort((a, b) => b.cases - a.cases || a.name.localeCompare(b.name));
}
export async function sendPrimaryOrder(companyId: string, lines: { productId: string; qty: number }[], note = '') {
  const co = await db.companies.get(companyId);
  if (co?.link?.status !== 'linked') throw new Error('This company is not linked. Order the usual way.');
  const clean = lines.filter(l => l.qty > 0);
  if (!clean.length) throw new Error('Add at least one product.');
  if (clean.some(l => !Number.isInteger(l.qty))) throw new Error('Quantities must be whole pieces.');
  const recent = (await db.primaryOrders.where('companyId').equals(companyId).toArray()).find(o => Date.now() - Date.parse(o.createdAt) < 60000 && o.status === 'sent');
  if (recent) return recent; // a double tap
  const cs = new ChangeSet();
  const o = cs.put<PrimaryOrder>('primaryOrders', { companyId, date: today(), lines: clean, status: 'sent', note } as PrimaryOrder, 'order to company');
  await cs.commit(`Order to ${co.name}`);
  return o;
}

// ---------------------------------------------------------------- company side: invoice an order from a distributor
export async function invoiceFromOrder(orderId: string, number: string) {
  const o = await db.primaryOrders.get(orderId);
  if (!o) throw new Error('Order not found.');
  if (!number.trim()) throw new Error('Give the invoice number (as in your billing system).');
  const inv = await db.primaryInvoices.toArray();
  if (inv.some(i => i.primaryOrderId === orderId && !i.cancelled)) throw new Error('This order is already invoiced.');
  if (inv.some(i => i.number === number.trim())) throw new Error(`Invoice ${number} already exists.`);
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const missing = o.lines.filter(l => !products.get(l.productId));
  if (missing.length) throw new Error(`${missing.map(l => l.name ?? 'A product').join(', ')} is not in your product list — add it, then invoice (the order is never shortened silently).`);
  const lines = o.lines.map(l => { const p = products.get(l.productId)!; const taxable = r2(l.qty * p.purchaseRate); return { productId: p.id, name: p.name, hsn: p.hsn, qty: l.qty, freeQty: 0, rate: p.purchaseRate, gst: p.gst, taxable, tax: r2(taxable * p.gst / 100), mrp: p.mrp }; });
  const taxable = r2(lines.reduce((a, l) => a + l.taxable, 0)), tax = r2(lines.reduce((a, l) => a + l.tax, 0));
  const cs = new ChangeSet();
  cs.put('primaryInvoices', { dbLinkId: o.dbLinkId, number: number.trim(), date: today(), lines, taxable, tax, total: Math.round(taxable + tax), primaryOrderId: o.id, source: 'typed' }, 'invoice from order');
  await cs.commit(`Invoice ${number}`);
  void getSettings;
}
