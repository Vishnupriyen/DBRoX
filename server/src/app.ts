import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { billingState, isUpgrade, istToday, makeLicence, PACKS, sealLicence, TIERS, type Billing } from './licence.js';
import type pg from 'pg';
import { config } from './config.js';
import { hashPin, readToken, signToken, verifyPin, type Claims } from './auth.js';
import { billAddsUp, cleanText, distributorRule, keepCreditLimit, keepOwnerOnly, numberIssued, weakPin } from './rules.js';
import { clearHits, hit, isLocked } from './limits.js';
import { scanWithAI, type ScanKind } from './scan.js';
import { BIG_TABLES, companyDocs, companyReport, scopeFor } from './reports.js';
import { relayIdle } from './link.js';
import { coverIdle } from './reports.js';
import { archiveAll, archiveMonth, archiveMonths, DB_ARCHIVE } from './archive.js';
import { acceptInvite, afterSave, companyRule, drainRelay, findInvite, keepCompanyFields, leaveLink, queueRelay, relayOnly, resyncLink, tenantKind } from './link.js';

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
/** owner-only fields (buying rates) are removed for everyone but the owner (owner decision, 11 Nov 2026: office too).
 *  A company's head office (cadmin) is that tenant's owner: its purchaseRate is its own price to distributors. */
const forRole = (role: string, tbl: string, d: Record<string, unknown>) => {
  if (role === 'owner' || role === 'cadmin' || !OWNER_ONLY[tbl]) return d;
  const out = { ...d }; for (const f of OWNER_ONLY[tbl]) delete out[f]; return out;
};
const DOC_MAX = 256 * 1024;          // one record (a photo inside it included); bigger is refused, that record only
const CLOCK_AHEAD_MS = 5 * 60000;    // a phone clock ahead by more than this would freeze a record: refused
const RENEW_DAYS = 7;                // a token with this many days or less left is renewed in the sync reply
const CODE = (e: unknown) => String((e as { code?: string }).code ?? (e as Error)?.name ?? 'error');

const newId = () => randomBytes(12).toString('base64url');
const err = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export async function buildApp(pool: pg.Pool) {
  // trustProxy 1: Cloud Run's front end adds the caller's address last; only that one is trusted (per-place limits)
  const app = Fastify({ logger: process.env.NODE_ENV === 'production', bodyLimit: 12 * 1024 * 1024, trustProxy: (_addr: string, hop: number) => hop < 1 });
  await app.register(cors, { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') });
  // keep the raw text of every JSON body: Razorpay's signature is over the exact bytes it sent
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    // text Postgres can't store (lone half of an emoji, \u0000) is cleaned here, so it never blocks a whole sync
    try { done(null, (body as string).length ? cleanText(JSON.parse(body as string)) : {}); } catch (e) { done(Object.assign(e as Error, { statusCode: 400 }), undefined); }
  });

  // ---------------------------------------------------------------- plans & licences
  const billingOf = async (tenantId: string): Promise<Billing & { name: string; pendingPack: string | null; pendingTier: string | null; sub: string | null } | null> => {
    const r = (await pool.query('SELECT name, tier, pack, trial_ends, paid_until, pending_pack, pending_tier, rzp_subscription_id FROM tenants WHERE id=$1', [tenantId])).rows[0];
    if (!r) return null;
    const d = (v: Date | string | null) => v ? (typeof v === 'string' ? v.slice(0, 10) : new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10)) : null;
    return { name: r.name, tier: r.tier, pack: r.pack, trialEnds: d(r.trial_ends), paidUntil: d(r.paid_until), pendingPack: r.pending_pack, pendingTier: r.pending_tier, sub: r.rzp_subscription_id };
  };
  const licenceFor = async (tenantId: string) => { const b = await billingOf(tenantId); return b ? sealLicence(makeLicence(tenantId, b, istToday())) : null; };
  const stateFor = async (tenantId: string) => { const b = await billingOf(tenantId); return b ? { ...billingState(b, istToday()), mods: new Set(PACKS[b.pack] ?? PACKS.complete) } : null; };
  const LOCKED_MSG = 'Hanubix is locked because the plan is not renewed. You can still collect money and download your data. Renew to take orders and make bills again.';

  const auth = async (req: FastifyRequest): Promise<Claims> => {
    const c = readToken(req.headers.authorization);
    if (!c) throw err(401, 'Please log in');
    const u = (await pool.query('SELECT active, token_epoch, role FROM users WHERE tenant_id=$1 AND id=$2', [c.t, c.u])).rows[0];
    if (!u || !u.active) throw err(403, 'Access removed'); // the phone wipes its data
    if (u.token_epoch !== c.e) throw err(401, 'Please log in again'); // PIN or phone changed: log in again, unsent work kept
    // a locked distributor can still log in, see everything, collect and export — only new orders/bills are refused
    return { ...c, r: u.role };
  };

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, service: 'dbrox', time: new Date().toISOString() };
  });

  // New distributor: firm + owner. Owner logs in with phone + PIN (Google sign-in can be added later).
  app.post('/v1/signup', async req => {
    const b = req.body as { firmName?: string; ownerName?: string; phone?: string; pin?: string; gstin?: string; address?: string; kind?: string };
    const kind = b.kind === 'company' ? 'company' : 'distributor';
    const ownerRole = kind === 'company' ? 'cadmin' : 'owner';
    // a free trial costs us (AI scans, storage): a few sign-ups per place per hour
    if (await hit(pool, `signup:${req.ip}`, SIGNUP_PER_HOUR + 1, 60, 60) || await isLocked(pool, [`signup:${req.ip}`])) throw err(429, 'Too many sign-ups from this connection. Try again in an hour.');
    if (!b.firmName || !b.ownerName || !/^[6-9]\d{9}$/.test(b.phone ?? '') || !/^\d{4}$/.test(b.pin ?? '')) throw err(400, 'Firm, owner name, 10-digit mobile and 4-digit PIN needed');
    if (weakPin(b.pin!)) throw err(400, 'This PIN is too easy to guess (like 1234, 1111 or a year). Choose another 4-digit PIN.');
    const exists = await pool.query('SELECT 1 FROM users WHERE phone=$1', [b.phone]);
    if (exists.rowCount) throw err(409, 'This phone number already has a DBRoX login');
    const tenantId = newId();
    const userId = newId();
    const now = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenants(id, name, status, trial_ends, kind) VALUES ($1,$2,'trial', current_date + 60, $3)`, [tenantId, b.firmName, kind]);
      await client.query('INSERT INTO users(tenant_id,id,phone,name,role,pin_hash) VALUES ($1,$2,$3,$4,$5,$6)', [tenantId, userId, b.phone, b.ownerName, ownerRole, hashPin(b.pin!)]);
      const settings = {
        id: newId(), tenantId, createdAt: now, updatedAt: now, firmName: b.firmName, gstin: b.gstin ?? '', address: b.address ?? '', stateCode: (b.gstin ?? '33').slice(0, 2), phone: b.phone,
        modules: { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true },
        billFormat: 'A5', returnApprovalLimit: 2000, discountAlertPct: 5, kind,
      };
      const staff = { id: userId, tenantId, createdAt: now, updatedAt: now, name: b.ownerName, phone: b.phone, role: ownerRole, pin: '', active: true };
      await client.query('INSERT INTO docs(tenant_id,tbl,id,data,updated_at) VALUES ($1,$2,$3,$4,$5),($1,$6,$7,$8,$5)', [tenantId, 'settings', settings.id, settings, now, 'staff', userId, staff]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    return { tenantId, userId, token: signToken({ t: tenantId, u: userId, r: ownerRole, e: 0 }), licence: await licenceFor(tenantId) };
  });

  app.post('/v1/login', async (req, reply) => {
    const b = req.body as { phone?: string; pin?: string };
    if (!b.phone || !b.pin) throw err(400, 'Phone and PIN needed');
    // wrong tries are counted in the database: per phone from one place (5 → 15 min), per phone from anywhere (10 → a
    // short 10 min, so nobody can lock someone else out for long), per place over all phones (20 → 30 min)
    const pair = `login:${b.phone}|${req.ip}`, onePhone = `login:${b.phone}`, place = `loginip:${req.ip}`;
    if (await isLocked(pool, [pair, onePhone, place])) throw err(429, 'Too many wrong PINs. Try again in a few minutes.');
    const bt = (req.body as { tenantId?: string }).tenantId;
    const all = (await pool.query('SELECT u.tenant_id, u.id, u.role, u.pin_hash, u.active, u.token_epoch, t.name AS firm FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.phone=$1 AND u.active', [b.phone])).rows;
    const ok = all.filter(u => verifyPin(b.pin!, u.pin_hash) && (!bt || u.tenant_id === bt));
    if (!ok.length) {
      await hit(pool, pair, 5, 15, 15); await hit(pool, onePhone, 10, 15, 10); await hit(pool, place, 20, 60, 30);
      reply.code(401); return { error: 'Wrong phone or PIN' };
    }
    await clearHits(pool, [pair, onePhone]);
    // the same phone under two distributors: the app shows "Which firm?" and sends tenantId
    if (ok.length > 1) return { choose: ok.map(u => ({ tenantId: u.tenant_id, firm: u.firm })) };
    const u = ok[0];
    return { tenantId: u.tenant_id, userId: u.id, role: u.role, token: signToken({ t: u.tenant_id, u: u.id, r: u.role, e: u.token_epoch }), licence: await licenceFor(u.tenant_id) };
  });

  // Numbers are issued here, never on the phone: one running series per distributor, no duplicates across phones.
  app.post('/v1/number', async req => {
    const c = await auth(req);
    const b = req.body as { kind?: 'bill' | 'cn' | 'receipt'; count?: number };
    const kind = b.kind ?? 'bill';
    // company head office: credit-note numbers for claim settlements only
    // credit notes: every role that can make one (returns at the door, in the shop, at the godown; head office claims)
    const cnRoles = ['owner', 'office', 'salesman', 'delivery', 'godown', 'cadmin'];
    if (!(c.r === 'owner' || c.r === 'office' || (kind === 'cn' && cnRoles.includes(c.r)))) throw err(403, 'Only the owner or office can make bills'); const n = Math.min(Math.max(1, Number(b.count ?? 1)), 20);
    const st = await stateFor(c.t);
    if (st?.status === 'locked' && kind === 'bill') throw err(402, LOCKED_MSG);
    if (st && kind === 'bill' && !st.mods.has('bill')) throw err(403, 'Billing is not in your plan.');
    const col = kind === 'bill' ? 'next_bill_no' : kind === 'cn' ? 'next_cn_no' : 'next_receipt_no';
    const r = await pool.query(`UPDATE tenants SET ${col} = ${col} + $2 WHERE id=$1 RETURNING ${col} - $2 AS first, prefix`, [c.t, n]);
    if (!r.rows[0]) throw err(404, 'Distributor not found');
    return { first: Number(r.rows[0].first), count: n, prefix: r.rows[0].prefix ?? 'DBX' };
  });

  // Sync: push this phone's changes, pull everything newer than the phone's cursor.
  app.post('/v1/sync', async req => {
    const c = await auth(req);
    const b = req.body as { cursor?: number; changes?: { table: string; id: string; updatedAt: string; data: Record<string, unknown> }[] };
    const changes = (Array.isArray(b.changes) ? b.changes : []).slice(0, 2000);
    const canWrite = new Set(WRITE[c.r] ?? []);
    const accepted: string[] = [];
    const rejected: string[] = [];
    let freshToken: string | null = null;
    // the server's own copy of every refused or ignored record goes back, so the phone corrects itself
    const current: { table: string; id: string; updatedAt: string; data: Record<string, unknown> }[] = [];
    // read before taking the lock: a lock holder that waits for a second pooled connection can freeze the server
    const st = changes.length ? await stateFor(c.t) : null;
    const kind = changes.length ? await tenantKind(pool, c.t) : 'distributor';
    // nothing to save ("anything new?"): no transaction and no lock, straight to the pull
    if (changes.length) {
    const written: { table: string; id: string }[] = [];
    let queued = false;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // one writer per distributor at a time → versions commit in order, so no phone ever skips a change
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [c.t]);
      // the stored copy of every record in this push (one query): rules compare against it
      const valid = changes.filter(ch => ch && typeof ch.table === 'string' && typeof ch.id === 'string' && ch.id.length > 0 && ch.id.length <= 300);
      const stored = new Map<string, { data: Record<string, unknown>; updated_at: Date }>();
      if (valid.length) for (const r of (await client.query(`SELECT tbl, id, data, updated_at FROM docs WHERE tenant_id=$1 AND (tbl, id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
        [c.t, valid.map(v => v.table), valid.map(v => v.id)])).rows) stored.set(`${r.tbl}|${r.id}`, { data: r.data, updated_at: r.updated_at });
      const blockNew = st?.status === 'locked' ? new Set(['orders', 'invoices']) : new Set<string>();
      const archived = new Set<string>();
      if (blockNew.size) {
        const want = valid.filter(ch => blockNew.has(ch.table) && !stored.has(`${ch.table}|${ch.id}`));
        if (want.length) for (const r of (await client.query(`SELECT tbl, id FROM docs_archive_ids WHERE tenant_id=$1 AND tbl = ANY($2) AND id = ANY($3)`,
          [c.t, [...blockNew], want.map(w => w.id)])).rows) archived.add(`${r.tbl}|${r.id}`); // an old bill in the archive is not new
      }
      // the newest copy of a record wins inside one push too (a record twice in one statement would fail the batch)
      const last = new Map<string, number>(); changes.forEach((ch, i) => { const k = `${ch?.table}|${ch?.id}`; const j = last.get(k); if (j === undefined || String(changes[j].updatedAt) <= String(ch.updatedAt)) last.set(k, i); });
      const now = Date.now();
      const rows: { table: string; id: string; data: string; up: string }[] = [];
      const refuse = (key: string) => { rejected.push(key); };
      // too big, or a clock running ahead: not about the rules, so the phone keeps its own copy (held, tried again later —
      // a clock a few minutes fast goes through once real time catches up) instead of being given the server's copy
      const keepTheirs = new Set<string>();
      for (const [i, ch] of changes.entries()) {
        const key = `${ch?.table}|${ch?.id}`;
        if (!ch || typeof ch.table !== 'string' || relayOnly(kind, ch.table)) { refuse(key); continue; } // only the relay writes these (privacy wall)
        if (!canWrite.has(ch.table) || typeof ch.id !== 'string' || !ch.id || ch.id.length > 300 || typeof ch.updatedAt !== 'string' || isNaN(Date.parse(ch.updatedAt))) { refuse(key); continue; }
        if (last.get(key) !== i) { accepted.push(key); continue; } // an older copy in the same push
        // a clock far ahead would make this copy win over every later fix
        if (Date.parse(ch.updatedAt) > now + CLOCK_AHEAD_MS) { refuse(key); keepTheirs.add(key); continue; }
        const ex = stored.get(key)?.data;
        let data: Record<string, unknown> = { ...(ch.data && typeof ch.data === 'object' ? ch.data : {}), tenantId: c.t, id: ch.id };
        if (Buffer.byteLength(JSON.stringify(data)) > DOC_MAX) { refuse(key); keepTheirs.add(key); continue; }
        // a locked plan takes no NEW orders or bills, except ones dated before the lock day (made offline in grace)
        if (blockNew.has(ch.table) && !ex && !archived.has(key) && !(typeof data.date === 'string' && st && data.date < st.lockOn)) { refuse(key); continue; }
        // TESRAX report counts are the proof behind its claims: a phone writes only its own signed-in user's days, one
        // record per phone (staffId|day|device), and the report adds the phones up
        if (ch.table === 'tesraxDays' && (data.staffId !== c.u || !ch.id.startsWith(`${c.u}|${String(data.day)}|`) || ch.id.length === `${c.u}|${String(data.day)}|`.length)) { refuse(key); continue; }
        // the history log is add-only, for everyone
        if (ch.table === 'audit' && ex) { refuse(key); continue; }
        // the server's own checks on company records and linked products (approvals and prices are never the phone's word)
        if (kind === 'company' && ['claimDecisions', 'travelClaims', 'expenses', 'leaves', 'workDays'].includes(ch.table)) {
          if (companyRule(c.r, c.u, ch.table, { ...data, updatedAt: ch.updatedAt } as never, ex as never, ch.updatedAt)) { refuse(key); continue; }
        }
        if (kind === 'distributor') {
          if (distributorRule(c.r, c.u, ch.table, data, ex)) { refuse(key); continue; }
          if (ch.table === 'invoices' && !billAddsUp(data)) { refuse(key); continue; }
          if (ch.table === 'products') data = keepCompanyFields(data as never, ex as never);
          if (ch.table === 'shops') data = keepCreditLimit(c.r, data, ex);
        }
        data = keepOwnerOnly(c.r, OWNER_ONLY[ch.table], data, ex);
        // bill and credit-note numbers: issued by this server, and each used by one record only, for ever
        if ((ch.table === 'invoices' || ch.table === 'creditNotes') && (!ex || ex.number !== data.number)) {
          const num = String(data.number ?? '');
          const mine = (await client.query('SELECT doc_id FROM doc_numbers WHERE tenant_id=$1 AND tbl=$2 AND number=$3', [c.t, ch.table, num])).rows[0];
          if (mine ? mine.doc_id !== ch.id : !(await numberIssued(client, c.t, ch.table, num))) { refuse(key); continue; }
          if (!mine) await client.query('INSERT INTO doc_numbers(tenant_id, tbl, number, doc_id) VALUES ($1,$2,$3,$4)', [c.t, ch.table, num, ch.id]);
        }
        if (ch.table === 'staff') {
          if (c.r !== 'owner' && c.r !== 'cadmin') { refuse(key); continue; }
          // a login problem (phone used by someone else, an easy PIN) refuses this record only, never the whole sync
          await client.query('SAVEPOINT staff');
          try {
            const r = await upsertStaffLogin(client, c.t, data, kind);
            if (!r.ok) { await client.query('ROLLBACK TO SAVEPOINT staff'); refuse(key); continue; }
            await client.query('RELEASE SAVEPOINT staff');
            if (ch.id === c.u && r.epoch !== undefined && r.epoch !== c.e) freshToken = signToken({ t: c.t, u: c.u, r: c.r, e: r.epoch }); // own PIN/phone changed
          } catch (e) { await client.query('ROLLBACK TO SAVEPOINT staff'); app.log.warn({ code: CODE(e) }, 'staff login'); refuse(key); continue; }
          data.pin = ''; // never store PINs inside documents
        }
        rows.push({ table: ch.table, id: ch.id, data: JSON.stringify(data), up: ch.updatedAt });
        accepted.push(key); // older copies are accepted but ignored: newest already stored (its copy goes back below)
      }
      if (rows.length) {
        // one statement for the whole batch (fast at scale); newest updatedAt wins
        const done = (await client.query(
          `INSERT INTO docs(tenant_id,tbl,id,data,updated_at)
           SELECT $1, t, i, d::jsonb, u::timestamptz FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS x(t, i, d, u)
           ON CONFLICT (tenant_id,tbl,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, version=nextval('docs_version_seq')
           WHERE docs.updated_at <= EXCLUDED.updated_at RETURNING tbl, id`,
          [c.t, rows.map(r => r.table), rows.map(r => r.id), rows.map(r => r.data), rows.map(r => r.up)])).rows;
        written.push(...done.map(r => ({ table: r.tbl as string, id: r.id as string })));
      }
      const wrote = new Set(written.map(w => `${w.table}|${w.id}`));
      // only copies this person may read anyway (a company manager or rep: their scope comes with the normal pull)
      const readable = new Set(kind === 'company' && c.r !== 'cadmin' ? [] : READ[c.r] ?? []);
      for (const k of new Set([...rejected, ...accepted.filter(a => !wrote.has(a))])) {
        const s0 = stored.get(k); if (!s0 || keepTheirs.has(k)) continue;
        const [table, ...rest] = k.split('|');
        if (!readable.has(table)) continue;
        current.push({ table, id: rest.join('|'), updatedAt: new Date(s0.updated_at).toISOString(), data: forRole(c.r, table, s0.data) });
      }
      // noted for the relay in the same transaction: a crash after the save can't lose them
      queued = await queueRelay(client, c.t, kind, written);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    // the other side of each company link gets what may cross (after the save, under its own lock)
    await afterSave(pool, c.t, kind, written, queued);
    }

    const cursor = Number(b.cursor ?? 0);
    // a brand's phones never download every distributor bill: head office gets reports from the server instead; a
    // manager or rep gets only their own distributors' records, and bills of the last 60 days
    const isCo = (kindCache.get(c.t) ?? (kindCache.set(c.t, await tenantKind(pool, c.t)), kindCache.get(c.t))) === 'company';
    const scope = isCo ? await scopeFor(pool, c.t, c.u) : null;
    const tables = (READ[c.r] ?? []).filter(t => !(isCo && c.r === 'cadmin' && BIG_TABLES.includes(t)));
    // a page is cut by size as well as rows (records with photos): the first row always comes, so it always moves on
    const rows = (await pool.query(
      // the history log is 80% of all data: phones get only its last 3 days (morning summary, undo); the full log stays here
      `SELECT tbl, id, data, updated_at, version, run, total FROM (
         SELECT *, sum(sz) OVER (ORDER BY version) AS run, sum(sz) OVER () AS total FROM (
           SELECT tbl, id, data, updated_at, version, pg_column_size(data) AS sz FROM docs WHERE tenant_id=$1 AND version > $2 AND tbl = ANY($3)
             AND (tbl <> 'audit' OR updated_at > now() - interval '3 days')
             AND ($5::text[] IS NULL OR tbl <> ALL($6) OR data->>'dbLinkId' = ANY($5))
             AND (NOT $7 OR tbl NOT IN ('secondary','secondaryReturns') OR data->>'date' >= $8)
             ORDER BY version LIMIT $4) a) b
       WHERE run - sz <= $9 ORDER BY version`,
      [c.t, cursor, tables, config.pullLimit, scope, BIG_TABLES, isCo, new Date(Date.now() + 5.5 * 3600e3 - 60 * 86400e3).toISOString().slice(0, 10), config.pullBytes])).rows;
    const maxVersion = rows.length ? Number(rows[rows.length - 1].version) : cursor;
    const cut = rows.length > 0 && Number(rows[rows.length - 1].run) < Number(rows[rows.length - 1].total);
    // a token running out within 7 days is renewed here (a phone in daily use never has to log in again)
    if (!freshToken && c.exp - Date.now() / 1000 <= RENEW_DAYS * 86400) freshToken = signToken({ t: c.t, u: c.u, r: c.r, e: c.e });
    return {
      cursor: maxVersion,
      licence: await licenceFor(c.t), // every sync renews the phone's licence
      more: rows.length === config.pullLimit || cut,
      accepted, rejected, current,
      ...(freshToken ? { token: freshToken } : {}),
      // owner-only fields (purchase rate) never reach anyone but the owner
      changes: rows.map(r => ({ table: r.tbl, id: r.id, updatedAt: new Date(r.updated_at).toISOString(), data: forRole(c.r, r.tbl, r.data) })),
    };
  });

  // a stopping server finishes the relay batch in hand first (nothing half-sent)
  app.addHook('onClose', async () => { await relayIdle(); await coverIdle(); });

  // ---------------------------------------------------------------- company reports (answered here, never by downloading every bill)
  const kindCache = new Map<string, 'company' | 'distributor'>();
  const companyUser = async (req: FastifyRequest) => {
    const c = await auth(req);
    if (!['cadmin', 'manager', 'rep'].includes(c.r)) throw err(403, 'Company team only');
    return { c, scope: await scopeFor(pool, c.t, c.u) };
  };
  app.post('/v1/company/report', async req => {
    const { c, scope } = await companyUser(req);
    const b = req.body as { kind?: string; [k: string]: unknown };
    return { data: await companyReport(pool, c.t, scope, String(b.kind ?? ''), b) };
  });
  app.post('/v1/company/docs', async req => {
    const { c, scope } = await companyUser(req);
    const b = req.body as { tbl?: string; ids?: string[]; dbLinkId?: string };
    return { docs: await companyDocs(pool, c.t, scope, String(b.tbl ?? ''), b) };
  });

  // ---------------------------------------------------------------- company links
  // a distributor types the company's invite code: first a preview (who, and exactly what they will see), then accept
  // invite codes can't be guessed: 10 wrong codes → 30 minutes' wait (per distributor)
  const codeFails = new Map<string, { n: number; until: number }>();
  const codeGuard = (t: string) => { const f = codeFails.get(t); if (f && f.until > Date.now()) throw err(429, 'Too many wrong codes. Try again in 30 minutes.'); };
  const codeWrong = (t: string) => { const f = codeFails.get(t) ?? { n: 0, until: 0 }; f.n++; if (f.n >= 10) { f.until = Date.now() + 30 * 60000; f.n = 0; } codeFails.set(t, f); };
  app.post('/v1/link/preview', async req => {
    const c = await auth(req);
    if (c.r !== 'owner' || (await tenantKind(pool, c.t)) !== 'distributor') throw err(403, 'Only the distributor owner can link a company');
    codeGuard(c.t);
    const inv = await findInvite(pool, String((req.body as { code?: string }).code ?? ''));
    if (!inv) { codeWrong(c.t); throw err(404, 'This code is not valid or was already used. Ask the company for a new one.'); }
    return { company: inv.companyName, companyTenant: inv.companyTenant };
  });
  app.post('/v1/link/resync', async req => {
    const c = await auth(req);
    const linkId = String((req.body as { linkId?: string }).linkId ?? '');
    const r = (await pool.query('SELECT company_tenant, db_tenant FROM links WHERE id=$1', [linkId])).rows[0];
    if (!r || !((r.db_tenant === c.t && c.r === 'owner') || (r.company_tenant === c.t && c.r === 'cadmin'))) throw err(403, 'Not your link');
    await resyncLink(pool, linkId);
    return { ok: true };
  });
  // a company bill is received on one phone only (the first to ask, online)
  app.post('/v1/receipt/claim', async req => {
    const c = await auth(req);
    if (!['owner', 'office', 'godown'].includes(c.r)) throw err(403, 'Not allowed');
    const id = String((req.body as { inboundId?: string }).inboundId ?? '');
    const r = await pool.query('INSERT INTO receipt_claims(tenant_id, inbound_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.t, id, c.u]);
    if (!r.rowCount) throw err(409, 'This bill is already being received on another phone.');
    return { ok: true };
  });
  app.post('/v1/link/accept', async req => {
    const c = await auth(req);
    if (c.r !== 'owner' || (await tenantKind(pool, c.t)) !== 'distributor') throw err(403, 'Only the distributor owner can link a company');
    const b = req.body as { code?: string; companyIdInDb?: string };
    codeGuard(c.t);
    const r = await acceptInvite(pool, c.t, String(b.code ?? ''), b.companyIdInDb || undefined).catch(e => { if ((e as { statusCode?: number }).statusCode === 404) codeWrong(c.t); throw e; });
    await pool.query('INSERT INTO access_log(tenant_id, actor, action) VALUES ($1,$2,$3)', [c.t, c.u, `linked company ${r.company}`]);
    return r;
  });
  app.post('/v1/link/leave', async req => {
    const c = await auth(req);
    if (c.r !== 'owner') throw err(403, 'Only the distributor owner can do this');
    const r = await leaveLink(pool, c.t, String((req.body as { linkId?: string }).linkId ?? ''));
    await pool.query('INSERT INTO access_log(tenant_id, actor, action) VALUES ($1,$2,$3)', [c.t, c.u, 'left company link']);
    return r;
  });

  app.post('/v1/scan', async req => {
    const c = await auth(req);
    const b = req.body as { kind?: ScanKind; file?: string };
    // photo reading costs money per read: the people who enter purchases, expenses and orders in the office only
    if (!['owner', 'office', 'godown'].includes(c.r)) throw err(403, 'Photo reading is for the owner, office and godown.');
    if (!b.kind || !['purchase', 'expense', 'order'].includes(b.kind) || !b.file) throw err(400, 'kind and file needed');
    const month = new Date().toISOString().slice(0, 7);
    const plan = (await pool.query('SELECT plan FROM tenants WHERE id=$1', [c.t])).rows[0]?.plan ?? 'all';
    const st = await stateFor(c.t);
    const allowance = st?.status === 'trial' ? config.scanTrial : (config.scanAllowance[plan] ?? 300); // a free trial gets a small allowance
    const used = (await pool.query(
      `INSERT INTO scan_usage(tenant_id, month, count) VALUES ($1,$2,1) ON CONFLICT (tenant_id, month) DO UPDATE SET count = scan_usage.count + 1 RETURNING count`, [c.t, month])).rows[0].count;
    if (used > allowance) throw err(402, 'Monthly photo-reading allowance used up. Send Excel/PDF files, or add a top-up.');
    // one cap for the whole service per day (our AI bill can never run away)
    const today = (await pool.query(`INSERT INTO scan_daily(day, count) VALUES (current_date, 1) ON CONFLICT (day) DO UPDATE SET count = scan_daily.count + 1 RETURNING count`)).rows[0].count;
    if (today > Number(process.env.SCAN_DAILY_CAP ?? 2000)) throw err(429, 'Photo reading is very busy today. Please try tomorrow, or send the Excel/PDF file.');
    return await scanWithAI(b.kind, b.file);
  });

  app.get('/v1/licence', async req => { const c = await auth(req); return { licence: await licenceFor(c.t) }; });

  // Owner sets up UPI Autopay: we create a Razorpay subscription and send back its payment page.
  app.post('/v1/billing/subscribe', async req => {
    const c = await auth(req);
    if (c.r !== 'owner') throw err(403, 'Only the owner can manage the plan');
    const b = await billingOf(c.t); if (!b) throw err(404, 'Distributor not found');
    const rz = config.razorpay;
    const planId = rz.plans[`${b.tier}:${b.pack}`];
    if (!rz.keyId || !rz.keySecret || !planId) throw err(503, 'Online payment is not set up yet. Please pay by bank transfer; support will mark it paid.');
    const r = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${rz.keyId}:${rz.keySecret}`).toString('base64') },
      body: JSON.stringify({ plan_id: planId, total_count: 120, customer_notify: 1, notes: { tenantId: c.t, firm: b.name } }),
    });
    const j = await r.json() as { id?: string; short_url?: string; error?: { description?: string } };
    if (!r.ok || !j.id) throw err(502, j.error?.description ?? 'Could not start the payment. Try again.');
    await pool.query('UPDATE tenants SET rzp_subscription_id=$2 WHERE id=$1', [c.t, j.id]);
    return { url: j.short_url };
  });

  // Razorpay tells us about every payment. Signature checked over the exact bytes; each event counted once.
  app.post('/v1/razorpay/webhook', async (req, reply) => {
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const sig = String(req.headers['x-razorpay-signature'] ?? '');
    const secret = config.razorpay.webhookSecret;
    const expect = secret ? createHmac('sha256', secret).update(raw).digest('hex') : '';
    if (!secret || sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) { reply.code(401); return { error: 'bad signature' }; }
    const body = req.body as { event?: string; payload?: { subscription?: { entity?: { id?: string; current_end?: number; notes?: { tenantId?: string } } }; payment?: { entity?: { id?: string } } } };
    const eventId = String(req.headers['x-razorpay-event-id'] ?? `${body.event}:${body.payload?.payment?.entity?.id ?? body.payload?.subscription?.entity?.id}:${body.payload?.subscription?.entity?.current_end ?? ''}`);
    const sub = body.payload?.subscription?.entity;
    let tenantId = sub?.notes?.tenantId ?? null;
    if (!tenantId && sub?.id) tenantId = (await pool.query('SELECT id FROM tenants WHERE rzp_subscription_id=$1', [sub.id])).rows[0]?.id ?? null;
    const fresh = await pool.query('INSERT INTO payment_events(id, tenant_id, event, body) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id', [eventId, tenantId, body.event ?? '', body]);
    if (!fresh.rowCount) return { ok: true, duplicate: true };
    if (!tenantId) return { ok: true, ignored: 'no distributor' };
    if ((body.event === 'subscription.charged' || body.event === 'subscription.activated') && sub?.current_end) {
      // paid up to the end of this billing period (Razorpay sends unix seconds); a waiting downgrade starts now
      const until = istToday(sub.current_end * 1000 - 1000);
      await pool.query(`UPDATE tenants SET paid_until = GREATEST(COALESCE(paid_until, $2::date), $2::date),
        pack = COALESCE(pending_pack, pack), tier = COALESCE(pending_tier, tier), pending_pack = NULL, pending_tier = NULL,
        rzp_subscription_id = COALESCE(rzp_subscription_id, $3) WHERE id=$1`, [tenantId, until, sub.id ?? null]);
    }
    // payment failed / halted / cancelled: nothing to do — the dates run out and grace → lock happens by itself
    return { ok: true };
  });

  /** Cloud Scheduler's key, compared in constant time */
  const cronOk = (req: FastifyRequest) => {
    const k = String(req.headers['x-cron-key'] ?? '');
    if (!config.cronKey) return false;
    return timingSafeEqual(createHash('sha256').update(k).digest(), createHash('sha256').update(config.cronKey).digest());
  };
  // ---------------------------------------------------------------- the Hanubix console (our side only)
  const admin = (req: FastifyRequest) => {
    const k = String(req.headers['x-admin-key'] ?? '');
    if (!config.adminKey || k.length !== config.adminKey.length || !timingSafeEqual(Buffer.from(k), Buffer.from(config.adminKey))) throw err(401, 'Admin key needed');
  };
  app.get('/v1/admin/tenants', async req => {
    admin(req);
    const rows = (await pool.query('SELECT id FROM tenants ORDER BY created_at DESC LIMIT 1000')).rows;
    const today = istToday();
    return { tenants: await Promise.all(rows.map(async r => { const b = (await billingOf(r.id))!; return { id: r.id, ...b, ...billingState(b, today) }; })) };
  });
  app.post('/v1/admin/tenants/:id/plan', async req => {
    admin(req);
    const id = (req.params as { id: string }).id;
    const { tier, pack } = req.body as { tier?: string; pack?: string };
    const b = await billingOf(id); if (!b) throw err(404, 'Distributor not found');
    if (pack && !PACKS[pack]) throw err(400, 'Unknown pack');
    if (tier && !TIERS.includes(tier)) throw err(400, 'Unknown tier');
    const packNow = pack && isUpgrade(b.pack, pack);
    const tierNow = tier && TIERS.indexOf(tier) > TIERS.indexOf(b.tier);
    // upgrades start now; downgrades wait for the end of the paid month
    await pool.query(`UPDATE tenants SET pack = CASE WHEN $2::boolean THEN $3 ELSE pack END, pending_pack = CASE WHEN $3::text IS NOT NULL AND NOT $2::boolean THEN $3 ELSE pending_pack END,
      tier = CASE WHEN $4::boolean THEN $5 ELSE tier END, pending_tier = CASE WHEN $5::text IS NOT NULL AND NOT $4::boolean THEN $5 ELSE pending_tier END WHERE id=$1`,
      [id, !!packNow, pack ?? null, !!tierNow, tier ?? null]);
    return { ok: true, startsNow: { pack: !!packNow, tier: !!tierNow }, billing: await billingOf(id) };
  });
  // a payment received outside Razorpay (bank transfer, cash): mark paid up to a date
  app.post('/v1/admin/tenants/:id/paid', async req => {
    admin(req);
    const id = (req.params as { id: string }).id;
    const { until } = req.body as { until?: string };
    if (!until || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw err(400, 'until must be YYYY-MM-DD');
    await pool.query('UPDATE tenants SET paid_until = GREATEST(COALESCE(paid_until, $2::date), $2::date), pack = COALESCE(pending_pack, pack), tier = COALESCE(pending_tier, tier), pending_pack = NULL, pending_tier = NULL WHERE id=$1', [id, until]);
    return { ok: true, billing: await billingOf(id) };
  });

  // Daily job (Cloud Scheduler, 00:05 IST): a downgrade starts once the paid month is over; status kept for reports.
  // safety net for the background relay (Cloud Scheduler, every minute): empties anything a stopped instance left behind
  app.post('/v1/cron/relay', async req => {
    if (!cronOk(req)) throw err(403, 'No');
    return { relayed: await drainRelay(pool) };
  });
  // every few minutes: head office's stock figures for every brand (changed products; everything once a day)
  app.post('/v1/cron/cover', async req => {
    if (!cronOk(req)) throw err(403, 'No');
    const { refreshAllCover } = await import('./reports.js');
    return { brands: await refreshAllCover(pool) };
  });

  // daily (Cloud Scheduler, 02:00 IST): old records move to the compressed archive (nothing is deleted)
  app.post('/v1/cron/archive', async req => {
    if (!cronOk(req)) throw err(403, 'No');
    return await archiveAll(pool);
  });

  // ---------------------------------------------------------------- the archive, for a new phone (old bills, so dues and
  // reports stay complete). Only the tables this role reads; owner-only fields removed as in the normal sync.
  const archiveTables = (role: string) => (READ[role] ?? []).filter(t => DB_ARCHIVE.includes(t) && t !== 'audit');
  app.post('/v1/archive/list', async req => {
    const c = await auth(req);
    return { months: await archiveMonths(pool, c.t, archiveTables(c.r)) };
  });
  app.post('/v1/archive/month', async req => {
    const c = await auth(req);
    const b = req.body as { tbl?: string; month?: string };
    const tbl = String(b.tbl ?? ''), month = String(b.month ?? '');
    if (!archiveTables(c.r).includes(tbl) || !/^\d{4}-\d{2}$/.test(month)) throw err(403, 'Not available');
    const rows = await archiveMonth(pool, c.t, tbl, month);
    return { changes: rows.map(r => ({ table: tbl, id: r.id, updatedAt: r.updatedAt, data: forRole(c.r, tbl, r.data) })) };
  });

  app.post('/v1/cron/daily', async req => {
    if (!cronOk(req)) throw err(401, 'Cron key needed');
    const today = istToday();
    await pool.query(`UPDATE tenants SET pack = COALESCE(pending_pack, pack), tier = COALESCE(pending_tier, tier), pending_pack = NULL, pending_tier = NULL
      WHERE (pending_pack IS NOT NULL OR pending_tier IS NOT NULL) AND COALESCE(paid_until, trial_ends) < $1::date`, [today]);
    const rows = (await pool.query('SELECT id FROM tenants')).rows;
    const reminders: { id: string; status: string; daysLeft: number }[] = [];
    for (const r of rows) {
      const b = (await billingOf(r.id))!; const s = billingState(b, today);
      await pool.query('UPDATE tenants SET status=$2 WHERE id=$1 AND status IS DISTINCT FROM $2', [r.id, s.status]);
      if ((s.status === 'trial' && s.daysLeft === 10) || s.status === 'grace') reminders.push({ id: r.id, status: s.status, daysLeft: s.daysLeft });
    }
    return { ok: true, tenants: rows.length, reminders };
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
    if (code >= 500) app.log.error({ code: CODE(e), url: _req.url }, 'server error'); // the code only: a full database error can carry customer data
    reply.code(code).send({ error: code >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : e.message });
  });
  return app;
}

const SIGNUP_PER_HOUR = 5;
const ROLES = { distributor: ['owner', 'office', 'salesman', 'godown', 'delivery'], company: ['cadmin', 'manager', 'rep'] };
/** the login row of a staff record, looked up by the staff id (never by phone): a phone change moves the login, a PIN or
 *  phone change logs the old phone out (token epoch +1). A clash or an easy new PIN refuses this record only. */
async function upsertStaffLogin(client: pg.PoolClient, tenantId: string, s: Record<string, unknown>, kind: 'company' | 'distributor'): Promise<{ ok: boolean; epoch?: number }> {
  const phone = String(s.phone ?? '');
  const role = String(s.role ?? '');
  if (!/^\d{10}$/.test(phone) || !ROLES[kind].includes(role)) return { ok: true }; // a company role never exists inside a distributor, nor the reverse
  const pin = String(s.pin ?? '');
  const id = String(s.id);
  // the same phone may exist under another distributor (a salesman serving two DBs); each firm has its own login row
  const byId = (await client.query('SELECT phone, active, pin_hash, token_epoch FROM users WHERE tenant_id=$1 AND id=$2', [tenantId, id])).rows[0];
  const byPhone = (await client.query('SELECT id, active FROM users WHERE tenant_id=$1 AND phone=$2 AND id <> $3', [tenantId, phone, id])).rows[0];
  if (byPhone) {
    if (byPhone.active) return { ok: false }; // two people of one firm can't share a login phone
    await client.query('DELETE FROM users WHERE tenant_id=$1 AND id=$2', [tenantId, byPhone.id]); // a removed person's old login: the phone is free again
  }
  if (!byId) {
    if (!/^\d{4}$/.test(pin)) return { ok: true };
    if (weakPin(pin)) return { ok: false };
    await client.query('INSERT INTO users(tenant_id,id,phone,name,role,pin_hash,active) VALUES ($1,$2,$3,$4,$5,$6,$7)', [tenantId, id, phone, s.name, role, hashPin(pin), s.active !== false]);
    return { ok: true, epoch: 0 };
  }
  // the same PIN sent again is not a change (existing easy PINs keep working until changed)
  const pinChanged = /^\d{4}$/.test(pin) && !verifyPin(pin, byId.pin_hash);
  if (pinChanged && weakPin(pin)) return { ok: false };
  const bump = pinChanged || byId.phone !== phone || (byId.active && s.active === false) ? 1 : 0;
  const r = await client.query(
    `UPDATE users SET phone=$3, name=$4, role=$5, active=$6, pin_hash = COALESCE($7, pin_hash), token_epoch = token_epoch + $8, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING token_epoch`,
    [tenantId, id, phone, s.name, role, s.active !== false, pinChanged ? hashPin(pin) : null, bump]);
  return { ok: true, epoch: Number(r.rows[0].token_epoch) };
}
