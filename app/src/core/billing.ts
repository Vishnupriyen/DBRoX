import { ChangeSet, db, getSettings, today } from './db';
import { isB2B, r2, shopOutstanding } from './ledger';
import type { Batch, Company, Invoice, InvoiceLine, Order, OrderLine, Product, Scheme, Shop } from './types';

// ---------- schemes ----------
export function activeSchemes(all: Scheme[], p: Product, date: string) {
  return all.filter(s => s.companyId === p.companyId && (!s.productId || s.productId === p.id) && s.from <= date && s.to >= date);
}

export function applySchemes(_p: Product, qty: number, rate: number, schemes: Scheme[]) {
  const gross = r2(qty * rate);
  let discount = 0;
  let freeQty = 0;
  const names: string[] = [];
  // company schemes first, then own schemes; "replace" own schemes cancel company % discounts
  const ordered = [...schemes].sort((a, b) => (a.source === 'company' ? -1 : 1) - (b.source === 'company' ? -1 : 1));
  let pctTotal = 0;
  for (const s of ordered) {
    if (s.type === 'pct') {
      if (s.source === 'own' && s.combine === 'replace') pctTotal = s.value; else pctTotal += s.value;
      names.push(s.name);
    } else if (s.type === 'free' && s.buyQty && s.freeQty && qty >= s.buyQty) {
      freeQty += Math.floor(qty / s.buyQty) * s.freeQty;
      names.push(s.name);
    }
  }
  discount = r2(gross * pctTotal / 100);
  return { gross, discount, freeQty, names };
}

// ---------- stock: oldest expiry first (FEFO) ----------
export function pickBatches(batches: Batch[], productId: string, qty: number, date = today()) {
  const usable = batches
    .filter(b => b.productId === productId && b.qty > 0 && b.expiry >= date)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  const picks: { batchId: string; batch: string; qty: number; expiry: string }[] = [];
  let need = qty;
  for (const b of usable) {
    if (need <= 0) break;
    const take = Math.min(b.qty, need);
    picks.push({ batchId: b.id, batch: b.batch, qty: take, expiry: b.expiry });
    need -= take;
  }
  return { picks, short: need };
}

export async function stockOf(productId: string) {
  const bs = await db.batches.where('productId').equals(productId).toArray();
  return bs.filter(b => b.expiry >= today()).reduce((s, b) => s + b.qty, 0);
}

// ---------- checks before billing ----------
export interface OrderCheck { issues: string[]; total: number }

export async function checkOrder(shop: Shop, lines: OrderLine[]): Promise<OrderCheck> {
  const issues: string[] = [];
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const batches = await db.batches.toArray();
  const settings = await getSettings();
  let total = 0;
  for (const l of lines) {
    const p = products.get(l.productId);
    if (!p) { issues.push('Unknown product'); continue; }
    total += l.qty * l.rate * (1 + p.gst / 100);
    const { short } = pickBatches(batches, p.id, l.qty);
    if (short > 0) issues.push(`Stock short: ${p.name} needs ${short} more pcs`);
    if (l.rate < p.rate * (1 - settings.discountAlertPct / 100)) issues.push(`Low rate for ${p.name}: ₹${l.rate} vs ₹${p.rate}`);
  }
  if (!shop.approved) issues.push('New shop not yet approved by owner');
  const out = await shopOutstanding(shop.id);
  if (shop.cashOnly && out.total > 0.5) issues.push(`Cash-only shop has ₹${out.total} pending`);
  if (shop.creditLimit > 0 && out.total + total > shop.creditLimit) {
    issues.push(`Credit limit ₹${shop.creditLimit} crossed (pending ₹${r2(out.total)} + this ₹${r2(total)})`);
  }
  if (out.maxOverdueDays > 0) issues.push(`Overdue ${out.maxOverdueDays} days (₹${out.overdue})`);
  return { issues, total: r2(total) };
}

// ---------- making bills (one per company) ----------
function finYear(date: string) {
  const [y, m] = date.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export async function makeInvoices(cs: ChangeSet, order: Order, shop: Shop): Promise<Invoice[]> {
  const settings = await getSettings();
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const companies = new Map((await db.companies.toArray()).map(c => [c.id, c]));
  const schemes = await db.schemes.toArray();
  const batches = await db.batches.toArray();
  const date = order.date || today();
  const byCompany = new Map<string, OrderLine[]>();
  for (const l of order.lines) {
    const p = products.get(l.productId);
    if (!p) continue;
    byCompany.set(p.companyId, [...(byCompany.get(p.companyId) ?? []), l]);
  }
  const shopState = shop.gstin?.slice(0, 2) || settings.stateCode;
  const inter = shopState !== settings.stateCode;
  const out: Invoice[] = [];
  for (const [companyId, lines] of byCompany) {
    const company = companies.get(companyId) as Company;
    const invLines: InvoiceLine[] = [];
    for (const l of lines) {
      const p = products.get(l.productId)!;
      const sch = applySchemes(p, l.qty, l.rate, activeSchemes(schemes, p, date));
      const { picks } = pickBatches(batches, p.id, l.qty + sch.freeQty, date);
      for (const pk of picks) {
        const b = batches.find(x => x.id === pk.batchId)!;
        b.qty -= pk.qty;
        cs.put('batches', { ...b }, 'stock out');
      }
      const taxable = r2(sch.gross - sch.discount);
      const tax = r2(taxable * p.gst / 100);
      invLines.push({
        productId: p.id, name: p.name, nameTa: p.nameTa, hsn: p.hsn, qty: l.qty, freeQty: sch.freeQty,
        rate: l.rate, mrp: p.mrp, gross: sch.gross, discount: sch.discount, taxable, gst: p.gst,
        cgst: inter ? 0 : r2(tax / 2), sgst: inter ? 0 : r2(tax - r2(tax / 2)), igst: inter ? tax : 0,
        total: r2(taxable + tax), batches: picks, schemeNames: sch.names,
      });
    }
    const taxable = r2(invLines.reduce((s, x) => s + x.taxable, 0));
    const cgst = r2(invLines.reduce((s, x) => s + x.cgst, 0));
    const sgst = r2(invLines.reduce((s, x) => s + x.sgst, 0));
    const igst = r2(invLines.reduce((s, x) => s + x.igst, 0));
    const exact = r2(taxable + cgst + sgst + igst);
    const total = Math.round(exact);
    const freeValue = invLines.reduce((s, x) => s + x.freeQty * x.rate, 0);
    const number = `${company.code}/${finYear(date)}/${String(company.nextBillNo).padStart(5, '0')}`;
    company.nextBillNo += 1;
    cs.put('companies', { ...company }, 'bill number');
    const inv = cs.put<Invoice>('invoices', {
      number, companyId, shopId: shop.id, orderId: order.id, date, kind: isB2B(shop) ? 'B2B' : 'B2C',
      lines: invLines, taxable, cgst, sgst, igst, roundOff: r2(total - exact), total,
      schemeSaving: r2(invLines.reduce((s, x) => s + x.discount, 0) + freeValue),
      deliveryStatus: 'pending',
    }, 'bill made');
    out.push(inv);
    // every company scheme given becomes a claim line automatically (RoX Claim Prep)
    for (const x of invLines) {
      const schemeValue = r2(x.discount + x.freeQty * x.rate);
      if (schemeValue > 0) {
        cs.put('claimEntries', {
          companyId, month: date.slice(0, 7), kind: 'scheme', productId: x.productId,
          qty: x.qty, amount: schemeValue, invoiceId: inv.id, note: x.schemeNames.join(', '),
        }, 'scheme claim line');
      }
    }
  }
  return out;
}

// Book an order and, if every check passes, bill it straight away. Otherwise it waits for the owner.
export async function placeOrder(cs: ChangeSet, shop: Shop, lines: OrderLine[], source: Order['source'], by: string, autoBill: boolean) {
  const check = await checkOrder(shop, lines);
  const order = cs.put<Order>('orders', {
    shopId: shop.id, salesmanId: by, source, lines, date: today(),
    status: check.issues.length || !autoBill ? 'needs_ok' : 'billed', issues: check.issues, invoiceIds: [],
  }, 'order booked');
  let invoices: Invoice[] = [];
  if (order.status === 'billed') {
    invoices = await makeInvoices(cs, order, shop);
    order.invoiceIds = invoices.map(i => i.id);
  }
  return { order, invoices, check };
}
