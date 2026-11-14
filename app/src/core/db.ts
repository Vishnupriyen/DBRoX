import Dexie, { type Table } from 'dexie';
import { billLotsProblem } from './lots';
import { numberLines, pickedLines } from './lines';
import type {
  AuditEntry, BankLine, Batch, Claim, ClaimEntry, Company, CreditNote, Expense, Invoice,
  Order, Payment, Product, Purchase, Scheme, Settings, Shop, Staff, TableName, Van, Base, Visit, Target, Trip, DayClose, DayPlan, LiteEntry, CheckIn, LeaveRequest, Advance,
  Territory, DbLink, Secondary, SecondaryReturn, DbStock, PrimaryInvoice, Inbound, Grn, PrimaryOrder, DbClaim, ClaimDecision, ShopRequest, WorkDay, TravelClaim, Receipt, TesraxDay,
  OpeningDue, StaffRequest, StockMove, BoostRequest,
} from './types';

// Offline-first store on the phone (IndexedDB). The server is only for sync and backup.
class RoxDB extends Dexie {
  settings!: Table<Settings, string>;
  staff!: Table<Staff, string>;
  companies!: Table<Company, string>;
  products!: Table<Product, string>;
  shops!: Table<Shop, string>;
  batches!: Table<Batch, string>;
  schemes!: Table<Scheme, string>;
  orders!: Table<Order, string>;
  invoices!: Table<Invoice, string>;
  creditNotes!: Table<CreditNote, string>;
  payments!: Table<Payment, string>;
  purchases!: Table<Purchase, string>;
  expenses!: Table<Expense, string>;
  bankLines!: Table<BankLine, string>;
  claimEntries!: Table<ClaimEntry, string>;
  claims!: Table<Claim, string>;
  vans!: Table<Van, string>;
  visits!: Table<Visit, string>;
  targets!: Table<Target, string>;
  trips!: Table<Trip, string>;
  dayCloses!: Table<DayClose, string>;
  dayPlans!: Table<DayPlan, string>;
  liteEntries!: Table<LiteEntry, string>;
  checkIns!: Table<CheckIn, string>;
  leaves!: Table<LeaveRequest, string>;
  advances!: Table<Advance, string>;
  audit!: Table<AuditEntry, string>;
  territories!: Table<Territory, string>;
  dbLinks!: Table<DbLink, string>;
  secondary!: Table<Secondary, string>;
  secondaryReturns!: Table<SecondaryReturn, string>;
  dbStock!: Table<DbStock, string>;
  primaryInvoices!: Table<PrimaryInvoice, string>;
  inbound!: Table<Inbound, string>;
  grns!: Table<Grn, string>;
  primaryOrders!: Table<PrimaryOrder, string>;
  dbClaims!: Table<DbClaim, string>;
  claimDecisions!: Table<ClaimDecision, string>;
  shopRequests!: Table<ShopRequest, string>;
  workDays!: Table<WorkDay, string>;
  travelClaims!: Table<TravelClaim, string>;
  receipts!: Table<Receipt, string>;
  tesraxDays!: Table<TesraxDay, string>;
  openingDues!: Table<OpeningDue, string>;
  requests!: Table<StaffRequest, string>;
  stockMoves!: Table<StockMove, string>;
  boostRequests!: Table<BoostRequest, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'dbrox') {
    super(name);
    const common = 'id, tenantId, updatedAt, dirty';
    this.version(1).stores({
      settings: common,
      staff: `${common}, phone, role`,
      companies: common,
      products: `${common}, companyId, name`,
      shops: `${common}, name, beat`,
      batches: `${common}, productId, expiry`,
      schemes: `${common}, companyId`,
      orders: `${common}, shopId, date, status`,
      invoices: `${common}, shopId, companyId, date, deliveryStatus, number`,
      creditNotes: `${common}, invoiceId, shopId, date`,
      payments: `${common}, shopId, date, collectedBy`,
      purchases: `${common}, companyId, date`,
      expenses: `${common}, date`,
      bankLines: `${common}, date, status`,
      claimEntries: `${common}, companyId, month`,
      claims: `${common}, companyId, month`,
      vans: common,
      audit: `${common}, batchId, at`,
      meta: 'key',
    });
    this.version(2).stores({
      visits: `${common}, shopId, staffId, date`,
      targets: `${common}, companyId, month`,
    });
    this.version(3).stores({
      invoices: `${common}, shopId, companyId, date, deliveryStatus, number, tripId`,
      trips: `${common}, vanId, date, status`,
      dayCloses: `${common}, date`,
      dayPlans: `${common}, date`,
      liteEntries: `${common}, date, shopId, kind`,
    });
    this.version(4).stores({
      checkIns: `${common}, staffId, date`,
      leaves: `${common}, staffId, status`,
      advances: `${common}, staffId, status`,
    });
    // company module: the same app run by a brand's head office and team, linked to its distributors
    this.version(5).stores({
      products: `${common}, companyId, name, companyProductId`,
      territories: `${common}, parentId`,
      dbLinks: `${common}, status, inviteCode`,
      secondary: `${common}, dbLinkId, date, shopId`,
      secondaryReturns: `${common}, dbLinkId, date`,
      dbStock: `${common}, dbLinkId, productId`,
      primaryInvoices: `${common}, dbLinkId, date`,
      inbound: `${common}, companyId, status, date`,
      grns: `${common}, dbLinkId`,
      primaryOrders: `${common}, dbLinkId, companyId, status`,
      dbClaims: `${common}, dbLinkId, status`,
      claimDecisions: `${common}, claimId`,
      shopRequests: `${common}, dbLinkId`,
      workDays: `${common}, staffId, date`,
    });
    this.version(6).stores({ travelClaims: `${common}, staffId, month, status` });
    this.version(7).stores({ receipts: `${common}, companyId, status`, inbound: `${common}, companyId, date` });
    this.version(8).stores({ tesraxDays: `${common}, day, staffId` });
    this.version(9).stores({ openingDues: `${common}, shopId, date`, requests: `${common}, status, kind` });
    // stock travels as movements (round 5). A lot changed on this phone and not yet sent is sent once as a whole lot
    // (legacyQty: the server keeps the difference as a movement); every lot gets its opening movement on this phone.
    this.version(10).stores({ stockMoves: `${common}, batchId, at` }).upgrade(async tx => {
      const at = new Date().toISOString();
      await tx.table('batches').toCollection().modify((b: Batch) => { if (b.dirty === 1) b.legacyQty = true; });
      for (const b of await tx.table('batches').toArray() as Batch[]) if (b.qty) await tx.table('stockMoves').put({ id: `open:${b.id}`, tenantId: b.tenantId, createdAt: at, updatedAt: at, dirty: 0, batchId: b.id, productId: b.productId, delta: b.qty, reason: 'opening (moved to movements)', by: 'server', at });
    });
    this.version(11).stores({ boostRequests: `${common}, kind, status` }); // Business Boost requests (12 Nov 2026)
    // security standard (13 Nov 2026): history entries made before this version could hold a staff PIN — removed here.
    // Staff records' own plain PINs become salted hashes at the next start (core/secure.ts securePins: hashing can't run
    // inside an upgrade).
    this.version(12).stores({}).upgrade(async tx => {
      await tx.table('audit').toCollection().modify((a: { table?: string; before?: Record<string, unknown>; after?: Record<string, unknown> }) => {
        if (a.table !== 'staff') return;
        if (a.before && 'pin' in a.before) delete a.before.pin;
        if (a.after && 'pin' in a.after) delete a.after.pin;
      });
    });
  }
}
export { RoxDB };

// One phone runs one side: a distributor ('dbrox') or a company ('hanubix-company'). The demo can switch sides.
export const SIDE_KEY = 'hanubix.side';
export const sideNow = (): 'distributor' | 'company' => { try { return localStorage.getItem(SIDE_KEY) === 'company' ? 'company' : 'distributor'; } catch { return 'distributor'; } };
export const DB_NAME = { distributor: 'dbrox', company: 'hanubix-company' } as const;
export let db = new RoxDB(DB_NAME[sideNow()]);
/** run core code against the other side's store (demo seeding and the demo relay only): restores the current one after */
export async function onSide<T>(store: RoxDB, fn: () => Promise<T>): Promise<T> {
  const was = db; db = store;
  try { return await fn(); } finally { db = was; }
}
// after every save: the demo relay (company ⇄ distributor on one phone) listens here
type CommitHook = (store: RoxDB, writes: { table: TableName; id: string }[]) => Promise<void>;
const hooks: CommitHook[] = [];
export function onCommit(h: CommitHook) { hooks.push(h); }

// Time-ordered unique id made on the device (ULID-like). Sorts by creation time.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newId(): string {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) { time = ALPHA[t % 32] + time; t = Math.floor(t / 32); }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let r = '';
  for (let i = 0; i < 16; i++) r += ALPHA[rnd[i] % 32];
  return time + r;
}

export const nowIso = () => new Date().toISOString();
// Dates are always the phone's local (Indian) calendar date, never UTC: between 00:00 and 05:30 IST
// UTC is still on the previous day.
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** the local day of a saved timestamp (createdAt, at): never its UTC date, which is the previous day before 5:30 AM in India */
export const localDay = (iso: string) => ymd(new Date(iso));
/** the local day before "YYYY-MM-DD" (never through UTC: in India that is two days before) */
export const dayBefore = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return ymd(new Date(y, m - 1, d - 1)); };
export const today = () => ymd(new Date());
export const daysFrom = (n: number) => ymd(new Date(Date.now() + n * 86400000));
export const thisMonth = () => today().slice(0, 7);
/** last calendar day of a 'YYYY-MM' month */
export const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

let currentTenant = 'local';
let currentUser = 'owner';
export function setSession(tenantId: string, userId: string) { currentTenant = tenantId; currentUser = userId; }
export function session() { return { tenantId: currentTenant, userId: currentUser }; }

export function stamp<T extends object>(rec: T & Partial<Base>): T & Base {
  const n = nowIso();
  return {
    ...rec,
    id: rec.id ?? newId(),
    tenantId: rec.tenantId ?? currentTenant,
    createdAt: rec.createdAt ?? n,
    updatedAt: n,
    dirty: 1,
  } as T & Base;
}

// ---------------------------------------------------------------- the guards
// Every save in the app goes through ChangeSet.commit, so these rules hold everywhere, whatever screen or bug
// tries to break them. A broken rule throws GuardError and the whole save is rolled back.
export class GuardError extends Error { constructor(msg: string) { super(msg); this.name = 'GuardError'; } }
const fin = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
// every money field anywhere (top level, and inside lines / allocations / settlements): when present it must be a real number.
// NaN (a hidden buying rate on a staff phone, a blank box) or text never reaches the books.
const MONEY_KEYS = ['amount', 'total', 'taxable', 'tax', 'cgst', 'sgst', 'igst', 'roundOff', 'rate', 'mrp', 'purchaseRate', 'discount', 'gross',
  'advance', 'paid', 'credited', 'received', 'recovered', 'credit', 'debit', 'schemeSaving', 'budget', 'salary', 'batta', 'kmAmount', 'daAmount', 'expenses'];
const MONEY_REQUIRED: Partial<Record<TableName, string[]>> = {
  claimEntries: ['amount'], claims: ['amount'], purchases: ['total'], advances: ['amount'], creditNotes: ['total'], openingDues: ['amount'],
};
function badMoney(table: TableName, r: Record<string, unknown>): string | null {
  for (const k of MONEY_REQUIRED[table] ?? []) if (!fin(r[k])) return k;
  const check = (o: Record<string, unknown>) => { for (const k of MONEY_KEYS) if (k in o && o[k] !== undefined && o[k] !== null && !fin(o[k])) return k; return null; };
  const top = check(r); if (top) return top;
  for (const list of ['lines', 'allocations', 'settlements']) {
    const arr = r[list]; if (!Array.isArray(arr)) continue;
    for (const x of arr) if (x && typeof x === 'object') { const k = check(x as Record<string, unknown>); if (k) return `${list}.${k}`; }
  }
  return null;
}
// set by the licence: when the plan is locked (or the licence can't be renewed), new orders and bills are refused
let writeBlock: string | null = null;
export function setWriteBlock(msg: string | null) { writeBlock = msg; }
async function guard(writes: { table: TableName; rec: Base }[]) {
  if (writeBlock) for (const w of writes) {
    if ((w.table === 'orders' || w.table === 'invoices') && !(await db.table(w.table).get(w.rec.id))) throw new GuardError(writeBlock);
  }
  const last = new Map<string, { table: TableName; rec: Base }>();
  for (const w of writes) last.set(`${w.table}|${w.rec.id}`, w); // the final state of each record in this save
  for (const { table, rec } of last.values()) {
    const r = rec as unknown as Record<string, unknown>;
    if (table !== 'audit' && table !== 'settings' && table !== 'staff' && table !== 'invoices') {
      const bad = badMoney(table, r);
      if (bad) throw new GuardError(`Money amount "${bad}" is not a valid number (${table}). Nothing was saved.`);
    }
    if (table === 'settings' && r.billPrefix !== undefined && r.billPrefix !== null && !/^[A-Za-z0-9]{1,4}$/.test(String(r.billPrefix)))
      throw new GuardError('Bill number prefix: 1 to 4 letters or digits only (e.g. SMD).');
    if (table === 'purchases' && String(r.billNo ?? '').trim()) {
      const key = String(r.billNo).trim().toUpperCase();
      const same = (await db.purchases.where('companyId').equals(String(r.companyId)).toArray()).some(x => x.id !== rec.id && String(x.billNo ?? '').trim().toUpperCase() === key && !last.has(`purchases|${x.id}`))
        || [...last.values()].some(x => x.table === 'purchases' && x.rec.id !== rec.id && (x.rec as unknown as { companyId: string }).companyId === r.companyId && String((x.rec as unknown as { billNo: string }).billNo ?? '').trim().toUpperCase() === key);
      if (same) throw new GuardError(`Company bill ${String(r.billNo).trim()} of this company is already entered.`);
    }
    if (table === 'stockMoves') {
      if (!Number.isInteger(r.delta) || r.delta === 0 || typeof r.batchId !== 'string' || !r.batchId) throw new GuardError('A stock movement is a whole number of pieces for one lot.');
      if (await db.stockMoves.get(rec.id)) throw new GuardError('A stock movement is never changed: make a new one.');
    }
    if (table === 'batches') {
      if (!fin(r.qty) || !Number.isInteger(r.qty)) throw new GuardError(`Stock count must be a whole number (got ${String(r.qty)}).`);
      if ((r.qty as number) < 0) throw new GuardError('Not enough stock for this. Stock can never go below zero — check the stock position first.');
    }
    if (table === 'invoices') {
      for (const k of ['total', 'taxable', 'cgst', 'sgst', 'igst']) if (!fin(r[k])) throw new GuardError(`Bill amount "${k}" is not a valid number.`);
      if ((r.total as number) < 0) throw new GuardError('A bill total can never be negative.');
      if (!r.number) throw new GuardError('Every bill needs a number.');
      const same = await db.invoices.where('number').equals(r.number as string).toArray();
      if (same.some(x => x.id !== rec.id) || writes.some(x => x.table === 'invoices' && x.rec.id !== rec.id && (x.rec as unknown as { number: string }).number === r.number))
        throw new GuardError(`Bill number ${String(r.number)} is already used. A bill number can never repeat.`);
      const bad = badMoney('invoices', r); if (bad) throw new GuardError(`Bill amount "${bad}" is not a valid number.`);
      if (r.opening) throw new GuardError('An old due is not a bill: it is kept with the opening balances.');
      const prev = await db.invoices.get(rec.id);
      const lines = (r.lines as { qty: number; freeQty?: number; name?: string; batches: { qty: number }[] }[]) ?? [];
      for (const l of lines) if (!fin(l.qty) || l.qty < 0) throw new GuardError('A bill line has an invalid quantity.');
      // one rule for the stock lots of every bill line, new or edited (billing.ts billLotsProblem; the server holds it too)
      if (!r.cancelled) { const lot = billLotsProblem(lines, prev?.lines); if (lot) throw new GuardError(lot); }
    }
    if (table === 'openingDues') {
      if (!fin(r.amount) || (r.amount as number) <= 0) throw new GuardError('An old due must be more than ₹0.');
      if (!r.shopId) throw new GuardError('An old due needs its shop.');
    }
    if (table === 'creditNotes') {
      if (!fin(r.total) || (r.total as number) < 0) throw new GuardError('Credit note amount is not valid.');
      const dup = (await db.creditNotes.toArray()).some(x => x.id !== rec.id && x.number === r.number) || writes.some(x => x.table === 'creditNotes' && x.rec.id !== rec.id && (x.rec as unknown as { number: string }).number === r.number);
      if (dup) throw new GuardError(`Credit note number ${String(r.number)} is already used.`);
      // a bill's credit notes together never come to more than the bill charged
      const invId = String(r.invoiceId ?? '');
      const bill = (last.get(`invoices|${invId}`)?.rec as Invoice | undefined) ?? (invId ? await db.invoices.get(invId) : undefined);
      if (bill) {
        const saved = (await db.creditNotes.where('invoiceId').equals(invId).toArray()).filter(c => !last.has(`creditNotes|${c.id}`));
        const here = [...last.values()].filter(w => w.table === 'creditNotes' && (w.rec as unknown as CreditNote).invoiceId === invId).map(w => w.rec as unknown as CreditNote);
        const sum = Math.round([...saved, ...here].reduce((a, c) => a + c.total, 0) * 100) / 100;
        if (sum > bill.total + 0.01) throw new GuardError(`Credit notes on bill ${bill.number} would come to ₹${sum.toFixed(2)} — more than the ₹${bill.total.toFixed(2)} it charged.`);
      }
    }
    if (table === 'payments') {
      if (!fin(r.amount) || (r.amount as number) <= 0) throw new GuardError('Payment amount must be more than zero.');
      const alloc = ((r.allocations as { amount: number }[]) ?? []).reduce((a, x) => a + x.amount, 0);
      if (alloc - (r.amount as number) > 0.01) throw new GuardError('A payment cannot be split across bills for more than its amount.');
    }
    if (table === 'expenses' && (!fin(r.amount) || (r.amount as number) < 0)) throw new GuardError('Expense amount is not valid.');
    if (table === 'orders' && ((r.lines as { qty: number }[]) ?? []).some(l => !fin(l.qty) || l.qty < 0)) throw new GuardError('An order line has an invalid quantity.');
  }
}

// The history log keeps no photo copies (a delivery photo inside every before/after copy filled phones and the server).
// A photo is replaced by this mark; undo takes the photo back from the record itself.
export const PHOTO_KEPT = '(photo kept on the record)';
const isPhoto = (v: unknown) => typeof v === 'string' && v.startsWith('data:') && v.length > 512;
/** the history log never keeps a PIN (a staff record's first PIN waits only in the record itself until it is sent) */
export function noSecrets(table: string, rec: unknown): unknown {
  if (table !== 'staff' || !rec || typeof rec !== 'object' || !('pin' in rec)) return rec;
  const { pin: _pin, ...rest } = rec as Record<string, unknown>; void _pin;
  return rest;
}
export function withoutPhotos(v: unknown): unknown {
  if (isPhoto(v)) return PHOTO_KEPT;
  if (Array.isArray(v)) return v.map(withoutPhotos);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, withoutPhotos(x)]));
  return v;
}
/** a log copy with its photos taken back from the record as it is now */
function photosFrom(logged: unknown, now: unknown): unknown {
  if (logged === PHOTO_KEPT) return now;
  if (Array.isArray(logged)) return logged.map((x, i) => photosFrom(x, Array.isArray(now) ? now[i] : undefined));
  if (logged && typeof logged === 'object') {
    const n = (now && typeof now === 'object' ? now : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(logged as Record<string, unknown>).map(([k, x]) => [k, photosFrom(x, n[k])]));
  }
  return logged;
}

/** every order saved carries line numbers on its lines and picked rows (Part 2, 2a0); an old order gets them when next saved */
function withLineNumbers(o: Order): Order {
  if (!Array.isArray(o.lines)) return o;
  const lines = numberLines(o.lines);
  return { ...o, lines, ...(Array.isArray(o.picked) ? { picked: pickedLines({ lines, picked: o.picked }) } : {}) };
}

// A Change set = everything one ✓ approval writes. Written in one transaction with an
// audit entry per record, so the whole approval can be undone later.
export class ChangeSet {
  readonly batchId = newId();
  /** noAudit: a record, not an action (a location reading): no history entry, so nothing to undo and no bloat */
  private opts: { noAudit?: boolean };
  constructor(opts: { noAudit?: boolean } = {}) { this.opts = opts; }
  private writes: { table: TableName; rec: Base; action: string }[] = [];
  put<T extends Base = Base>(table: TableName, rec: object, action = 'save'): T {
    if (table === 'orders') rec = withLineNumbers(rec as Order);
    const s = stamp(rec as Partial<Base>) as unknown as T;
    this.writes.push({ table, rec: s, action });
    return s as T;
  }
  get size() { return this.writes.length; }
  async commit(label: string): Promise<string> {
    const tables = Array.from(new Set([...this.writes.map(w => w.table), ...(this.writes.some(w => w.table === 'batches') ? ['stockMoves' as TableName] : [])]));
    // the guard reads a credit note's bill (never more credited than charged): it must be in the same transaction
    const reads = tables.includes('creditNotes') && !tables.includes('invoices') ? [db.invoices] : [];
    const dexTables = [...tables.map(t => db.table(t)), ...reads, db.audit];
    let writes = this.writes;
    await db.transaction('rw', dexTables, async () => {
      writes = [...this.writes, ...await stockMovesFor(this.writes, label)];
      await guard(writes); // the laws: if any write breaks one, nothing at all is saved
      for (const w of writes) {
        const before = await db.table(w.table).get(w.rec.id);
        await db.table(w.table).put(w.rec);
        if (this.opts.noAudit) continue;
        await db.audit.put(stamp<AuditEntry>({
          at: nowIso(), by: currentUser, action: `${label}: ${w.action}`,
          table: w.table, recordId: w.rec.id, before: withoutPhotos(noSecrets(w.table, before)), after: withoutPhotos(noSecrets(w.table, w.rec)), batchId: this.batchId,
        } as AuditEntry));
      }
    });
    for (const h of hooks) await h(db, writes.map(w => ({ table: w.table, id: w.rec.id })));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dbrox:commit', { detail: { label, batchId: this.batchId, n: writes.length, quiet: !!this.opts.noAudit, tables: [...new Set(writes.map(w => w.table))], what: describeSave(label, writes) } }));
    return this.batchId;
  }
}

/**
 * STOCK MOVES AS MOVEMENTS: one movement for every lot whose qty this save changes (final qty − qty before), written in
 * the same save — so no path that changes stock (billing, edit, cancel, returns, delivery, stock in, opening stock,
 * count, damage, GRN, purchase, split) can forget one. The server adds these up; a lot's qty is never sent as a total.
 * A lot still marked legacyQty (changed before this app version, not yet sent) keeps the mark and goes once as a whole lot.
 */
async function stockMovesFor(writes: { table: TableName; rec: Base; action: string }[], label: string) {
  const lots = new Map<string, { rec: Batch; action: string }>();
  for (const w of writes) if (w.table === 'batches') lots.set(w.rec.id, { rec: w.rec as Batch, action: w.action });
  if (!lots.size) return [];
  const cause = writes.find(w => w.table !== 'batches' && w.table !== 'stockMoves' && w.table !== 'audit');
  const out: { table: TableName; rec: Base; action: string }[] = [];
  for (const [id, { rec, action }] of lots) {
    const was = await db.batches.get(id);
    if (was?.legacyQty) { rec.legacyQty = true; continue; }
    const delta = Number(rec.qty) - Number(was?.qty ?? 0);
    if (!delta || !Number.isFinite(delta)) continue; // a lot whose qty did not change (expiry, MRP); a bad qty is the guard's
    out.push({ table: 'stockMoves', action: 'stock movement', rec: stamp<StockMove>({
      batchId: id, productId: rec.productId, delta, reason: `${label}: ${action}`, src: cause ? `${cause.table}:${cause.rec.id}` : undefined, by: currentUser, at: nowIso(),
    } as StockMove) });
  }
  return out;
}

/** what a save was, for the Undo bubble: "Billed Annai Super Market ₹3,743" (the screen adds the shop names) */
export function describeSave(_label: string, writes: { table: string; rec: object }[]): { verb: string; shopIds: string[]; amount?: number; count: number } | null {
  const of = (t: string) => writes.filter(w => w.table === t).map(w => w.rec as Record<string, unknown>);
  const pick = (verb: string, recs: Record<string, unknown>[], money?: string) => {
    const shopIds = [...new Set(recs.map(r => String(r.shopId ?? '')).filter(Boolean))];
    const amount = money ? Math.round(recs.reduce((a, r) => a + (Number(r[money]) || 0), 0) * 100) / 100 : undefined;
    return { verb, shopIds, amount, count: recs.length };
  };
  const inv = of('invoices').filter(r => !r.cancelled);
  if (of('creditNotes').length) return pick('Credit note', of('creditNotes'), 'total');
  // only a new bill waits for the plan ("pending"); a bill being planned, sent out or delivered is not "Billed" again
  const fresh = (r: Record<string, unknown>) => !r.createdAt || !r.updatedAt || Date.parse(String(r.updatedAt)) - Date.parse(String(r.createdAt)) < 5000; // made in this save, not a trip ended or cancelled
  const made = inv.filter(r => r.deliveryStatus === 'pending' && !r.delivery && fresh(r));
  if (made.length) return pick('Billed', made, 'total');
  if (of('payments').length) return pick('Collected', of('payments'), 'amount');
  if (of('orders').length) return pick('Order', of('orders'));
  if (of('expenses').length) return pick('Expense', of('expenses'), 'amount');
  return null;
}

// Undo one approval: put every record back the way it was before (never a hard delete
// of history: the audit log keeps both versions).
const sameRecord = (a: unknown, b: unknown) => {
  if (!a || !b) return a === b;
  const strip = (r: unknown) => { const { dirty: _d, ...rest } = r as Record<string, unknown>; void _d; return JSON.stringify(rest); };
  return strip(a) === strip(b);
};
// Returns the number of records put back, 0 if it was already undone, -1 if it can't be undone safely because
// something later changed the same records (e.g. another bill took stock from the same batch), or -2 (UNDO_SYNCED) if
// the action has already reached the office: then it is cancelled the normal way, never undone on one phone only.
export const UNDO_SYNCED = -2;
export const UNDO_SYNCED_MSG = 'This has reached the office — cancel it instead.';
/** the words for an undo that could not be done */
export const undoRefusal = (n: number) => n === UNDO_SYNCED ? UNDO_SYNCED_MSG
  : "Can't undo this: something changed after it (for example a later bill used the same stock). Edit or cancel the bill instead.";
export async function undoBatch(batchId: string): Promise<number> {
  const entries = await db.audit.where('batchId').equals(batchId).toArray();
  if (!entries.length || entries.some(e => e.undone)) return 0;
  const tables = Array.from(new Set(entries.map(e => e.table)));
  // sent to the server already (the history entry, or a record as this action left it): other phones have it
  if (entries.some(e => e.dirty === 0)) return UNDO_SYNCED;
  for (const e of entries) {
    if (e.table === 'settings') continue; // the bill counter only moves forward; never re-issue a number
    // compare the record itself, not its save time: two saves in the same millisecond share a timestamp
    const cur = await db.table(e.table).get(e.recordId);
    if (sameRecord(withoutPhotos(cur), e.after) === false) return -1;
    if (cur && cur.dirty === 0) return UNDO_SYNCED;
  }
  await db.transaction('rw', [...tables.map(t => db.table(t)), db.audit], async () => {
    // the log itself is add-only on the server: "undone" is this phone's own mark (an unsent entry still goes as it is)
    for (const e of entries.slice().reverse()) {
      if (e.table === 'settings') { await db.audit.put({ ...e, undone: true }); continue; }
      if (e.before) await db.table(e.table).put({ ...(photosFrom(e.before, await db.table(e.table).get(e.recordId)) as object), updatedAt: nowIso(), dirty: 1 });
      else if (e.table === 'invoices') {
        // a numbered bill is never deleted: it stays, cancelled, with no stock on it (every used number shows as a bill
        // or a cancelled bill); its stock goes back with the lots' own history entries
        const inv = await db.invoices.get(e.recordId);
        if (inv) await db.invoices.put({ ...inv, lines: inv.lines.map(l => ({ ...l, batches: l.batches.map(b => ({ ...b, qty: 0 })) })), cancelled: { at: nowIso(), by: currentUser, reason: 'Undone' }, updatedAt: nowIso(), dirty: 1 });
      }
      else await db.table(e.table).delete(e.recordId);
      await db.audit.put({ ...e, undone: true });
    }
  });
  return entries.length;
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.toCollection().first();
  if (!s) throw new Error('Settings missing');
  return s;
}

// Shops that are not rejected or closed. Use this everywhere a person picks a shop.
export async function activeShops() { return (await db.shops.toArray()).filter(s => s.active !== false); }
