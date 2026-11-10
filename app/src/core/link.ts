// Company ⇄ distributor link on the phone. With a server, the server does everything (and holds the privacy wall).
// In the demo (no server) both sides live on this phone, and the SAME relay rules (shared/relay.ts) move data between
// the two local stores after every save — so the demo behaves exactly like the real thing.
import { companyToDb, dbToCompany, linkInitial, type Doc, type Link, type Store, type Write } from '../../../shared/relay';
import { DB_NAME, RoxDB, db, nowIso, onCommit, today } from './db';
import { server } from './sync';
import type { Company, DbLink, TableName } from './types';

const stores: Partial<Record<'distributor' | 'company', RoxDB>> = {};
/** the store of one side (the current side is the app's own db) */
export function storeOf(side: 'distributor' | 'company'): RoxDB {
  if (db.name === DB_NAME[side]) return db;
  return (stores[side] ??= new RoxDB(DB_NAME[side]));
}
const sideOf = (s: RoxDB): 'distributor' | 'company' => (s.name === DB_NAME.company ? 'company' : 'distributor');

export function dexieStore(s: RoxDB): Store & { all(tbl: string): Promise<Doc[]> } {
  return {
    async get(tbl, id) { return (await s.table(tbl).get(id)) as Doc | undefined; },
    async find(tbl, field, value) {
      const t = s.table(tbl);
      const indexed = t.schema.indexes.some(i => i.name === field);
      return (indexed ? await t.where(field).equals(value as string).toArray() : (await t.toArray()).filter(d => d[field] === value)) as Doc[];
    },
    async all(tbl) { return (await s.table(tbl).toArray()) as Doc[]; },
  };
}
async function applyTo(s: RoxDB, w: Write) {
  const n = nowIso();
  await s.table(w.tbl).put({ ...w.doc, tenantId: s.name === DB_NAME.company ? 'demo-company' : 'demo', createdAt: w.doc.createdAt ?? n, updatedAt: n, dirty: 0 });
}

/** demo links: the company's linked dbLinks, each tied to the distributor's company record that carries its id */
async function demoLinks(): Promise<Link[]> {
  const co = storeOf('company'), dist = storeOf('distributor');
  const out: Link[] = [];
  for (const l of await co.dbLinks.toArray()) {
    if (l.status !== 'linked') continue;
    const c = (await dist.companies.toArray()).find(x => x.link?.linkId === l.id && x.link.status === 'linked');
    if (c) out.push({ id: l.id, companyTenant: 'demo-company', dbTenant: 'demo', companyIdInDb: c.id, status: 'linked' });
  }
  return out;
}

let wired = false;
/** demo only: relay every save to the other side (the server does this when there is one) */
export async function wireDemoRelay() {
  if (wired || await server()) return;
  wired = true;
  onCommit(async (store, writes) => {
    if (!writes.length) return;
    const side = sideOf(store);
    const links = await demoLinks();
    if (!links.length) return;
    const co = dexieStore(storeOf('company')), dist = dexieStore(storeOf('distributor'));
    const ctx = { today: today() };
    for (const link of links) {
      for (const w of writes) {
        const doc = await (side === 'company' ? co : dist).get(w.table, w.id);
        if (!doc) continue;
        const out = side === 'company' ? await companyToDb(link, w.table, doc, dist, co, ctx) : await dbToCompany(link, w.table, doc, dist, co, ctx);
        for (const x of out) await applyTo(storeOf(side === 'company' ? 'distributor' : 'company'), x);
      }
    }
  });
}

const authed = async (path: string, body: unknown) => {
  const url = await server();
  const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('dbrox.token') ?? ''}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'Could not reach the server. Try again with internet.');
  return j;
};

/** distributor: who is this code from? */
export async function previewInvite(code: string): Promise<{ company: string }> {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,8}$/.test(c)) throw new Error('The code has 6 letters and numbers. Check it with the company.');
  if (await server()) return authed('/v1/link/preview', { code: c });
  const l = (await storeOf('company').dbLinks.where('inviteCode').equals(c).toArray()).find(x => x.status === 'invited');
  const s = await storeOf('company').settings.toCollection().first();
  if (!l || !s) throw new Error('This code is not valid or was already used. Ask the company for a new one.');
  return { company: s.firmName };
}

/** distributor accepts: the same steps as the server (tie the company record, first exchange) */
export async function acceptInvite(code: string, companyIdInDb?: string): Promise<{ company: string }> {
  const c = code.trim().toUpperCase();
  if (await server()) return authed('/v1/link/accept', { code: c, companyIdInDb });
  const coS = storeOf('company'), dist = storeOf('distributor');
  const inv = (await coS.dbLinks.where('inviteCode').equals(c).toArray()).find(x => x.status === 'invited');
  const firm = (await coS.settings.toCollection().first())?.firmName ?? 'Company';
  if (!inv) throw new Error('This code is not valid or was already used. Ask the company for a new one.');
  const n = nowIso();
  let company: Company | undefined = companyIdInDb ? await dist.companies.get(companyIdInDb) : undefined;
  if (company?.link?.status === 'linked') throw new Error('That company is already linked to another account.');
  company = { ...(company ?? { id: `co-${inv.id}`, tenantId: 'demo', createdAt: n, name: firm.replace(/\s*\(Demo\)$/, ''), code: firm.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), nextBillNo: 1 }), updatedAt: n, link: { companyTenant: 'demo-company', linkId: inv.id, since: n, status: 'linked' } } as Company;
  await dist.companies.put({ ...company, dirty: 0 });
  const distFirm = (await dist.settings.toCollection().first())?.firmName ?? inv.name;
  await coS.dbLinks.put({ ...inv, status: 'linked', dbTenantId: 'demo', linkedAt: n, name: inv.name || distFirm, updatedAt: n, dirty: 0 });
  const link: Link = { id: inv.id, companyTenant: 'demo-company', dbTenant: 'demo', companyIdInDb: company.id, status: 'linked' };
  await linkInitial(link, dexieStore(dist), dexieStore(coS), async (side, w) => applyTo(side === 'db' ? dist : coS, w), { today: today() });
  return { company: firm };
}

/** distributor leaves: nothing new crosses from now on */
export async function leaveLink(linkId: string) {
  if (await server()) return authed('/v1/link/leave', { linkId });
  const coS = storeOf('company'), dist = storeOf('distributor'); const n = nowIso();
  const l = await coS.dbLinks.get(linkId); if (l) await coS.dbLinks.put({ ...l, status: 'left', updatedAt: n } as DbLink);
  for (const c of await dist.companies.toArray()) if (c.link?.linkId === linkId) await dist.companies.put({ ...c, link: { ...c.link, status: 'left' }, updatedAt: n });
  return { ok: true };
}

/** what a linked company sees — shown to the distributor before accepting, and kept in More → Company links */
export const SHARED_WITH_COMPANY = [
  'Bills of this company\'s products only (shop name, date, items, value)',
  'Your stock of this company\'s products',
  'Claims you send to this company, and your orders to it',
  'Your shop list: shop name, town, beat and location (no phone numbers, owners, GSTIN or credit limits)',
];
export const NEVER_SHARED = 'Never shared: other companies\' products, bills or stock; payments, outstanding, credit limits; your accounts, staff and expenses.';

export type { TableName };
