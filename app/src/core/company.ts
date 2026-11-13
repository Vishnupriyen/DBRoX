// Company side (a brand's head office and team). Logic only — screens are in ui/Company*.tsx.
// Words used in the app: "Sales to distributors" (primary: company → distributor) and "Distributor sales to shops"
// (secondary: distributor → shop). Every save goes through ChangeSet; numbers are computed, never typed twice.
import { ChangeSet, daysFrom, db, getSettings, newId, thisMonth, today } from './db';
import { GST_RATES } from './gst';
import { bestProduct, norm } from './match';
import { weakPin, WEAK_PIN_MSG } from './sync';
import { authHeader } from './secure';
import { mapColumns, num, toIsoDate } from './readers';
import type { DbLink, PrimaryInvoice, PrimaryLine, Product, Scheme, Shop, Staff } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function inviteCode() { const b = crypto.getRandomValues(new Uint8Array(6)); return [...b].map(x => CODE[x % CODE.length]).join(''); }

export async function isCompany() { return (await db.settings.toCollection().first())?.kind === 'company'; }

// ---------------------------------------------------------------- distributors
export async function inviteDistributor(name: string, town: string, normDays: number, kind: DbLink['kind'] = 'distributor') {
  if (!name.trim()) throw new Error('Give the distributor\'s firm name.');
  if (!(normDays > 0 && normDays <= 120)) throw new Error('Stock norm is the days of stock the distributor should hold (1–120).');
  const taken = new Set((await db.dbLinks.toArray()).map(l => l.inviteCode));
  let code = inviteCode(); while (taken.has(code)) code = inviteCode();
  const cs = new ChangeSet();
  const l = cs.put<DbLink>('dbLinks', { name: name.trim(), town: town.trim(), inviteCode: code, status: 'invited', normDays, kind });
  await cs.commit('invite distributor');
  return l;
}
export async function setLinkStatus(id: string, status: 'paused' | 'linked') {
  const l = await db.dbLinks.get(id);
  if (!l || l.status === 'left' || l.status === 'invited') throw new Error('Only a linked distributor can be paused or resumed.');
  const cs = new ChangeSet(); cs.put('dbLinks', { ...l, status }, status === 'paused' ? 'pause distributor' : 'resume distributor'); await cs.commit(status);
  // on resume, what changed during the pause is caught up (the server does this itself; the demo does it here)
  if (status === 'linked') { const { resyncLink } = await import('./link'); const { server } = await import('./sync'); if (!(await server())) await resyncLink(id); }
}
export async function setNorm(id: string, normDays: number) {
  if (!(normDays > 0 && normDays <= 120)) throw new Error('Stock norm must be 1–120 days.');
  const l = await db.dbLinks.get(id); if (!l) return;
  const cs = new ChangeSet(); cs.put('dbLinks', { ...l, normDays }, 'stock norm'); await cs.commit('stock norm');
}

// ---------------------------------------------------------------- products & schemes (sent to every linked distributor)
export interface ProductInput { id?: string; name: string; code?: string; hsn: string; gst: number; mrp: number; rate: number; purchaseRate: number; caseSize: number; aliases?: string[]; active?: boolean; focus?: boolean }
export function checkProduct(p: ProductInput): string | null {
  if (!p.name.trim()) return 'Product name is needed.';
  if (!GST_RATES.includes(p.gst)) return `GST must be ${GST_RATES.join(', ')}.`;
  if (!(p.mrp > 0)) return 'MRP must be more than 0.';
  if (!(p.rate > 0) || p.rate > p.mrp) return 'Price to shop (PTR) must be more than 0 and not above MRP.';
  if (!(p.purchaseRate > 0) || p.purchaseRate > p.rate) return 'Price to distributor (PTD) must be more than 0 and not above PTR.';
  if (!(p.caseSize >= 1) || !Number.isInteger(p.caseSize)) return 'Pieces per case must be a whole number.';
  return null;
}
export async function saveProducts(list: ProductInput[]) {
  const cs = new ChangeSet();
  const all = await db.products.toArray();
  for (const p of list) {
    const bad = checkProduct(p); if (bad) throw new Error(`${p.name || 'A product'}: ${bad}`);
    const cur = p.id ? all.find(x => x.id === p.id) : all.find(x => (p.code && x.code === p.code) || norm(x.name) === norm(p.name));
    cs.put<Product>('products', { ...(cur ?? { companyId: 'own', aliases: [], active: true }), ...p, id: cur?.id ?? p.id, name: p.name.trim(), aliases: p.aliases ?? cur?.aliases ?? [], active: p.active ?? cur?.active ?? true }, cur ? 'product changed' : 'product added');
  }
  await cs.commit(`${list.length} product${list.length === 1 ? '' : 's'}`);
}
export interface SchemeInput { name: string; productId?: string; type: 'pct' | 'free'; value: number; buyQty?: number; freeQty?: number; from: string; to: string; budget?: number }
export async function saveScheme(s: SchemeInput) {
  if (!s.name.trim()) throw new Error('Give the scheme a name.');
  if (s.type === 'pct' && !(s.value > 0 && s.value <= 50)) throw new Error('Discount must be between 0 and 50%.');
  if (s.type === 'free' && !((s.buyQty ?? 0) >= 1 && (s.freeQty ?? 0) >= 1)) throw new Error('Say buy how many, get how many free.');
  if (!s.from || !s.to || s.to < s.from) throw new Error('The end date must be on or after the start date.');
  if (s.budget != null && !(s.budget > 0)) throw new Error('Budget must be more than 0.');
  const cs = new ChangeSet();
  cs.put<Scheme>('schemes', { companyId: 'own', productId: s.productId || undefined, name: s.name.trim(), type: s.type, value: s.type === 'pct' ? s.value : 0, buyQty: s.buyQty, freeQty: s.freeQty, from: s.from, to: s.to, source: 'company', combine: 'add', budget: s.budget } as Scheme, 'scheme');
  await cs.commit('scheme');
}

// ---------------------------------------------------------------- invoices to distributors (from SAP / Tally sales register)
export interface PrimaryRow { invoice: string; date: string; distributor: string; gstin: string; item: string; code: string; hsn: string; qty: number; free: number; rate: number; gst: number; taxable: number; batch: string; expiry: string; mrp: number; irn: string }
export function readPrimaryRows(rows: string[][]): PrimaryRow[] | null {
  const m = mapColumns(rows, {
    invoice: ['invoice no', 'invoice number', 'bill no', 'voucher no', 'inv no', 'document no', 'billing document', 'invoice'],
    date: ['invoice date', 'date', 'bill date', 'voucher date', 'billing date'],
    distributor: ['distributor', 'customer', 'party', 'sold to', 'customer name', 'party name', 'buyer'],
    gstin: ['gstin', 'customer gstin', 'buyer gstin', 'gst no'],
    item: ['item', 'material description', 'product', 'description', 'item name', 'sku name'],
    code: ['material', 'item code', 'sku', 'material code', 'code'],
    hsn: ['hsn', 'hsn code', 'hsn sac'],
    qty: ['qty', 'quantity', 'billed qty', 'pcs', 'units'],
    free: ['free', 'free qty', 'scheme qty'],
    rate: ['rate', 'unit price', 'price', 'ptd', 'basic rate'],
    gst: ['gst', 'gst %', 'tax %', 'gst rate', 'tax rate'],
    taxable: ['taxable', 'taxable value', 'net value', 'amount', 'value'],
    batch: ['batch', 'batch no'], expiry: ['expiry', 'exp', 'exp date', 'best before'], mrp: ['mrp'], irn: ['irn'],
  }, ['invoice', 'distributor', 'item', 'qty']);
  if (!m) return null;
  const g = (r: string[], f: string) => (m.map[f] != null ? r[m.map[f]] ?? '' : '');
  return rows.slice(m.headerRow + 1).filter(r => g(r, 'invoice') && g(r, 'item') && num(g(r, 'qty')) > 0 && !/total/i.test(g(r, 'item'))).map(r => ({
    invoice: g(r, 'invoice').trim(), date: toIsoDate(g(r, 'date')) || today(), distributor: g(r, 'distributor').trim(), gstin: g(r, 'gstin').toUpperCase().trim(),
    item: g(r, 'item').trim(), code: g(r, 'code').trim(), hsn: g(r, 'hsn'), qty: num(g(r, 'qty')), free: num(g(r, 'free')), rate: num(g(r, 'rate')),
    gst: num(g(r, 'gst')), taxable: num(g(r, 'taxable')), batch: g(r, 'batch'), expiry: toIsoDate(g(r, 'expiry')), mrp: num(g(r, 'mrp')), irn: g(r, 'irn').trim(),
  }));
}
export interface PrimaryDraft { invoice: PrimaryInvoice; problems: string[] }
/** group rows into invoices; each must name a linked distributor and known products — problems are shown, never guessed */
export async function draftPrimary(rows: PrimaryRow[]): Promise<PrimaryDraft[]> {
  const links = (await db.dbLinks.toArray()).filter(l => l.status === 'linked');
  const products = (await db.products.toArray()).filter(p => p.active);
  const existing = new Set((await db.primaryInvoices.toArray()).map(i => i.number));
  const by = new Map<string, PrimaryRow[]>();
  for (const r of rows) by.set(r.invoice, [...(by.get(r.invoice) ?? []), r]);
  const out: PrimaryDraft[] = [];
  for (const [number, rs] of by) {
    const problems: string[] = [];
    if (existing.has(number)) problems.push(`Invoice ${number} is already sent.`);
    const first = rs[0];
    // GSTIN first, else the exact name — never a "close" name: a bill sent to the wrong firm shows it another's rates
    const link = (first.gstin ? links.find(l => l.gstin && l.gstin.toUpperCase() === first.gstin) : undefined)
      ?? (!first.gstin ? links.find(l => norm(l.name) === norm(first.distributor)) : undefined);
    if (!link) problems.push(first.gstin ? `GSTIN ${first.gstin} ("${first.distributor}") is not a linked distributor.` : `"${first.distributor}" is not a linked distributor (the name must match exactly, or add a GSTIN column).`);
    const lines: PrimaryLine[] = [];
    for (const r of rs) {
      const p = products.find(x => r.code && x.code && norm(x.code) === norm(r.code)) ?? bestProduct(products, r.item).product;
      if (!p) { problems.push(`Product "${r.item}" is not in your product list.`); continue; }
      const rate = r.rate || p.purchaseRate;
      const taxable = r.taxable || r2(r.qty * rate);
      const gst = r.gst || p.gst;
      lines.push({ productId: p.id, name: p.name, hsn: r.hsn || p.hsn, qty: r.qty, freeQty: r.free, rate, gst, taxable, tax: r2(taxable * gst / 100), batch: r.batch || undefined, expiry: r.expiry || undefined, mrp: r.mrp || p.mrp });
    }
    const taxable = r2(lines.reduce((a, l) => a + l.taxable, 0)), tax = r2(lines.reduce((a, l) => a + l.tax, 0));
    out.push({ problems, invoice: { id: newId(), tenantId: '', createdAt: '', updatedAt: '', dbLinkId: link?.id ?? '', number, irn: first.irn || undefined, date: first.date, lines, taxable, tax, total: Math.round(taxable + tax), source: 'excel' } });
  }
  return out;
}
export async function sendPrimary(drafts: PrimaryDraft[]) {
  const ok = drafts.filter(d => !d.problems.length);
  if (!ok.length) throw new Error('Nothing to send: fix the problems shown first.');
  const cs = new ChangeSet();
  for (const d of ok) { const { id: _i, tenantId: _t, createdAt: _c, updatedAt: _u, ...rest } = d.invoice; void _i; void _t; void _c; void _u; cs.put<PrimaryInvoice>('primaryInvoices', rest, 'invoice to distributor'); }
  await cs.commit(`${ok.length} invoice${ok.length === 1 ? '' : 's'} to distributors`);
  return ok.length;
}

// ---------------------------------------------------------------- the numbers
export interface DbRow { link: DbLink; primary: number; secondary: number; returns: number; shops: number; bills: number; stockValue: number; lowCover: number }
const inMonth = (d: string, m: string) => d.slice(0, 7) === m;
/** sales to distributors vs distributor sales to shops, by distributor, for a month (values before GST) */
// ---- with a server, a brand's numbers come from the server's running totals (its phones never hold every bill)
async function remote<T>(kind: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { server } = await import('./sync');
  const url = await server(); if (!url) return null;
  const r = await fetch(`${url}/v1/company/report`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ kind, ...args }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not load the report. Check the internet.');
  return (await r.json()).data as T;
}
/** a few of the company's records the phone does not keep (the bills behind a claim): fetched and kept for this check */
export async function fetchDocs(tbl: 'secondary' | 'dbStock' | 'shops', args: { ids?: string[]; dbLinkId?: string }) {
  const { server } = await import('./sync');
  const url = await server(); if (!url) return;
  const r = await fetch(`${url}/v1/company/docs`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ tbl, ...args }) });
  if (!r.ok) throw new Error('Could not load the records. Check the internet.');
  const docs = (await r.json()).docs as { id: string }[];
  if (docs.length) await db.table(tbl).bulkPut(docs.map(d => ({ ...d, dirty: 0 })));
}

export async function salesByDistributor(month = thisMonth()): Promise<DbRow[]> {
  const rem = await remote<DbRow[]>('links', { month }); if (rem) return rem;
  const links = (await db.dbLinks.toArray()).filter(l => l.status !== 'invited');
  const prim = (await db.primaryInvoices.toArray()).filter(i => !i.cancelled && inMonth(i.date, month));
  const sec = (await db.secondary.toArray()).filter(i => !i.cancelled && inMonth(i.date, month));
  const ret = (await db.secondaryReturns.toArray()).filter(i => inMonth(i.date, month));
  const cover = await stockCover();
  return links.map(link => {
    const s = sec.filter(i => i.dbLinkId === link.id);
    return {
      link,
      primary: r2(prim.filter(i => i.dbLinkId === link.id).reduce((a, i) => a + i.taxable, 0)),
      secondary: r2(s.reduce((a, i) => a + i.taxable, 0)),
      returns: r2(ret.filter(i => i.dbLinkId === link.id).reduce((a, i) => a + i.total, 0)),
      shops: new Set(s.map(i => i.shopId)).size, bills: s.length,
      stockValue: r2(cover.filter(c => c.dbLinkId === link.id).reduce((a, c) => a + c.value, 0)),
      lowCover: cover.filter(c => c.dbLinkId === link.id && c.status === 'low').length,
    };
  });
}
export interface ProductRow { productId: string; name: string; primaryQty: number; secondaryQty: number; secondaryValue: number }
export async function salesByProduct(month = thisMonth(), dbLinkId?: string): Promise<ProductRow[]> {
  const rem = await remote<ProductRow[]>('products', { month, dbLinkId }); if (rem) return rem;
  const products = await db.products.toArray();
  const rows = new Map<string, ProductRow>(products.map(p => [p.id, { productId: p.id, name: p.name, primaryQty: 0, secondaryQty: 0, secondaryValue: 0 }]));
  for (const i of await db.primaryInvoices.toArray()) if (!i.cancelled && inMonth(i.date, month) && (!dbLinkId || i.dbLinkId === dbLinkId)) for (const l of i.lines) { const r = rows.get(l.productId); if (r) r.primaryQty += l.qty; }
  for (const i of await db.secondary.toArray()) if (!i.cancelled && inMonth(i.date, month) && (!dbLinkId || i.dbLinkId === dbLinkId)) for (const l of i.lines) { const r = rows.get(l.productId); if (r) { r.secondaryQty += l.qty; r.secondaryValue = r2(r.secondaryValue + l.taxable); } }
  return [...rows.values()].filter(r => r.primaryQty || r.secondaryQty).sort((a, b) => b.secondaryValue - a.secondaryValue);
}
export interface CoverRow { dbLinkId: string; productId: string; name: string; qty: number; perDay: number; days: number | null; norm: number; status: 'low' | 'ok' | 'high' | 'none'; nearExpiry: number; value: number }
/** stock at each distributor in days of sales (last 30 days), against that distributor's stock norm */
export async function stockCover(opts: { dbLinkId?: string; status?: string } = {}): Promise<CoverRow[]> {
  const rem = await remote<{ rows: CoverRow[] }>('stock', { ...opts, limit: 500 }); if (rem) return rem.rows;
  const links = new Map((await db.dbLinks.toArray()).map(l => [l.id, l]));
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const since = daysFrom(-30);
  const sold = new Map<string, number>();
  for (const i of await db.secondary.toArray()) if (!i.cancelled && i.date >= since) for (const l of i.lines) sold.set(`${i.dbLinkId}:${l.productId}`, (sold.get(`${i.dbLinkId}:${l.productId}`) ?? 0) + l.qty + (l.freeQty ?? 0));
  const out: CoverRow[] = [];
  for (const s of await db.dbStock.toArray()) {
    const link = links.get(s.dbLinkId); if (!link || link.status === 'invited') continue;
    const perDay = (sold.get(`${s.dbLinkId}:${s.productId}`) ?? 0) / 30;
    const days = perDay > 0 ? Math.round(s.qty / perDay) : null;
    const normD = link.normDays ?? 15;
    const status = s.qty === 0 && perDay === 0 ? 'none' : days === null ? (s.qty > 0 ? 'high' : 'none') : days < normD * 0.5 ? 'low' : days > normD * 2 ? 'high' : 'ok';
    if (opts.dbLinkId && s.dbLinkId !== opts.dbLinkId) continue;
    out.push({ dbLinkId: s.dbLinkId, productId: s.productId, name: s.name || products.get(s.productId)?.name || '', qty: s.qty, perDay: r2(perDay), days, norm: normD, status, nearExpiry: s.nearExpiry, value: r2(s.qty * (products.get(s.productId)?.purchaseRate ?? 0)) });
  }
  return out.sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
}

// ---------------------------------------------------------------- team
export interface StaffInput { id?: string; name: string; phone: string; role: 'cadmin' | 'manager' | 'rep'; level?: Staff['level']; managerId?: string; dbLinkIds: string[]; hq?: string; grade?: string; pin?: string; active?: boolean }
export async function saveStaff(s: StaffInput) {
  if (!s.name.trim()) throw new Error('Name is needed.');
  if (!/^[6-9]\d{9}$/.test(s.phone)) throw new Error('Mobile must be 10 digits.');
  const all = await db.staff.toArray();
  if (all.some(x => x.phone === s.phone && x.id !== s.id)) throw new Error('This mobile already has a login.');
  const cur = s.id ? all.find(x => x.id === s.id) : undefined;
  if (!cur && !/^\d{4}$/.test(s.pin ?? '')) throw new Error('Give a 4-digit PIN for the first login.');
  if (s.pin && s.pin !== cur?.pin && weakPin(s.pin)) throw new Error(WEAK_PIN_MSG);
  if (s.role === 'manager' && !s.level) throw new Error('Choose RSM, ASM or SO.');
  const cs = new ChangeSet();
  cs.put<Staff>('staff', { ...(cur ?? {}), id: cur?.id, name: s.name.trim(), phone: s.phone, role: s.role, level: s.role === 'manager' ? s.level : undefined, managerId: s.managerId || undefined, dbLinkIds: s.dbLinkIds, hq: s.hq?.trim() || undefined, grade: s.grade || undefined, pin: s.pin || cur?.pin || '', active: s.active ?? cur?.active ?? true } as Staff, cur ? 'team member changed' : 'team member added');
  await cs.commit('team');
}
/** the people a manager looks after: everyone below them in the reporting line (and themselves) */
export async function myTeam(meId: string): Promise<Staff[]> {
  const all = (await db.staff.toArray()).filter(s => s.active);
  const me = all.find(s => s.id === meId);
  if (!me) return [];
  if (me.role === 'cadmin') return all;
  const out = new Set<string>([meId]);
  let grew = true;
  while (grew) { grew = false; for (const s of all) if (s.managerId && out.has(s.managerId) && !out.has(s.id)) { out.add(s.id); grew = true; } }
  return all.filter(s => out.has(s.id));
}
/** the distributors a person may see: head office all; others those of their team */
export async function myLinks(meId: string): Promise<DbLink[]> {
  const me = await db.staff.get(meId);
  const links = await db.dbLinks.toArray();
  if (!me || me.role === 'cadmin') return links;
  const ids = new Set((await myTeam(meId)).flatMap(s => s.dbLinkIds ?? []));
  return links.filter(l => ids.has(l.id));
}

export async function companyName() { return (await getSettings()).firmName; }

/** shops reached this month, and a search over the shop list (from the server when there is one) */
export async function outletList(q = ''): Promise<{ total: number; bought: number; shops: (Shop & { monthValue: number })[] }> {
  const rem = await remote<{ total: number; bought: number; shops: (Shop & { monthValue: number })[] }>('outlets', { q }); if (rem) return rem;
  const links = new Set((await myLinks((await import('./db')).session().userId)).map(l => l.id));
  const m = new Map<string, number>();
  for (const x of await db.secondary.toArray()) if (!x.cancelled && x.date.slice(0, 7) === thisMonth()) m.set(x.shopId, (m.get(x.shopId) ?? 0) + x.taxable);
  const all = (await db.shops.toArray()).filter(x => x.active !== false && (!x.dbLinkId || links.has(x.dbLinkId)));
  const hit = q.trim() ? all.filter(x => `${x.name} ${x.area} ${x.beat}`.toLowerCase().includes(q.trim().toLowerCase())) : all;
  return { total: all.length, bought: all.filter(x => m.get(x.id)).length, shops: hit.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300).map(x => ({ ...x, monthValue: r2(m.get(x.id) ?? 0) })) };
}
