// Opening balances: the day a distributor starts on Hanubix. Old shop dues (bill-wise, or one amount with a date) and
// opening stock per product and batch come in from the owner's Excel. Old dues are collected like open bills but are
// never GST bills or sales; opening stock is never a purchase, so nothing is owed to a company for it.
// Every load is checked first: what is saved adds up to the sheet's own total, to the rupee.
import { inr, plural } from './i18n';
import { ChangeSet, db, newId, session, today } from './db';
import { r2 } from './ledger';
import { norm } from './match';
import { readOpeningDueRows, readOpeningStockRows, readSheet, toIsoDate } from './readers';
import type { Batch, OpeningDue, Product, Shop } from './types';
import type { Proposal, Validation } from './proposals';

const n = (v: unknown) => Number(v) || 0;
const s = (v: unknown) => String(v ?? '').trim();
const err = (v: Validation, row: number, col: string, msg: string) => { (v.errors[row] ??= {})[col] = msg; };

/** the shop a sheet names: same name (or a known other name), spaces and dots ignored */
export function shopNamed(shops: Shop[], name: string): Shop | undefined {
  const k = norm(name);
  return shops.find(x => norm(x.name) === k) ?? shops.find(x => (x.aliases ?? []).some(a => norm(a) === k));
}
/** the product a sheet names: by code, else by name */
export function productNamed(products: Product[], item: string, code = ''): Product | undefined {
  const c = norm(code);
  return (c ? products.find(p => norm(p.code ?? '') === c || p.aliases.some(a => norm(a) === c)) : undefined)
    ?? products.find(p => norm(p.name) === norm(item)) ?? products.find(p => p.aliases.some(a => norm(a) === norm(item)));
}

// ---------------------------------------------------------------- old dues
export async function openingDuesProposal(file: File) {
  const rows = readOpeningDueRows(await readSheet(file));
  if (!rows) return { text: 'I could not find the shop and amount (balance) columns in this sheet.', tone: 'error' as const };
  const shops = (await db.shops.toArray()).filter(x => x.active !== false);
  const sheetTotal = r2(rows.reduce((a, r) => a + r.amount, 0));
  return {
    text: `${plural(rows.length, 'old due')} read · sheet total ${inr(sheetTotal)}. Check each shop, then ✓. They show in outstanding and can be collected like bills.`,
    proposal: {
      id: newId(), kind: 'openingDues' as const, title: 'Old dues (opening balance)',
      fields: [{ key: 'asOn', label: 'As on (rows with no date)', type: 'date' as const, value: today() }],
      columns: [
        { key: 'said', label: 'Sheet says', readonly: true, width: 140 },
        { key: 'shopId', label: 'Shop', type: 'select' as const, options: [{ value: '', label: '— pick —' }, ...shops.sort((a, b) => a.name.localeCompare(b.name)).map(x => ({ value: x.id, label: x.name }))], width: 160 },
        { key: 'ref', label: 'Old bill no', width: 100 },
        { key: 'date', label: 'Date', type: 'date' as const, width: 110 },
        { key: 'amount', label: 'Due ₹', type: 'number' as const, width: 90 },
      ],
      rows: rows.map(r => ({ said: r.shop, shopId: shopNamed(shops, r.shop)?.id ?? '', ref: r.ref, date: r.date, amount: r.amount })),
      meta: { sheetTotal },
    } satisfies Proposal,
  };
}

/** a due already loaded (same shop and old bill no; or, without a bill no, same shop, date and amount) */
const dueKey = (d: Pick<OpeningDue, 'shopId' | 'ref' | 'date' | 'amount'>) => d.ref ? `${d.shopId}|ref|${norm(d.ref)}` : `${d.shopId}|${d.date}|${r2(d.amount)}`;

export async function validateOpeningDues(p: Proposal, v: Validation) {
  const asOn = toIsoDate(s(p.fields.find(f => f.key === 'asOn')?.value)) || today();
  const have = new Set((await db.openingDues.toArray()).map(dueKey));
  const seen = new Set<string>();
  let total = 0; const shopsIn = new Set<string>();
  p.rows.forEach((r, i) => {
    if (!s(r.shopId)) err(v, i, 'shopId', 'No such shop here — add the shop first, or pick it');
    if (!(n(r.amount) > 0)) err(v, i, 'amount', 'A due is more than ₹0');
    const date = toIsoDate(s(r.date)) || asOn;
    if (date > today()) err(v, i, 'date', 'An old due is dated today or before');
    const k = dueKey({ shopId: s(r.shopId), ref: s(r.ref), date, amount: n(r.amount) });
    if (have.has(k)) err(v, i, 'ref', 'Already loaded');
    else if (seen.has(k)) err(v, i, 'ref', 'Twice in this sheet');
    seen.add(k); total = r2(total + n(r.amount)); if (s(r.shopId)) shopsIn.add(s(r.shopId));
  });
  const sheet = n(p.meta.sheetTotal);
  if (p.meta.sheetTotal != null && Math.abs(sheet - total) > 0.004) v.warnings.push(`These rows come to ${inr(total)} but the sheet came to ${inr(sheet)} — a row was changed or removed.`);
  v.summary = `${plural(p.rows.length, 'old due')} · ${plural(shopsIn.size, 'shop')} · total ${inr(total)}${p.meta.sheetTotal != null ? ` (sheet ${inr(sheet)})` : ''}`;
}

export async function commitOpeningDues(cs: ChangeSet, p: Proposal) {
  const v: Validation = { errors: {}, fieldErrors: {}, warnings: [], summary: '' };
  await validateOpeningDues(p, v); // read again at save time: a double tap finds every row "already loaded"
  const first = Object.values(v.errors)[0]; if (first) throw new Error(Object.values(first)[0]);
  const asOn = toIsoDate(s(p.fields.find(f => f.key === 'asOn')?.value)) || today();
  const loadId = newId();
  let total = 0; const shops = new Set<string>();
  for (const r of p.rows) {
    cs.put<OpeningDue>('openingDues', { shopId: s(r.shopId), ref: s(r.ref), date: toIsoDate(s(r.date)) || asOn, amount: r2(n(r.amount)), loadId }, 'old due loaded');
    total = r2(total + n(r.amount)); shops.add(s(r.shopId));
  }
  return { total, rows: p.rows.length, shops: shops.size, message: `Old dues loaded: ${plural(p.rows.length, 'row')} for ${plural(shops.size, 'shop')}, total ${inr(total)}${p.meta.sheetTotal != null ? ` — the sheet's total is ${inr(n(p.meta.sheetTotal))}` : ''}. They show in outstanding and Collect.` };
}

/** what was loaded, for the owner to compare with the sheet */
export async function openingDueTotals() {
  const all = await db.openingDues.toArray();
  return { rows: all.length, shops: new Set(all.map(d => d.shopId)).size, total: r2(all.reduce((a, d) => a + d.amount, 0)) };
}

// ---------------------------------------------------------------- opening stock
export async function openingStockProposal(file: File) {
  const rows = readOpeningStockRows(await readSheet(file));
  if (!rows) return { text: 'I could not find the product and quantity columns in this sheet.', tone: 'error' as const };
  const products = (await db.products.toArray()).filter(x => x.active);
  const owner = (await db.staff.get(session().userId))?.role === 'owner';
  const sheetPcs = rows.reduce((a, r) => a + r.qty, 0);
  const valued = rows.some(r => r.rate > 0);
  const sheetValue = r2(rows.reduce((a, r) => a + r.qty * r.rate, 0));
  return {
    text: `${plural(rows.length, 'stock line')} read · ${sheetPcs} pcs${valued && owner ? ` · ${inr(sheetValue)}` : ''}. This is opening stock: no purchase bill and nothing owed to the company. Check, then ✓.`,
    proposal: {
      id: newId(), kind: 'openingStock' as const, title: 'Opening stock', fields: [],
      columns: [
        { key: 'said', label: 'Sheet says', readonly: true, width: 140 },
        { key: 'productId', label: 'Product', type: 'select' as const, options: [{ value: '', label: '— pick —' }, ...products.sort((a, b) => a.name.localeCompare(b.name)).map(x => ({ value: x.id, label: x.name }))], width: 170 },
        { key: 'batch', label: 'Batch', width: 80 },
        { key: 'expiry', label: 'Expiry', type: 'date' as const, width: 110 },
        { key: 'mrp', label: 'MRP', type: 'number' as const, width: 70 },
        { key: 'qty', label: 'Pcs', type: 'number' as const, width: 70 },
        ...(owner ? [{ key: 'rate', label: 'Buy rate', type: 'number' as const, width: 80 }] : []),
      ],
      rows: rows.map(r => { const pr = productNamed(products, r.item, r.code); return { said: r.item, productId: pr?.id ?? '', batch: r.batch || 'OPENING', expiry: r.expiry, mrp: r.mrp || pr?.mrp || 0, qty: r.qty, ...(owner ? { rate: r.rate } : {}) }; }),
      meta: { sheetPcs, ...(valued && owner ? { sheetValue } : {}) },
    } satisfies Proposal,
  };
}

export async function validateOpeningStock(p: Proposal, v: Validation) {
  const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
  let pcs = 0, value = 0, noExpiry = 0;
  p.rows.forEach((r, i) => {
    const pr = products.get(s(r.productId));
    if (!pr) err(v, i, 'productId', 'Pick the product (add it to Products first)');
    if (!Number.isInteger(n(r.qty)) || n(r.qty) <= 0) err(v, i, 'qty', 'Whole pieces, more than 0');
    if (!s(r.expiry)) noExpiry++;
    pcs += n(r.qty);
    const rate = n(r.rate) > 0 ? n(r.rate) : pr?.purchaseRate;
    if (typeof rate === 'number' && Number.isFinite(rate)) value = r2(value + n(r.qty) * rate);
  });
  if (noExpiry) v.warnings.push(`${plural(noExpiry, 'line')} with no expiry date: sold after the dated lots.`);
  if (p.meta.sheetPcs != null && n(p.meta.sheetPcs) !== pcs) v.warnings.push(`These rows come to ${pcs} pcs but the sheet came to ${n(p.meta.sheetPcs)} pcs — a row was changed or removed.`);
  const owner = (await db.staff.get(session().userId))?.role === 'owner';
  v.summary = `${plural(p.rows.length, 'lot')} · ${pcs} pcs${owner ? ` · ${inr(value)} at buying rate` : ''} · no purchase, nothing owed`;
}

const loading = new Set<string>();
export async function commitOpeningStock(cs: ChangeSet, p: Proposal) {
  if (loading.has(p.id) || p.meta.loaded) throw new Error('This opening stock is already loaded.'); // a double tap loads it once
  loading.add(p.id);
  try {
    const v: Validation = { errors: {}, fieldErrors: {}, warnings: [], summary: '' };
    await validateOpeningStock(p, v);
    const first = Object.values(v.errors)[0]; if (first) throw new Error(Object.values(first)[0]);
    const products = new Map((await db.products.toArray()).map(x => [x.id, x]));
    const batches = await db.batches.toArray();
    let pcs = 0, value = 0;
    for (const r of p.rows) {
      const pr = products.get(s(r.productId))!;
      const batch = s(r.batch) || 'OPENING', expiry = toIsoDate(s(r.expiry)) || '9999-12-31';
      const lot = batches.find(b => b.productId === pr.id && b.batch === batch && b.expiry === expiry);
      if (lot) { lot.qty += n(r.qty); cs.put<Batch>('batches', { ...lot }, 'opening stock'); }
      else { const b = cs.put<Batch>('batches', { productId: pr.id, batch, expiry, mrp: n(r.mrp) || pr.mrp, qty: n(r.qty), godown: 'Main' }, 'opening stock'); batches.push(b); }
      pcs += n(r.qty);
      const rate = n(r.rate) > 0 ? n(r.rate) : pr.purchaseRate;
      if (typeof rate === 'number' && Number.isFinite(rate)) value = r2(value + n(r.qty) * rate);
    }
    const owner = (await db.staff.get(session().userId))?.role === 'owner';
    return { pcs, value, message: `Opening stock loaded: ${plural(p.rows.length, 'lot')}, ${pcs} pcs${owner ? `, ${inr(value)} at buying rate` : ''}${p.meta.sheetValue != null && owner ? ` — the sheet's total is ${inr(n(p.meta.sheetValue))}` : ''}. No purchase bill was made, so nothing is owed to the company.` };
  } finally { loading.delete(p.id); }
}

