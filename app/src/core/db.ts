import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry, BankLine, Batch, Claim, ClaimEntry, Company, CreditNote, Expense, Invoice,
  Order, Payment, Product, Purchase, Scheme, Settings, Shop, Staff, TableName, Van, Base, Visit, Target,
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
export const today = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

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
      for (const w of this.writes) {
        const before = await db.table(w.table).get(w.rec.id);
        await db.table(w.table).put(w.rec);
        await db.audit.put(stamp<AuditEntry>({
          at: nowIso(), by: currentUser, action: `${label}: ${w.action}`,
          table: w.table, recordId: w.rec.id, before, after: w.rec, batchId: this.batchId,
        } as AuditEntry));
      }
    });
    return this.batchId;
  }
}

// Undo one approval: put every record back the way it was before (never a hard delete
// of history: the audit log keeps both versions).
export async function undoBatch(batchId: string): Promise<number> {
  const entries = await db.audit.where('batchId').equals(batchId).toArray();
  if (!entries.length || entries.some(e => e.undone)) return 0;
  const tables = Array.from(new Set(entries.map(e => e.table)));
  await db.transaction('rw', [...tables.map(t => db.table(t)), db.audit], async () => {
    for (const e of entries.slice().reverse()) {
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
