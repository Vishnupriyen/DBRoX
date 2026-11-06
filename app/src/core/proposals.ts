// A Proposal is what the TESRAX prepares for a person to check: a header + an Excel-style table.
// Nothing is written until the person taps ✓. Code (not AI) validates every row before that.
import { ChangeSet, db, getSettings, session, today } from './db';
import { checkOrder, creditNoteNumbers, makeInvoices, pickBatches } from './billing';
import { bookOrder } from './pipeline';
import { allocateOldestFirst, invoiceBalances, r2, validGstin } from './ledger';
import { toIsoDate } from './readers';
import type { Batch, CreditNote, Expense, Invoice, Order, Payment, Product, Purchase, Shop } from './types';

export type CellValue = string | number;
export type Row = Record<string, CellValue>;

export interface Col {
  key: string; label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: { value: string; label: string }[];
  readonly?: boolean;
  width?: number;
}

export type ProposalKind =
  | 'purchase' | 'expense' | 'bank' | 'order' | 'payment' | 'claim' | 'return'
  | 'products' | 'shops' | 'newshop' | 'schemes' | 'view';

export interface Proposal {
  id: string;
  kind: ProposalKind;
  title: string;
  fields: (Col & { value: CellValue })[]; // header values (bill no, shop, date …)
  columns: Col[];
  rows: Row[];
  meta: Record<string, unknown>;
  readonly?: boolean;
  note?: string;
  downloadName?: string;
}

export interface Validation {
  errors: Record<number, Record<string, string>>; // row → column → message
  fieldErrors: Record<string, string>;
  warnings: string[];
  summary: string;
}

export const fieldValue = (p: Proposal, key: string) => p.fields.find(f => f.key === key)?.value ?? '';
const n = (v: CellValue | undefined) => Number(v) || 0;
const s = (v: CellValue | undefined) => String(v ?? '').trim();
const err = (v: Validation, row: number, col: string, msg: string) => { (v.errors[row] ??= {})[col] = msg; };

export async function productOptions(companyId?: string) {
  const ps = (await db.products.toArray()).filter(p => p.active && (!companyId || p.companyId === companyId));
  return [{ value: '', label: '— pick —' }, { value: '__new', label: '+ New product' },
    ...ps.sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name }))];
}
export async function shopOptions() {
  const ss = await db.shops.toArray();
  return [{ value: '', label: '— pick —' }, ...ss.sort((a, b) => a.name.localeCompare(b.name)).map(x => ({ value: x.id, label: `${x.name} · ${x.area}` }))];
}
export async function companyOptions() {
  return [{ value: '', label: '— pick —' }, ...(await db.companies.toArray()).map(c => ({ value: c.id, label: c.name }))];
}

// ---------------------------------------------------------------------------------------------
// VALIDATE
// ---------------------------------------------------------------------------------------------
export async function validate(p: Proposal): Promise<Validation> {
  const v: Validation = { errors: {}, fieldErrors: {}, warnings: [], summary: '' };
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  switch (p.kind) {
    case 'purchase': {
      if (!s(fieldValue(p, 'companyId'))) v.fieldErrors.companyId = 'Pick the company';
      if (!s(fieldValue(p, 'billNo'))) v.fieldErrors.billNo = 'Bill number needed';
      const gstin = s(fieldValue(p, 'supplierGstin')).toUpperCase();
      if (gstin && !validGstin(gstin)) v.fieldErrors.supplierGstin = 'GSTIN looks wrong';
      let sumTaxable = 0, sumTax = 0;
      p.rows.forEach((r, i) => {
        const prod = products.get(s(r.productId));
        if (!s(r.productId)) err(v, i, 'productId', 'Pick the product (or + New product)');
        if (n(r.qty) <= 0) err(v, i, 'qty', 'Quantity must be more than 0');
        if (n(r.rate) <= 0) err(v, i, 'rate', 'Rate missing');
        if (!s(r.batch)) err(v, i, 'batch', 'Batch missing');
        const exp = toIsoDate(s(r.expiry));
        if (!exp) err(v, i, 'expiry', 'Expiry date missing');
        else if (exp < today()) err(v, i, 'expiry', 'Already expired');
        else if ((new Date(exp).getTime() - Date.now()) / 86400000 < 60) v.warnings.push(`Row ${i + 1}: expires within 60 days`);
        if (prod && n(r.gst) && n(r.gst) !== prod.gst) err(v, i, 'gst', `Product master says ${prod.gst}%`);
        if (prod && n(r.mrp) && prod.mrp && n(r.mrp) !== prod.mrp) v.warnings.push(`Row ${i + 1}: MRP changed ${prod.mrp} → ${n(r.mrp)}`);
        const taxable = r2(n(r.qty) * n(r.rate) - n(r.discount));
        const gst = n(r.gst) || prod?.gst || 0;
        const withTax = r2(taxable * (1 + gst / 100));
        if (n(r.amount) && Math.abs(n(r.amount) - taxable) > 1 && Math.abs(n(r.amount) - withTax) > 1) {
          err(v, i, 'amount', `Qty × rate − disc = ${taxable} (with GST ${withTax})`);
        }
        sumTaxable += taxable; sumTax += r2(taxable * gst / 100);
      });
      const billTotal = n(fieldValue(p, 'billTotal'));
      const computed = r2(sumTaxable + sumTax);
      const tol = Math.max(2, p.rows.length * 0.5);
      if (billTotal && Math.abs(billTotal - computed) > tol && Math.abs(billTotal - r2(sumTaxable)) > tol) {
        v.fieldErrors.billTotal = `Lines add up to ₹${computed}, bill says ₹${billTotal}`;
      }
      v.summary = `${p.rows.length} items · taxable ₹${r2(sumTaxable)} · GST ₹${r2(sumTax)} · total ₹${computed}`;
      break;
    }
    case 'expense': {
      p.rows.forEach((r, i) => {
        if (n(r.amount) <= 0) err(v, i, 'amount', 'Amount missing');
        if (!s(r.category)) err(v, i, 'category', 'Pick a category');
        if (!toIsoDate(s(r.date))) err(v, i, 'date', 'Date missing');
      });
      v.summary = `${p.rows.length} expense(s) · ₹${r2(p.rows.reduce((a, r) => a + n(r.amount), 0))}`;
      break;
    }
    case 'bank': {
      let matched = 0, amt = 0;
      p.rows.forEach((r, i) => {
        if (s(r.action) === 'match') {
          if (!s(r.shopId)) err(v, i, 'shopId', 'Pick the shop, or set Ignore');
          matched++; amt += n(r.credit);
        }
        if (s(r.action) === 'check') err(v, i, 'action', 'Unclear — pick the shop and Match, or Ignore');
      });
      v.summary = `${matched} payment(s) matched · ₹${r2(amt)}`;
      break;
    }
    case 'order': {
      const shop = await db.shops.get(s(fieldValue(p, 'shopId')));
      if (!shop) { v.fieldErrors.shopId = 'Pick the shop'; }
      p.rows.forEach((r, i) => {
        if (!products.get(s(r.productId))) err(v, i, 'productId', 'Pick the product');
        if (n(r.qty) <= 0) err(v, i, 'qty', 'Quantity must be more than 0');
      });
      if (shop && !Object.keys(v.errors).length) {
        const lines = p.rows.map(r => ({ productId: s(r.productId), qty: n(r.qty), rate: n(r.rate) }));
        const c = await checkOrder(shop, lines);
        v.warnings.push(...c.issues);
        const me = await db.staff.get(session().userId);
        v.summary = `${lines.length} items · about ₹${c.total} with GST` + (c.issues.length ? (me?.role === 'owner' ? ' · your ✓ approves and bills it' : ' · will wait for owner OK') : ' · ready to bill');
      }
      break;
    }
    case 'payment': {
      if (!s(fieldValue(p, 'shopId'))) v.fieldErrors.shopId = 'Pick the shop';
      const total = n(fieldValue(p, 'amount'));
      if (total <= 0) v.fieldErrors.amount = 'Amount missing';
      const mode = s(fieldValue(p, 'mode'));
      if ((mode === 'upi' || mode === 'cheque') && !s(fieldValue(p, 'ref'))) v.warnings.push('Add the UPI / cheque number to match the bank later');
      let alloc = 0;
      p.rows.forEach((r, i) => {
        if (n(r.pay) > n(r.balance) + 0.5) err(v, i, 'pay', `More than balance ₹${r.balance}`);
        alloc += n(r.pay);
      });
      if (alloc > total + 0.5) v.fieldErrors.amount = `Bills add up to ₹${r2(alloc)}, more than amount`;
      const extra = r2(total - alloc);
      v.summary = `₹${total} · to bills ₹${r2(alloc)}` + (extra > 0.5 ? ` · ₹${extra} kept as advance` : '');
      break;
    }
    case 'claim': {
      p.rows.forEach((r, i) => {
        if (!products.get(s(r.productId))) err(v, i, 'productId', 'Pick the product');
        if (n(r.qty) <= 0) err(v, i, 'qty', 'Quantity must be more than 0');
      });
      v.summary = `${p.rows.length} line(s) · ₹${r2(p.rows.reduce((a, r) => a + n(r.amount), 0))}`;
      break;
    }
    case 'return': {
      const shopId = s(fieldValue(p, 'shopId'));
      if (!shopId) v.fieldErrors.shopId = 'Pick the shop';
      const settings = await getSettings();
      let total = 0;
      p.rows.forEach((r, i) => {
        if (!products.get(s(r.productId))) err(v, i, 'productId', 'Pick the product');
        if (n(r.qty) <= 0) err(v, i, 'qty', 'Quantity must be more than 0');
        if (!s(r.invoiceId)) err(v, i, 'invoiceId', 'No bill found for this item at this shop');
        total += n(r.amount);
      });
      if (total > settings.returnApprovalLimit && session().userId !== 'owner') {
        const me = await db.staff.get(session().userId);
        if (me?.role !== 'owner') v.warnings.push(`Above ₹${settings.returnApprovalLimit}: owner must approve`);
      }
      v.summary = `Credit note ₹${r2(total)}`;
      break;
    }
    case 'products': {
      p.rows.forEach((r, i) => {
        if (!s(r.name)) err(v, i, 'name', 'Name missing');
        if (!s(r.companyId)) err(v, i, 'companyId', 'Pick company');
        if (n(r.rate) <= 0) err(v, i, 'rate', 'Selling rate missing');
        if (![0, 5, 12, 18, 28, 40].includes(n(r.gst))) err(v, i, 'gst', 'GST % should be 0/5/12/18/28/40');
        if (!/^\d{4,8}$/.test(s(r.hsn))) err(v, i, 'hsn', 'HSN should be 4–8 digits');
        else if (!/^(\d{6}|\d{8})$/.test(s(r.hsn))) v.warnings.push(`Row ${i + 1}: e-invoice needs a 6 or 8 digit HSN`);
      });
      v.summary = `${p.rows.length} product(s)`;
      break;
    }
    case 'schemes': {
      p.rows.forEach((r, i) => {
        if (!s(r.companyId)) err(v, i, 'companyId', 'Pick company');
        if (!s(r.name)) err(v, i, 'name', 'Give the scheme a name');
        if (s(r.type) === 'pct' && (n(r.value) <= 0 || n(r.value) > 50)) err(v, i, 'value', '% between 0 and 50');
        if (s(r.type) === 'free' && (n(r.buyQty) <= 0 || n(r.freeQty) <= 0)) err(v, i, 'buyQty', 'Buy and free quantities needed');
        if (!s(r.from) || !s(r.to) || s(r.from) > s(r.to)) err(v, i, 'to', 'End date must be after start date');
      });
      v.summary = `${p.rows.length} scheme(s) — applied automatically on every bill in these dates`;
      break;
    }
    case 'shops':
    case 'newshop': {
      p.rows.forEach((r, i) => {
        if (!s(r.name)) err(v, i, 'name', 'Name missing');
        if (s(r.gstin) && !validGstin(s(r.gstin).toUpperCase())) err(v, i, 'gstin', 'GSTIN looks wrong');
        if (s(r.phone) && !/^[6-9]\d{9}$/.test(s(r.phone).replace(/\D/g, '').slice(-10))) err(v, i, 'phone', '10-digit mobile number');
      });
      v.summary = `${p.rows.length} shop(s)`;
      break;
    }
    default:
      break;
  }
  return v;
}

export const hasErrors = (v: Validation) => Object.keys(v.errors).length > 0 || Object.keys(v.fieldErrors).length > 0;

// ---------------------------------------------------------------------------------------------
// COMMIT — the only place data is written. One ChangeSet = one undo.
// ---------------------------------------------------------------------------------------------
export async function commit(p: Proposal): Promise<{ message: string; batchId: string; invoices?: Invoice[]; orderId?: string }> {
  const cs = new ChangeSet();
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  let message = '';
  let invoices: Invoice[] | undefined;
  let orderId: string | undefined;
  switch (p.kind) {
    case 'purchase': {
      const companyId = s(fieldValue(p, 'companyId'));
      const batches = await db.batches.toArray();
      const lines: Purchase['lines'] = [];
      for (const r of p.rows) {
        let prod = products.get(s(r.productId));
        if (s(r.productId) === '__new' || !prod) {
          prod = cs.put<Product>('products', {
            companyId, name: s(r.item) || 'New product', hsn: s(r.hsn), gst: n(r.gst), mrp: n(r.mrp),
            rate: r2(n(r.rate) * 1.06), purchaseRate: n(r.rate), caseSize: 1, aliases: [s(r.code)].filter(Boolean),
            code: s(r.code), active: true,
          }, 'new product from bill');
          products.set(prod.id, prod);
        } else {
          const upd = { ...prod, purchaseRate: n(r.rate) || prod.purchaseRate, mrp: n(r.mrp) || prod.mrp, hsn: prod.hsn || s(r.hsn) };
          if (s(r.code) && !prod.aliases.includes(s(r.code))) upd.aliases = [...prod.aliases, s(r.code)]; // learn supplier code
          if (s(r.item) && !prod.aliases.includes(s(r.item)) && s(r.item) !== prod.name) upd.aliases = [...upd.aliases, s(r.item)];
          cs.put('products', upd, 'rate/MRP from bill');
        }
        const qty = n(r.qty) + n(r.free);
        const expiry = toIsoDate(s(r.expiry));
        const existing = batches.find(b => b.productId === prod!.id && b.batch === s(r.batch));
        if (existing) { existing.qty += qty; cs.put('batches', { ...existing }, 'stock in'); }
        else cs.put<Batch>('batches', { productId: prod.id, batch: s(r.batch), expiry, mrp: n(r.mrp) || prod.mrp, qty, godown: 'Main' }, 'stock in');
        lines.push({ productId: prod.id, batch: s(r.batch), expiry, mrp: n(r.mrp), qty: n(r.qty), freeQty: n(r.free), rate: n(r.rate), discount: n(r.discount), gst: n(r.gst) || prod.gst, amount: n(r.amount) });
      }
      const taxable = r2(lines.reduce((a, l) => a + l.qty * l.rate - l.discount, 0));
      const tax = r2(lines.reduce((a, l) => a + (l.qty * l.rate - l.discount) * l.gst / 100, 0));
      cs.put<Purchase>('purchases', {
        companyId, billNo: s(fieldValue(p, 'billNo')), date: toIsoDate(s(fieldValue(p, 'date'))) || today(),
        supplierGstin: s(fieldValue(p, 'supplierGstin')).toUpperCase(), lines, taxable, tax, total: r2(taxable + tax),
        source: (p.meta.source as Purchase['source']) ?? 'typed',
      }, 'purchase bill');
      message = `Stock updated: ${lines.length} items added. Purchase bill ${s(fieldValue(p, 'billNo'))} saved.`;
      break;
    }
    case 'expense': {
      for (const r of p.rows) {
        cs.put<Expense>('expenses', { date: toIsoDate(s(r.date)) || today(), category: s(r.category), amount: n(r.amount), vanId: s(r.vanId) || undefined, note: s(r.note), photo: p.meta.photo as string | undefined }, 'expense');
      }
      message = `Expense recorded: ₹${r2(p.rows.reduce((a, r) => a + n(r.amount), 0))}.`;
      break;
    }
    case 'bank': {
      const pays = await db.payments.toArray();
      let count = 0;
      for (const r of p.rows) {
        const action = s(r.action);
        const line = cs.put('bankLines', {
          date: s(r.date), narration: s(r.narration), credit: n(r.credit), debit: n(r.debit), ref: s(r.ref),
          shopId: s(r.shopId) || undefined, status: action === 'match' ? 'matched' : 'ignored', statement: String(p.meta.statement ?? ''),
        });
        if (action !== 'match' || !s(r.shopId)) continue;
        // link to a UPI/cheque payment already recorded by staff, else create a bank receipt
        const existing = pays.find(x => x.id === s(r.paymentId)) ??
          pays.find(x => x.shopId === s(r.shopId) && !x.bankLineId && x.mode !== 'cash' && Math.abs(x.amount - n(r.credit)) < 1);
        if (existing) {
          cs.put('payments', { ...existing, bankLineId: line.id, status: 'ok' }, 'matched to bank');
          cs.put('bankLines', { ...line, paymentId: existing.id }, 'link');
        } else {
          const { allocations, advance } = await allocateOldestFirst(s(r.shopId), n(r.credit));
          const pay = cs.put<Payment>('payments', {
            shopId: s(r.shopId), amount: n(r.credit), mode: 'bank', ref: s(r.ref), date: s(r.date), collectedBy: 'bank',
            shopConfirmed: true, allocations, advance, settled: true, bankLineId: line.id, status: 'ok',
          }, 'bank receipt');
          cs.put('bankLines', { ...line, paymentId: pay.id }, 'link');
        }
        count++;
      }
      message = `Bank statement saved. ${count} payment(s) matched and shop balances updated.`;
      break;
    }
    case 'order': {
      const shop = (await db.shops.get(s(fieldValue(p, 'shopId'))))!;
      const lines = p.rows.map(r => ({ productId: s(r.productId), qty: n(r.qty), rate: n(r.rate) }));
      const order = await bookOrder(cs, shop, lines, session().userId, { source: 'office' });
      orderId = order.id;
      message = `Order for ${shop.name} sent to the godown for picking.` + (order.issues.length ? ` Flagged for you: ${order.issues.join('; ')}.` : '');
      break;
    }
    case 'payment': {
      const allocations = p.rows.filter(r => n(r.pay) > 0).map(r => ({ invoiceId: s(r.invoiceId), amount: n(r.pay) }));
      const amount = n(fieldValue(p, 'amount'));
      const advance = r2(amount - allocations.reduce((a, x) => a + x.amount, 0));
      const me = await db.staff.get(session().userId);
      const inOffice = me?.role === 'owner' || me?.role === 'office';
      cs.put<Payment>('payments', {
        shopId: s(fieldValue(p, 'shopId')), amount, mode: s(fieldValue(p, 'mode')) as Payment['mode'], ref: s(fieldValue(p, 'ref')),
        date: today(), collectedBy: session().userId, shopConfirmed: inOffice || !!p.meta.shopConfirmed,
        confirmPhoto: p.meta.photo as string | undefined, allocations, advance: advance > 0.5 ? advance : 0,
        settled: inOffice, status: 'ok',
      }, 'payment');
      message = `Payment ₹${amount} recorded.`;
      break;
    }
    case 'claim': {
      const month = today().slice(0, 7);
      const batches = await db.batches.toArray();
      for (const r of p.rows) {
        const prod = products.get(s(r.productId))!;
        cs.put('claimEntries', { companyId: prod.companyId, month, kind: s(r.kind) || 'damage', productId: prod.id, qty: n(r.qty), amount: n(r.amount), note: s(r.note), photo: p.meta.photo as string | undefined }, 'damage entry');
        if (s(r.fromStock) !== 'no') {
          const { picks } = pickBatches(batches, prod.id, n(r.qty), '0000-00-00');
          for (const pk of picks) {
            const b = batches.find(x => x.id === pk.batchId)!;
            b.qty -= pk.qty;
            cs.put('batches', { ...b }, 'damaged out of stock');
          }
        }
      }
      message = `Added to claim register for ${month}.`;
      break;
    }
    case 'return': {
      const shopId = s(fieldValue(p, 'shopId'));
      const byInvoice = new Map<string, Row[]>();
      for (const r of p.rows) byInvoice.set(s(r.invoiceId), [...(byInvoice.get(s(r.invoiceId)) ?? []), r]);
      const batches = await db.batches.toArray();
      const cnNos = await creditNoteNumbers(cs, byInvoice.size);
      let i = 0;
      for (const [invoiceId, rows] of byInvoice) {
        const inv = (await db.invoices.get(invoiceId))!;
        const lines = rows.map(r => ({ productId: s(r.productId), qty: n(r.qty), amount: n(r.amount), restock: s(r.restock) !== 'no' }));
        // returned pieces come off the bill's batches (so a later cancel can't restock them again); good ones go back to stock
        for (const l of lines) {
          const line = inv.lines.find(x => x.productId === l.productId); if (!line) continue;
          let left = l.qty;
          for (const lb of line.batches) { if (left <= 0) break; const take = Math.min(left, lb.qty); lb.qty -= take; left -= take; if (l.restock) { const b = batches.find(x => x.id === lb.batchId); if (b) { b.qty += take; cs.put('batches', { ...b }, 'return to stock'); } } }
        }
        cs.put('invoices', { ...inv }, 'returned pieces off the bill');
        const companyId = inv.companyId;
        cs.put<CreditNote>('creditNotes', {
          number: cnNos[i++], invoiceId, shopId, companyId,
          date: today(), reason: s(fieldValue(p, 'reason')) || 'Return', lines, total: r2(lines.reduce((a, l) => a + l.amount, 0)),
        }, 'credit note');
      }
      message = `Credit note made. Shop balance reduced.`;
      break;
    }
    case 'products': {
      for (const r of p.rows) {
        cs.put<Product>('products', {
          id: s(r.id) || undefined, companyId: s(r.companyId), name: s(r.name), nameTa: s(r.nameTa), code: s(r.code), hsn: s(r.hsn), gst: n(r.gst),
          mrp: n(r.mrp), rate: n(r.rate), purchaseRate: n(r.purchaseRate), caseSize: n(r.caseSize) || 1,
          aliases: [s(r.code)].filter(Boolean), active: true,
        }, 'product');
      }
      message = `${p.rows.length} product(s) saved.`;
      break;
    }
    case 'schemes': {
      for (const r of p.rows) {
        cs.put('schemes', {
          companyId: s(r.companyId), productId: s(r.productId) || undefined, name: s(r.name), type: s(r.type) || 'pct',
          value: n(r.value), buyQty: n(r.buyQty) || undefined, freeQty: n(r.freeQty) || undefined,
          from: s(r.from), to: s(r.to), source: s(r.source) || 'company', combine: s(r.combine) || 'add',
        }, 'scheme');
      }
      message = `${p.rows.length} scheme(s) saved. They apply automatically and company schemes go into the monthly claim.`;
      break;
    }
    case 'shops':
    case 'newshop': {
      const me = await db.staff.get(session().userId);
      for (const r of p.rows) {
        cs.put<Shop>('shops', {
          name: s(r.name), owner: s(r.owner), phone: s(r.phone), gstin: s(r.gstin).toUpperCase() || undefined,
          area: s(r.area), beat: s(r.beat), creditLimit: n(r.creditLimit), creditDays: n(r.creditDays) || 7,
          cashOnly: s(r.cashOnly) === 'yes', type: (s(r.type) || 'retail') as Shop['type'],
          approved: me?.role === 'owner' || p.kind === 'shops', aliases: [], address: s(r.address),
          salesmanId: me?.role === 'salesman' ? me.id : undefined,
        }, 'shop');
      }
      message = p.kind === 'newshop' && me?.role !== 'owner'
        ? 'New shop saved. Owner must approve it before the first bill.'
        : `${p.rows.length} shop(s) saved.`;
      break;
    }
    default:
      throw new Error('Nothing to approve');
  }
  const batchId = await cs.commit(p.title);
  return { message, batchId, invoices, orderId };
}

// Bill an order that was waiting for the owner's OK.
export async function approveOrder(orderId: string) {
  const order = (await db.orders.get(orderId))!;
  const shop = (await db.shops.get(order.shopId))!;
  const cs = new ChangeSet();
  const o = cs.put<Order>('orders', { ...order, status: 'billed', issues: order.issues }, 'owner OK');
  const invs = await makeInvoices(cs, o, shop);
  o.invoiceIds = invs.map(i => i.id);
  const batchId = await cs.commit('Owner approved order');
  return { invoices: invs, batchId };
}

export async function balancesForShop(shopId: string) {
  return (await invoiceBalances(shopId)).filter(b => b.balance > 0.5);
}
