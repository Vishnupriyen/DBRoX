import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { config } from './config.js';
import { hashPin, loginFailed, loginLocked, loginOk, readToken, signToken, verifyPin, type Claims } from './auth.js';
import { scanWithAI, type ScanKind } from './scan.js';

// ONE shared table definition for phone and server (shared/tables.json): a table cannot exist on one side only.
import { readFileSync } from 'node:fs';
const sharedPath = [new URL('../../shared/tables.json', import.meta.url), new URL('../shared/tables.json', import.meta.url)].find(u => { try { readFileSync(u); return true; } catch { return false; } })!;
const SHARED = JSON.parse(readFileSync(sharedPath, 'utf8')) as { tables: string[]; read: Record<string, string[] | '*'>; write: Record<string, string[] | '*'>; ownerOnlyFields: Record<string, string[]> };
const ALL_TABLES = SHARED.tables;
const expand = (m: Record<string, string[] | '*'>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === '*' ? ALL_TABLES : v])) as Record<string, string[]>;
const READ = expand(SHARED.read);
const WRITE = expand(SHARED.write);
const OWNER_ONLY = SHARED.ownerOnlyFields;
// Money records are never overwritten by an older copy; newest wins for everything (last-writer-wins on updatedAt).

const newId = () => randomBytes(12).toString('base64url');
const err = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export async function buildApp(pool: pg.Pool) {
  const app = Fastify({ logger: process.env.NODE_ENV === 'production', bodyLimit: 12 * 1024 * 1024 });
  await app.register(cors, { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') });

  const auth = async (req: FastifyRequest): Promise<Claims> => {
    const c = readToken(req.headers.authorization);
    if (!c) throw err(401, 'Please log in');
    const u = (await pool.query('SELECT active, token_epoch, role FROM users WHERE tenant_id=$1 AND id=$2', [c.t, c.u])).rows[0];
    if (!u || !u.active || u.token_epoch !== c.e) throw err(403, 'Access removed');
    const t = (await pool.query('SELECT status FROM tenants WHERE id=$1', [c.t])).rows[0];
    if (t?.status === 'locked') throw err(402, 'Account locked — please renew the plan');
    return { ...c, r: u.role };
  };

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, service: 'dbrox', time: new Date().toISOString() };
  });

  // New distributor: firm + owner. Owner logs in with phone + PIN (Google sign-in can be added later).
  app.post('/v1/signup', async req => {
    const b = req.body as { firmName?: string; ownerName?: string; phone?: string; pin?: string; gstin?: string; address?: string };
    if (!b.firmName || !b.ownerName || !/^[6-9]\d{9}$/.test(b.phone ?? '') || !/^\d{4}$/.test(b.pin ?? '')) throw err(400, 'Firm, owner name, 10-digit mobile and 4-digit PIN needed');
    const exists = await pool.query('SELECT 1 FROM users WHERE phone=$1', [b.phone]);
    if (exists.rowCount) throw err(409, 'This phone number already has a DBRoX login');
    const tenantId = newId();
    const userId = newId();
    const now = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenants(id, name, status, trial_ends) VALUES ($1,$2,'trial', current_date + 60)`, [tenantId, b.firmName]);
      await client.query('INSERT INTO users(tenant_id,id,phone,name,role,pin_hash) VALUES ($1,$2,$3,$4,$5,$6)', [tenantId, userId, b.phone, b.ownerName, 'owner', hashPin(b.pin!)]);
      const settings = {
        id: newId(), tenantId, createdAt: now, updatedAt: now, firmName: b.firmName, gstin: b.gstin ?? '', address: b.address ?? '', stateCode: (b.gstin ?? '33').slice(0, 2), phone: b.phone,
        modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true },
        billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5,
      };
      const staff = { id: userId, tenantId, createdAt: now, updatedAt: now, name: b.ownerName, phone: b.phone, role: 'owner', pin: '', active: true };
      await client.query('INSERT INTO docs(tenant_id,tbl,id,data,updated_at) VALUES ($1,$2,$3,$4,$5),($1,$6,$7,$8,$5)', [tenantId, 'settings', settings.id, settings, now, 'staff', userId, staff]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    return { tenantId, userId, token: signToken({ t: tenantId, u: userId, r: 'owner', e: 0 }) };
  });

  app.post('/v1/login', async (req, reply) => {
    const b = req.body as { phone?: string; pin?: string };
    if (!b.phone || !b.pin) throw err(400, 'Phone and PIN needed');
    if (loginLocked(b.phone)) throw err(429, 'Too many wrong PINs. Try again in 15 minutes.');
    const bt = (req.body as { tenantId?: string }).tenantId;
    const all = (await pool.query('SELECT u.tenant_id, u.id, u.role, u.pin_hash, u.active, u.token_epoch, t.name AS firm FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.phone=$1 AND u.active', [b.phone])).rows;
    const ok = all.filter(u => verifyPin(b.pin!, u.pin_hash) && (!bt || u.tenant_id === bt));
    if (!ok.length) { loginFailed(b.phone); reply.code(401); return { error: 'Wrong phone or PIN' }; }
    loginOk(b.phone);
    // the same phone under two distributors: the app shows "Which firm?" and sends tenantId
    if (ok.length > 1) return { choose: ok.map(u => ({ tenantId: u.tenant_id, firm: u.firm })) };
    const u = ok[0];
    return { tenantId: u.tenant_id, userId: u.id, role: u.role, token: signToken({ t: u.tenant_id, u: u.id, r: u.role, e: u.token_epoch }) };
  });

  // Numbers are issued here, never on the phone: one running series per distributor, no duplicates across phones.
  app.post('/v1/number', async req => {
    const c = await auth(req);
    if (c.r !== 'owner' && c.r !== 'office') throw err(403, 'Only the owner or office can make bills');
    const b = req.body as { kind?: 'bill' | 'cn' | 'receipt'; count?: number };
    const kind = b.kind ?? 'bill'; const n = Math.min(Math.max(1, Number(b.count ?? 1)), 20);
    const col = kind === 'bill' ? 'next_bill_no' : kind === 'cn' ? 'next_cn_no' : 'next_receipt_no';
    const r = await pool.query(`UPDATE tenants SET ${col} = ${col} + $2 WHERE id=$1 RETURNING ${col} - $2 AS first, prefix`, [c.t, n]);
    if (!r.rows[0]) throw err(404, 'Distributor not found');
    return { first: Number(r.rows[0].first), count: n, prefix: r.rows[0].prefix ?? 'DBX' };
  });

  // Sync: push this phone's changes, pull everything newer than the phone's cursor.
  app.post('/v1/sync', async req => {
    const c = await auth(req);
    const b = req.body as { cursor?: number; changes?: { table: string; id: string; updatedAt: string; data: Record<string, unknown> }[] };
    const changes = (b.changes ?? []).slice(0, 2000);
    const canWrite = new Set(WRITE[c.r] ?? []);
    const accepted: string[] = [];
    const rejected: string[] = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // one writer per distributor at a time → versions commit in order, so no phone ever skips a change
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [c.t]);
      const tbls: string[] = [], ids: string[] = [], datas: string[] = [], ups: string[] = [];
      for (const ch of changes) {
        if (!canWrite.has(ch.table) || typeof ch.id !== 'string' || !ch.id || !ch.updatedAt || isNaN(Date.parse(ch.updatedAt))) { rejected.push(`${ch.table}|${ch.id}`); continue; }
        const data: Record<string, unknown> = { ...ch.data, tenantId: c.t, id: ch.id };
        if (ch.table === 'staff') {
          if (c.r !== 'owner') { rejected.push(`${ch.table}|${ch.id}`); continue; }
          await upsertStaffLogin(client, c.t, data);
          data.pin = ''; // never store PINs inside documents
        }
        tbls.push(ch.table); ids.push(ch.id); datas.push(JSON.stringify(data)); ups.push(ch.updatedAt);
        accepted.push(`${ch.table}|${ch.id}`); // older copies are accepted but ignored: newest already stored
      }
      if (ids.length) {
        // one statement for the whole batch (fast at scale); newest updatedAt wins
        await client.query(
          `INSERT INTO docs(tenant_id,tbl,id,data,updated_at)
           SELECT $1, t, i, d::jsonb, u::timestamptz FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS x(t, i, d, u)
           ON CONFLICT (tenant_id,tbl,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, version=nextval('docs_version_seq')
           WHERE docs.updated_at <= EXCLUDED.updated_at`,
          [c.t, tbls, ids, datas, ups]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

    const cursor = Number(b.cursor ?? 0);
    const rows = (await pool.query(
      `SELECT tbl, id, data, updated_at, version FROM docs WHERE tenant_id=$1 AND version > $2 AND tbl = ANY($3) ORDER BY version LIMIT $4`,
      [c.t, cursor, READ[c.r] ?? [], config.pullLimit])).rows;
    const maxVersion = rows.length ? Number(rows[rows.length - 1].version) : cursor;
    return {
      cursor: maxVersion,
      more: rows.length === config.pullLimit,
      accepted, rejected,
      // owner-only fields (purchase rate, UPI id …) never reach a staff phone
      changes: rows.map(r => { let d = r.data; if (c.r !== 'owner' && c.r !== 'office' && OWNER_ONLY[r.tbl]) { d = { ...d }; for (const f of OWNER_ONLY[r.tbl]) delete d[f]; } return { table: r.tbl, id: r.id, updatedAt: new Date(r.updated_at).toISOString(), data: d }; }),
    };
  });

  app.post('/v1/scan', async req => {
    const c = await auth(req);
    const b = req.body as { kind?: ScanKind; file?: string };
    if (!b.kind || !['purchase', 'expense', 'order'].includes(b.kind) || !b.file) throw err(400, 'kind and file needed');
    const month = new Date().toISOString().slice(0, 7);
    const plan = (await pool.query('SELECT plan FROM tenants WHERE id=$1', [c.t])).rows[0]?.plan ?? 'all';
    const used = (await pool.query(
      `INSERT INTO scan_usage(tenant_id, month, count) VALUES ($1,$2,1) ON CONFLICT (tenant_id, month) DO UPDATE SET count = scan_usage.count + 1 RETURNING count`, [c.t, month])).rows[0].count;
    if (used > (config.scanAllowance[plan] ?? 300)) throw err(402, 'Monthly photo-reading allowance used up. Send Excel/PDF files, or add a top-up.');
    return await scanWithAI(b.kind, b.file);
  });

  // Owner allows support to see data for 24 hours (Part 12, level 3).
  app.post('/v1/support-access', async req => {
    const c = await auth(req);
    if (c.r !== 'owner') throw err(403, 'Only the owner can allow support access');
    await pool.query(`INSERT INTO support_access(tenant_id, granted_by, expires_at) VALUES ($1,$2, now() + interval '24 hours')`, [c.t, c.u]);
    await pool.query('INSERT INTO access_log(tenant_id, actor, action) VALUES ($1,$2,$3)', [c.t, c.u, 'support access granted 24h']);
    return { ok: true };
  });

  app.setErrorHandler((e: Error & { statusCode?: number }, _req, reply) => {
    const code = e.statusCode ?? 500;
    if (code >= 500) app.log.error(e);
    reply.code(code).send({ error: code >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  });
  return app;
}

async function upsertStaffLogin(client: pg.PoolClient, tenantId: string, s: Record<string, unknown>) {
  const phone = String(s.phone ?? '');
  const role = String(s.role ?? '');
  if (!/^\d{10}$/.test(phone) || !['owner', 'office', 'salesman', 'godown', 'delivery'].includes(role)) return;
  const pin = String(s.pin ?? '');
  // the same phone may exist under another distributor (a salesman serving two DBs); each firm has its own login row
  const existing = (await client.query('SELECT tenant_id, id, active FROM users WHERE tenant_id=$1 AND phone=$2', [tenantId, phone])).rows[0];
  if (!existing) {
    if (!/^\d{4}$/.test(pin)) return;
    await client.query('INSERT INTO users(tenant_id,id,phone,name,role,pin_hash,active) VALUES ($1,$2,$3,$4,$5,$6,$7)', [tenantId, s.id, phone, s.name, role, hashPin(pin), s.active !== false]);
    return;
  }
  const deactivated = existing.active && s.active === false;
  await client.query(
    `UPDATE users SET name=$3, role=$4, active=$5, pin_hash = COALESCE($6, pin_hash), token_epoch = token_epoch + $7, updated_at=now() WHERE tenant_id=$1 AND id=$2`,
    [tenantId, existing.id, s.name, role, s.active !== false, /^\d{4}$/.test(pin) ? hashPin(pin) : null, deactivated ? 1 : 0]);
}
