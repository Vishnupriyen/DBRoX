// Company ⇄ distributor links on the server. The relay (src/gen/relay.ts, copied from shared/relay.ts) decides what
// may cross; this file only reads and writes the two tenants' documents and keeps the links table.
import type pg from 'pg';
import { companyToDb, dbToCompany, linkInitial, RELAY_ONLY, type Doc, type Link, type Store, type Write } from './gen/relay.js';
import { istToday } from './licence.js';

type Q = pg.Pool | pg.PoolClient;

export function storeFor(q: Q, tenant: string): Store & { all(tbl: string): Promise<Doc[]> } {
  return {
    async get(tbl, id) { return (await q.query('SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND id=$3', [tenant, tbl, id])).rows[0]?.data; },
    async find(tbl, field, value) {
      return (await q.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND data->>$3 = $4`, [tenant, tbl, field, String(value)])).rows.map(r => r.data);
    },
    async all(tbl) { return (await q.query('SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2', [tenant, tbl])).rows.map(r => r.data); },
  };
}

/** write relay output into a tenant, under that tenant's writer lock so its phones never skip a version */
export async function writeInto(pool: pg.Pool, tenant: string, writes: Write[]) {
  if (!writes.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant]);
    const now = new Date().toISOString();
    for (const w of writes) {
      const data = { ...w.doc, tenantId: tenant, updatedAt: now, createdAt: w.doc.createdAt ?? now };
      delete (data as Record<string, unknown>).dirty;
      await client.query(
        `INSERT INTO docs(tenant_id,tbl,id,data,updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id,tbl,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, version=nextval('docs_version_seq')`,
        [tenant, w.tbl, w.doc.id, data, now]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

const rowToLink = (r: { id: string; company_tenant: string; db_tenant: string; company_id_in_db: string; status: Link['status'] }): Link =>
  ({ id: r.id, companyTenant: r.company_tenant, dbTenant: r.db_tenant, companyIdInDb: r.company_id_in_db, status: r.status });

export async function tenantKind(pool: pg.Pool, tenant: string): Promise<'company' | 'distributor'> {
  return (await pool.query('SELECT kind FROM tenants WHERE id=$1', [tenant])).rows[0]?.kind === 'company' ? 'company' : 'distributor';
}

/** may a phone of this tenant write this table? (relay-only tables are written by the relay alone) */
export function relayOnly(kind: 'company' | 'distributor', tbl: string) { return (RELAY_ONLY[kind] as readonly string[]).includes(tbl); }

/** after a tenant's changes are saved: move what may cross to the other side of each of its links */
export async function relayChanges(pool: pg.Pool, tenant: string, kind: 'company' | 'distributor', changed: { table: string; id: string }[]) {
  if (!changed.length) return;
  // the company may pause a distributor from its own list
  if (kind === 'company') for (const ch of changed.filter(c => c.table === 'dbLinks')) {
    const d = await storeFor(pool, tenant).get('dbLinks', ch.id);
    if (d && (d.status === 'paused' || d.status === 'linked')) await pool.query(`UPDATE links SET status=$3, updated_at=now() WHERE id=$1 AND company_tenant=$2 AND status <> 'left'`, [ch.id, tenant, d.status]);
  }
  const links = (await pool.query(`SELECT * FROM links WHERE ${kind === 'company' ? 'company_tenant' : 'db_tenant'}=$1 AND status='linked'`, [tenant])).rows.map(rowToLink);
  const ctx = { today: istToday() };
  for (const link of links) {
    const db = storeFor(pool, link.dbTenant), co = storeFor(pool, link.companyTenant);
    const writes: Write[] = [];
    for (const ch of changed) {
      const doc = await (kind === 'company' ? co : db).get(ch.table, ch.id);
      if (!doc) continue;
      writes.push(...(kind === 'company' ? await companyToDb(link, ch.table, doc, db, co, ctx) : await dbToCompany(link, ch.table, doc, db, co, ctx)));
    }
    await writeInto(pool, kind === 'company' ? link.dbTenant : link.companyTenant, writes);
  }
}

const genCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };
export { genCode };

/** find an open invite by its code */
export async function findInvite(pool: pg.Pool, code: string) {
  const r = (await pool.query(`SELECT d.tenant_id, d.data, t.name FROM docs d JOIN tenants t ON t.id=d.tenant_id
    WHERE d.tbl='dbLinks' AND d.data->>'inviteCode'=$1 AND d.data->>'status'='invited' AND t.kind='company'`, [code.trim().toUpperCase()])).rows[0];
  return r ? { companyTenant: r.tenant_id as string, invite: r.data as Doc, companyName: r.name as string } : null;
}

/** the distributor accepts: tie (or create) its own company record, record the link, and run the first exchange */
export async function acceptInvite(pool: pg.Pool, dbTenant: string, code: string, companyIdInDb?: string) {
  const inv = await findInvite(pool, code);
  if (!inv) throw Object.assign(new Error('This code is not valid or was already used. Ask the company for a new one.'), { statusCode: 404 });
  const already = (await pool.query(`SELECT id FROM links WHERE company_tenant=$1 AND db_tenant=$2 AND status <> 'left'`, [inv.companyTenant, dbTenant])).rows[0];
  if (already) throw Object.assign(new Error(`You are already linked with ${inv.companyName}.`), { statusCode: 409 });
  const dbStore = storeFor(pool, dbTenant);
  const now = new Date().toISOString();
  let company = companyIdInDb ? await dbStore.get('companies', companyIdInDb) : undefined;
  if (companyIdInDb && !company) throw Object.assign(new Error('That company is not in your list.'), { statusCode: 400 });
  if (company && (company.link as { status?: string } | undefined)?.status === 'linked') throw Object.assign(new Error('That company is already linked to another account.'), { statusCode: 409 });
  const linkId = inv.invite.id;
  const linkInfo = { companyTenant: inv.companyTenant, linkId, since: now, status: 'linked' };
  if (!company) company = { id: `co-${linkId}`, name: inv.companyName, code: inv.companyName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'CO', nextBillNo: 1, createdAt: now };
  await writeInto(pool, dbTenant, [{ tbl: 'companies', doc: { ...company, link: linkInfo } }]);
  const firm = (await pool.query('SELECT name FROM tenants WHERE id=$1', [dbTenant])).rows[0]?.name as string;
  await pool.query(`INSERT INTO links(id, company_tenant, db_tenant, company_id_in_db, status) VALUES ($1,$2,$3,$4,'linked')
    ON CONFLICT (company_tenant, db_tenant) DO UPDATE SET id=EXCLUDED.id, company_id_in_db=EXCLUDED.company_id_in_db, status='linked', updated_at=now()`,
    [linkId, inv.companyTenant, dbTenant, company.id]);
  await writeInto(pool, inv.companyTenant, [{ tbl: 'dbLinks', doc: { ...inv.invite, status: 'linked', dbTenantId: dbTenant, linkedAt: now, name: inv.invite.name || firm } }]);
  const link: Link = { id: linkId, companyTenant: inv.companyTenant, dbTenant, companyIdInDb: company.id, status: 'linked' };
  const co = storeFor(pool, inv.companyTenant);
  await linkInitial(link, dbStore, co, async (side, w) => writeInto(pool, side === 'db' ? dbTenant : inv.companyTenant, [w]), { today: istToday() });
  return { linkId, company: inv.companyName, companyIdInDb: company.id };
}

/** the distributor leaves: nothing new crosses from this moment; the company keeps what it already had */
export async function leaveLink(pool: pg.Pool, dbTenant: string, linkId: string) {
  const r = (await pool.query(`UPDATE links SET status='left', updated_at=now() WHERE id=$1 AND db_tenant=$2 AND status <> 'left' RETURNING *`, [linkId, dbTenant])).rows[0];
  if (!r) throw Object.assign(new Error('No such link.'), { statusCode: 404 });
  const co = storeFor(pool, r.company_tenant), db = storeFor(pool, dbTenant);
  const inv = await co.get('dbLinks', linkId); if (inv) await writeInto(pool, r.company_tenant, [{ tbl: 'dbLinks', doc: { ...inv, status: 'left' } }]);
  const c = await db.get('companies', r.company_id_in_db); if (c) await writeInto(pool, dbTenant, [{ tbl: 'companies', doc: { ...c, link: { ...(c.link as object), status: 'left' } } }]);
  return { ok: true };
}
