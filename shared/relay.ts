// THE RELAY — the only path data takes between a company and a distributor (and it holds the privacy wall).
// One source for both sides: the server runs it on every sync; the demo phone runs it between its two local stores.
// Pure: no database, no clock, no imports. It is given the change, a way to read each side, and returns what to write.
//
// Privacy wall (tested in app/tests/relay.test.ts and server/test/link.test.ts):
//  - a company receives ONLY its own brand: bills of that company, stock of its products, claims made to it, orders to it;
//  - never another brand's lines, never payments, credit limits, phone numbers, owner names, accounts or staff of the distributor;
//  - nothing crosses unless the link is 'linked' (a distributor who leaves stops all new data at once).

export type Doc = { id: string; tenantId?: string; updatedAt?: string; createdAt?: string; [k: string]: unknown };
export interface Store {
  get(tbl: string, id: string): Promise<Doc | undefined>;
  find(tbl: string, field: string, value: unknown): Promise<Doc[]>;
}
export interface Link {
  id: string;               // the dbLinks record id in the company's data
  companyTenant: string;
  dbTenant: string;
  companyIdInDb: string;    // the distributor's own "companies" record for this company
  status: 'invited' | 'linked' | 'left' | 'paused';
}
export interface Write { tbl: string; doc: Doc; keepTime?: boolean } // keepTime: an update that must not look newer than the record's own edits
export interface Ctx { today: string }

// tables that only the relay may write on each side (the server refuses them from a phone)
export const RELAY_ONLY = {
  company: ['secondary', 'secondaryReturns', 'dbStock', 'dbClaims', 'primaryOrders', 'grns', 'shops'],
  // the company's bills to the distributor are the company's; the distributor's receipt of one is its own "receipts" record
  distributor: ['claimDecisions', 'inbound'],
} as const;
/** on a linked product these are the company's (price list); everything else (aliases, focus) is the distributor's */
export const COMPANY_PRODUCT_FIELDS = ['name', 'code', 'hsn', 'gst', 'mrp', 'rate', 'purchaseRate', 'caseSize', 'active'] as const;
/** a company scheme a distributor's bills can safely apply */
export function sensibleScheme(d: Doc) {
  const v = Number(d.value ?? 0), from = String(d.from ?? ''), to = String(d.to ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return false;
  if (d.type === 'pct') return v > 0 && v <= 50;
  if (d.type === 'free') return Number(d.buyQty) >= 1 && Number(d.freeQty) >= 1 && Number(d.freeQty) <= Number(d.buyQty);
  return false;
}

// what a company may see of a distributor's shop (its outlet list), nothing more
const OUTLET_FIELDS = ['name', 'area', 'beat', 'lat', 'lng', 'type', 'approved', 'active', 'aliases'] as const;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const keep = (d: Doc) => ({ id: d.id, createdAt: d.createdAt, updatedAt: d.updatedAt });

// ---------------------------------------------------------------- product identity
/** the distributor's product for a company product: already linked, else same code, else same name, else none */
export async function dbProductFor(link: Link, db: Store, coProductId: string, co?: Store): Promise<Doc | undefined> {
  const linked = (await db.find('products', 'companyProductId', coProductId)).find(p => p.companyId === link.companyIdInDb);
  if (linked) return linked;
  const cp = co ? await co.get('products', coProductId) : undefined;
  if (!cp) return undefined;
  const mine = (await db.find('products', 'companyId', link.companyIdInDb)).filter(p => !p.companyProductId);
  return mine.find(p => cp.code && p.code && norm(p.code) === norm(cp.code)) ?? mine.find(p => norm(p.name) === norm(cp.name));
}
/** the company's product id for a distributor product, only if it belongs to this company */
async function coProductOf(link: Link, db: Store, dbProductId: string): Promise<{ id: string; name: string } | null> {
  const p = await db.get('products', dbProductId);
  if (!p || p.companyId !== link.companyIdInDb) return null; // another brand: never crosses
  return { id: String(p.companyProductId ?? p.id), name: String(p.name ?? '') };
}

// ---------------------------------------------------------------- company → distributor
export async function companyToDb(link: Link, tbl: string, doc: Doc, db: Store, co: Store, _ctx: Ctx): Promise<Write[]> {
  if (link.status !== 'linked') return [];
  const out: Write[] = [];
  if (tbl === 'products') {
    const cur = await dbProductFor(link, db, doc.id, co);
    const fields = { name: doc.name, code: doc.code, hsn: doc.hsn, gst: doc.gst, mrp: doc.mrp, rate: doc.rate, purchaseRate: doc.purchaseRate, caseSize: doc.caseSize, active: doc.active !== false };
    if (cur) out.push({ tbl: 'products', doc: { ...cur, ...fields, companyProductId: doc.id }, keepTime: true });
    else out.push({ tbl: 'products', doc: { ...keep(doc), ...fields, companyId: link.companyIdInDb, companyProductId: doc.id, aliases: (doc.aliases as string[]) ?? [], focus: !!doc.focus } });
  }
  if (tbl === 'schemes') {
    if (!sensibleScheme(doc)) return []; // 90% off or backwards dates would break the distributor's bills: never sent
    let productId: string | undefined;
    if (doc.productId) productId = (await dbProductFor(link, db, String(doc.productId), co))?.id;
    if (doc.productId && !productId) return []; // the product reaches the distributor first; the scheme follows on its next change
    out.push({ tbl: 'schemes', doc: { ...keep(doc), companyId: link.companyIdInDb, productId, name: doc.name, type: doc.type, value: doc.value, buyQty: doc.buyQty, freeQty: doc.freeQty, from: doc.from, to: doc.to, source: 'company', combine: doc.combine ?? 'add', budget: doc.budget } });
  }
  if (tbl === 'primaryInvoices' && doc.dbLinkId === link.id) {
    // the bill is the company's: always its latest version. Whether and how it was received is the distributor's own
    // "receipts" record, which the company never writes — so an edit or a cancel can never make it "not received".
    const lines: Record<string, unknown>[] = [];
    for (const l of (doc.lines as Doc[]) ?? []) {
      const p = await dbProductFor(link, db, String(l.productId), co);
      lines.push({ ...l, coProductId: l.productId, productId: p?.id ?? '' });
    }
    out.push({ tbl: 'inbound', doc: { ...keep(doc), companyId: link.companyIdInDb, number: doc.number, irn: doc.irn, date: doc.date, lines, taxable: doc.taxable, tax: doc.tax, total: doc.total, primaryOrderId: doc.primaryOrderId, cancelled: doc.cancelled } });
  }
  if (tbl === 'orders' && doc.dbLinkId === link.id) {
    if (await db.get('orders', doc.id)) return []; // the distributor owns the order once it has arrived
    const shop = await db.get('shops', String(doc.shopId));
    if (!shop) return [];
    const lines: Record<string, unknown>[] = [];
    for (const l of (doc.lines as Doc[]) ?? []) {
      const p = await dbProductFor(link, db, String(l.productId), co);
      if (p) lines.push({ productId: p.id, qty: l.qty, rate: p.rate });
    }
    if (!lines.length) return [];
    // flagsPending: the distributor's phone checks it on arrival exactly like a salesman's order (stock, credit, overdue)
    out.push({ tbl: 'orders', doc: { ...keep(doc), shopId: shop.id, source: 'company', companyId: link.companyIdInDb, companyRep: doc.repName, lines, status: 'new', issues: [], flagsPending: true, date: doc.date, invoiceIds: [], visitId: undefined } });
  }
  if (tbl === 'shopRequests' && doc.dbLinkId === link.id) {
    if (await db.get('shops', doc.id)) return [];
    out.push({ tbl: 'shops', doc: { ...keep(doc), name: doc.name, area: doc.area ?? '', beat: doc.beat ?? '', lat: doc.lat, lng: doc.lng, photo: doc.photo, type: 'retail', approved: false, creditLimit: 0, creditDays: 7, cashOnly: true, aliases: [], requestedBy: doc.repName, requestedFor: link.companyIdInDb } }); // limit 0 = cash only until the owner sets one
  }
  // only head office's final word reaches the distributor (an SO's recommendation stays inside the company)
  if (tbl === 'claimDecisions' && doc.dbLinkId === link.id && (doc.status === 'approved' || doc.status === 'rejected')) {
    out.push({ tbl: 'claimDecisions', doc: { ...keep(doc), claimId: doc.claimId, status: doc.status, amount: doc.amount, creditNoteNo: doc.creditNoteNo, note: doc.note, decidedBy: doc.decidedBy, companyId: link.companyIdInDb } });
  }
  return out;
}

// ---------------------------------------------------------------- distributor → company
export async function dbToCompany(link: Link, tbl: string, doc: Doc, db: Store, _co: Store, ctx: Ctx): Promise<Write[]> {
  if (link.status !== 'linked') return [];
  const out: Write[] = [];
  const dbLinkId = link.id;
  if (tbl === 'shops') {
    const o: Doc = { ...keep(doc), dbLinkId, creditLimit: 0, creditDays: 0, cashOnly: false };
    for (const f of OUTLET_FIELDS) if (doc[f] !== undefined) o[f] = doc[f];
    o.aliases = o.aliases ?? [];
    out.push({ tbl: 'shops', doc: o });
  }
  if (tbl === 'invoices' || tbl === 'creditNotes') {
    if (doc.companyId !== link.companyIdInDb) return [];
    const lines: Record<string, unknown>[] = [];
    for (const l of (doc.lines as Doc[]) ?? []) {
      const cp = await coProductOf(link, db, String(l.productId));
      if (!cp) continue; // a line of another brand never crosses, even on a bill marked for this company
      lines.push(tbl === 'invoices'
        ? { productId: cp.id, qty: l.qty, freeQty: l.freeQty ?? 0, rate: l.rate, taxable: l.taxable, total: l.total } // compact (no names): a big brand gets hundreds of thousands a day
        : { productId: cp.id, name: cp.name, qty: l.qty, amount: l.amount });
    }
    const value = (k: string) => Math.round(lines.reduce((a, x) => a + Number(x[k] ?? 0), 0) * 100) / 100;
    if (tbl === 'invoices') {
      let salesmanId: unknown;
      if (doc.orderId) { const o = await db.get('orders', String(doc.orderId)); salesmanId = o?.source === 'company' ? o.id : undefined; }
      out.push({ tbl: 'secondary', doc: { ...keep(doc), dbLinkId, number: doc.number, date: doc.date, shopId: doc.shopId, orderId: doc.orderId, fieldOrderId: salesmanId, lines, taxable: value('taxable'), total: value('total'), deliveryStatus: doc.deliveryStatus, cancelled: !!doc.cancelled } });
    } else out.push({ tbl: 'secondaryReturns', doc: { ...keep(doc), dbLinkId, invoiceId: doc.invoiceId, date: doc.date, reason: doc.reason, lines, total: value('amount') } });
  }
  if (tbl === 'batches' || tbl === 'products') {
    const pid = tbl === 'batches' ? String(doc.productId) : doc.id;
    const cp = await coProductOf(link, db, pid);
    if (!cp) return [];
    const soon = addDays(ctx.today, 60);
    let qty = 0, nearExpiry = 0, expired = 0;
    for (const b of await db.find('batches', 'productId', pid)) {
      const q = Number(b.qty ?? 0); const exp = String(b.expiry ?? '9999');
      if (exp < ctx.today) expired += q; else { qty += q; if (exp <= soon) nearExpiry += q; }
    }
    out.push({ tbl: 'dbStock', doc: { id: `${dbLinkId}:${cp.id}`, dbLinkId, productId: cp.id, name: cp.name, qty, nearExpiry, expired, asOf: ctx.today } });
  }
  if (tbl === 'claims') {
    if (doc.companyId !== link.companyIdInDb || doc.status === 'draft') return [];
    const lines: Record<string, unknown>[] = [];
    for (const e of await db.find('claimEntries', 'companyId', link.companyIdInDb)) {
      if (e.month !== doc.month || (doc.lineIds && !(doc.lineIds as string[]).includes(e.id))) continue;
      let productId: unknown;
      if (e.productId) { const cp = await coProductOf(link, db, String(e.productId)); if (!cp) continue; productId = cp.id; }
      lines.push({ id: e.id, kind: e.kind, productId, qty: e.qty, amount: e.amount, note: e.note, invoiceId: e.invoiceId, refNumber: e.refNumber, irn: e.irn, photo: e.photo });
    }
    out.push({ tbl: 'dbClaims', doc: { ...keep(doc), dbLinkId, month: doc.month, kind: doc.kind, amount: doc.amount, status: doc.status, note: doc.note, lines } });
  }
  // a rep's order cancelled by the distributor: the rep sees "cancelled by distributor" and why (nothing else crosses)
  if (tbl === 'orders' && doc.source === 'company' && doc.status === 'cancelled') {
    const mine = await _co.get('orders', doc.id);
    if (!mine || mine.dbLinkId !== dbLinkId || mine.status === 'cancelled') return [];
    const why = [...((doc.issues as string[]) ?? [])].reverse().find(x => /^Cancelled/.test(String(x)));
    const reason = why ? String(why).replace(/^Cancelled( by [a-z]+)?:?\s*/i, '') : '';
    out.push({ tbl: 'orders', doc: { ...mine, status: 'cancelled', cancelledBy: 'distributor', cancelReason: reason || 'No reason given' } });
  }
  if (tbl === 'primaryOrders') {
    if (doc.companyId !== link.companyIdInDb) return [];
    const lines: Record<string, unknown>[] = [];
    for (const l of (doc.lines as Doc[]) ?? []) { const cp = await coProductOf(link, db, String(l.productId)); if (cp) lines.push({ productId: cp.id, name: cp.name, qty: l.qty }); }
    out.push({ tbl: 'primaryOrders', doc: { ...keep(doc), dbLinkId, date: doc.date, lines, status: doc.status, note: doc.note } });
  }
  if (tbl === 'receipts') {
    if (doc.companyId !== link.companyIdInDb) return [];
    const bill = await db.get('inbound', String(doc.inboundId ?? doc.id));
    out.push({ tbl: 'grns', doc: { id: doc.id, createdAt: doc.createdAt, updatedAt: doc.updatedAt, dbLinkId, primaryInvoiceId: String(doc.inboundId ?? doc.id), number: bill?.number ?? doc.number, status: doc.status, receivedAt: doc.receivedAt, short: doc.short ?? [], damaged: doc.damaged ?? [] } });
  }
  // two distributors never share a company-side record (a clash of ids would show one distributor's data as another's)
  const safe: Write[] = [];
  for (const w of out) { const cur = await _co.get(w.tbl, w.doc.id); if (cur && cur.dbLinkId && cur.dbLinkId !== dbLinkId) continue; safe.push(w); }
  return safe;
}

// everything that crosses when a distributor first accepts (history: last 90 days of bills)
export const LINK_TABLES = {
  fromCompany: ['products', 'schemes', 'primaryInvoices'],
  fromDb: ['shops', 'products', 'invoices', 'creditNotes', 'claims', 'primaryOrders', 'receipts'], // (orders cross only when cancelled: not in the first exchange)
} as const;
const HISTORY_TABLES = new Set(['invoices', 'creditNotes']);

/** The first exchange after a distributor accepts: company catalogue and schemes go down, outlets, stock and 90 days of
 *  the company's own bills come up. Writes to the distributor side are applied as they are made, so a scheme finds the
 *  product that was linked just before it. */
export async function linkInitial(
  link: Link, db: Store & { all(tbl: string): Promise<Doc[]> }, co: Store & { all(tbl: string): Promise<Doc[]> },
  apply: (side: 'db' | 'company', w: Write[]) => Promise<void>, ctx: Ctx,
) {
  // table by table, written in one go per table (a scheme finds the product linked just before it); safe to run again
  for (const tbl of LINK_TABLES.fromCompany) {
    const out: Write[] = [];
    for (const d of await co.all(tbl)) out.push(...await companyToDb(link, tbl, d, db, co, ctx));
    if (out.length) await apply('db', out);
  }
  const since = addDays(ctx.today, -90);
  for (const tbl of LINK_TABLES.fromDb) {
    const out: Write[] = [];
    for (const d of await db.all(tbl)) {
      if (HISTORY_TABLES.has(tbl) && String(d.date ?? '') < since) continue;
      out.push(...await dbToCompany(link, tbl, d, db, co, ctx));
    }
    if (out.length) await apply('company', out);
  }
}

function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
