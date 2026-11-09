import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry, BankLine, Batch, Claim, ClaimEntry, Company, CreditNote, Expense, Invoice,
  Order, Payment, Product, Purchase, Scheme, Settings, Shop, Staff, TableName, Van, Base, Visit, Target, Trip, DayClose, DayPlan, LiteEntry, CheckIn, LeaveRequest, Advance,
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
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('dbrox');
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
  }
}

export const db = new RoxDB();

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
      const isNew = !(await db.invoices.get(rec.id));
      for (const l of (r.lines as { qty: number; freeQty?: number; name?: string; batches: { qty: number }[] }[]) ?? []) {
        if (!fin(l.qty) || l.qty < 0) throw new GuardError('A bill line has an invalid quantity.');
        if (l.batches.some(b => !fin(b.qty) || b.qty < 0)) throw new GuardError('A bill line has an invalid batch quantity.');
        // a new bill charges only for pieces taken out of stock lots (a shop is never billed for goods that weren't there)
        if (isNew && l.batches.reduce((a, b) => a + b.qty, 0) !== l.qty + (l.freeQty ?? 0)) throw new GuardError(`Not enough stock for ${l.name ?? 'an item'} on this bill. A bill can only charge for pieces that are in stock.`);
      }
    }
    if (table === 'creditNotes') {
      if (!fin(r.total) || (r.total as number) < 0) throw new GuardError('Credit note amount is not valid.');
      const dup = (await db.creditNotes.toArray()).some(x => x.id !== rec.id && x.number === r.number) || writes.some(x => x.table === 'creditNotes' && x.rec.id !== rec.id && (x.rec as unknown as { number: string }).number === r.number);
      if (dup) throw new GuardError(`Credit note number ${String(r.number)} is already used.`);
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

// A Change set = everything one ✓ approval writes. Written in one transaction with an
// audit entry per record, so the whole approval can be undone later.
export class ChangeSet {
  readonly batchId = newId();
  private writes: { table: TableName; rec: Base; action: string }[] = [];
  put<T extends Base = Base>(table: TableName, rec: object, action = 'save'): T {
    const s = stamp(rec as Partial<Base>) as unknown as T;
    this.writes.push({ table, rec: s, action });
    return s as T;
  }
  get size() { return this.writes.length; }
  async commit(label: string): Promise<string> {
    const tables = Array.from(new Set(this.writes.map(w => w.table)));
    const dexTables = [...tables.map(t => db.table(t)), db.audit];
    await db.transaction('rw', dexTables, async () => {
      await guard(this.writes); // the laws: if any write breaks one, nothing at all is saved
      for (const w of this.writes) {
        const before = await db.table(w.table).get(w.rec.id);
        await db.table(w.table).put(w.rec);
        await db.audit.put(stamp<AuditEntry>({
          at: nowIso(), by: currentUser, action: `${label}: ${w.action}`,
          table: w.table, recordId: w.rec.id, before, after: w.rec, batchId: this.batchId,
        } as AuditEntry));
      }
    });
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dbrox:commit', { detail: { label, batchId: this.batchId, n: this.writes.length } }));
    return this.batchId;
  }
}

// Undo one approval: put every record back the way it was before (never a hard delete
// of history: the audit log keeps both versions).
const sameRecord = (a: unknown, b: unknown) => {
  if (!a || !b) return a === b;
  const strip = (r: unknown) => { const { dirty: _d, ...rest } = r as Record<string, unknown>; void _d; return JSON.stringify(rest); };
  return strip(a) === strip(b);
};
// Returns the number of records put back, 0 if it was already undone, or -1 if it can't be undone safely because
// something later changed the same records (e.g. another bill took stock from the same batch).
export async function undoBatch(batchId: string): Promise<number> {
  const entries = await db.audit.where('batchId').equals(batchId).toArray();
  if (!entries.length || entries.some(e => e.undone)) return 0;
  const tables = Array.from(new Set(entries.map(e => e.table)));
  for (const e of entries) {
    if (e.table === 'settings') continue; // the bill counter only moves forward; never re-issue a number
    // compare the record itself, not its save time: two saves in the same millisecond share a timestamp
    const cur = await db.table(e.table).get(e.recordId);
    if (sameRecord(cur, e.after) === false) return -1;
  }
  await db.transaction('rw', [...tables.map(t => db.table(t)), db.audit], async () => {
    for (const e of entries.slice().reverse()) {
      if (e.table === 'settings') { await db.audit.put({ ...e, undone: true, updatedAt: nowIso(), dirty: 1 }); continue; }
      if (e.before) await db.table(e.table).put({ ...(e.before as object), updatedAt: nowIso(), dirty: 1 });
      else await db.table(e.table).delete(e.recordId);
      await db.audit.put({ ...e, undone: true, updatedAt: nowIso(), dirty: 1 });
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
