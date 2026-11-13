// DPDP Act 2023 (security standard, 13 Nov 2026): consent records, a person's own-data export, erasure, retention.
// Hanubix is the data fiduciary for logins (owners, staff) and billing; the distributor is the fiduciary for its shops'
// data and Hanubix its processor. Tax records (bills, credit notes, payments) are kept for the legal period (GST law,
// 8 years): erasure removes the person's contact details from them but keeps the tax-relevant lines.
import type pg from 'pg';
import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';

const path = [new URL('../../shared/privacy.json', import.meta.url), new URL('../shared/privacy.json', import.meta.url)].find(u => { try { readFileSync(u); return true; } catch { return false; } })!;
const P = JSON.parse(readFileSync(path, 'utf8')) as { version: string; optional: string[] };
export const PRIVACY_VERSION = P.version;
export const CONSENT_KINDS = ['privacy', ...P.optional];
export const DUE_DAYS = 30;          // the law's outer limit we promise; our own target is 15
export const grievance = () => ({
  officer: process.env.GRIEVANCE_OFFICER || 'R. Vishnupriyen',
  email: process.env.GRIEVANCE_EMAIL || '',          // set in deploy/.env (never invented)
  phone: process.env.GRIEVANCE_PHONE || '',
});

export async function addConsent(db: pg.Pool | pg.PoolClient, tenant: string, user: string, kind: string, granted: boolean, ip: string | null, version = PRIVACY_VERSION) {
  await db.query('INSERT INTO consents(tenant_id, user_id, kind, version, granted, ip) VALUES ($1,$2,$3,$4,$5,$6)', [tenant, user, kind, version, granted, ip]);
}
/** the latest answer per kind for one person */
export async function consentsOf(pool: pg.Pool, tenant: string, user: string) {
  const rows = (await pool.query(`SELECT DISTINCT ON (kind) kind, version, granted, at FROM consents WHERE tenant_id=$1 AND user_id=$2 ORDER BY kind, at DESC, id DESC`, [tenant, user])).rows;
  return Object.fromEntries(rows.map(r => [r.kind, { granted: r.granted as boolean, version: r.version as string, at: new Date(r.at).toISOString() }])) as Record<string, { granted: boolean; version: string; at: string }>;
}
/** has the firm's owner (or head office) turned on a firm-wide option (AI photo reading)? */
export async function firmConsent(pool: pg.Pool, tenant: string, kind: string): Promise<boolean> {
  const r = (await pool.query(`SELECT c.granted FROM consents c JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.user_id
    WHERE c.tenant_id=$1 AND c.kind=$2 AND u.role IN ('owner','cadmin') ORDER BY c.at DESC, c.id DESC LIMIT 1`, [tenant, kind])).rows[0];
  return !!r?.granted;
}

/** tables whose records belong to one staff member (and the field that says whose) */
export const PERSON_TABLES: Record<string, string> = { checkIns: 'staffId', advances: 'staffId', leaves: 'staffId', expenses: 'staffId',
  workDays: 'staffId', travelClaims: 'staffId', tesraxDays: 'staffId', visits: 'staffId' };

/** "export my data": this person's own records only (their login, consents, staff record, attendance, advances…) */
export async function exportPerson(pool: pg.Pool, tenant: string, user: string) {
  const login = (await pool.query('SELECT id, name, role, active, last_login FROM users WHERE tenant_id=$1 AND id=$2', [tenant, user])).rows[0] ?? null;
  const staff = (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl='staff' AND id=$2`, [tenant, user])).rows[0]?.data ?? null;
  if (staff) delete staff.pin;
  const records: Record<string, unknown[]> = {};
  for (const [tbl, f] of Object.entries(PERSON_TABLES)) {
    const rows = (await pool.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND data->>$3 = $4 ORDER BY updated_at`, [tenant, tbl, f, user])).rows.map(r => r.data);
    if (rows.length) records[tbl] = rows;
  }
  const payments = (await pool.query(`SELECT data->>'id' id, data->>'date' date, data->>'amount' amount, data->>'mode' mode FROM docs WHERE tenant_id=$1 AND tbl='payments' AND data->>'collectedBy'=$2`, [tenant, user])).rows;
  if (payments.length) records.collectionsTaken = payments;
  const nominee = (await pool.query('SELECT name, contact, at FROM nominees WHERE tenant_id=$1 AND user_id=$2', [tenant, user])).rows[0] ?? null;
  return { madeAt: new Date().toISOString(), login, staffRecord: staff, consents: await consentsOf(pool, tenant, user), nominee, records };
}

// ---------------------------------------------------------------- erasure
const ERASED = 'Erased';
const scrubShop = (d: Record<string, unknown>) => {
  const out = { ...d, name: ERASED, aliases: [] as string[] };
  for (const k of ['owner', 'phone', 'address', 'lat', 'lng', 'photo', 'whatsapp', 'email', 'upiId']) delete (out as Record<string, unknown>)[k];
  return out; // GSTIN, state, credit terms stay: they are on the tax invoices and the firm's books
};
const scrubPersonRecord = (d: Record<string, unknown>) => {
  const out = { ...d } as Record<string, unknown>;
  for (const k of ['lat', 'lng', 'acc', 'photo', 'selfie', 'place', 'address', 'points', 'route']) delete out[k];
  if (typeof out.reason === 'string') out.reason = ERASED; // a leave reason can hold health details
  return out;
};
const scrubBillForShop = (d: Record<string, unknown>) => {
  const out = { ...d } as Record<string, unknown>;
  const del = out.delivery as Record<string, unknown> | undefined;
  if (del && typeof del === 'object') { const c = { ...del }; delete c.shopPhoto; delete c.lat; delete c.lng; out.delivery = c; }
  return out; // bill number, lines, amounts, taxes and the signed-bill proof stay (GST law)
};

/**
 * Erase one person (a staff member: kind 'staff') or one shop (kind 'shop') of one firm: live records, the archive
 * bundles and the login row. Tax lines and numbers are kept. Under the firm's write lock, in one transaction; the changed
 * records get a new version so every phone receives the erased copy at its next sync.
 */
export async function eraseSubject(pool: pg.Pool, tenant: string, kind: 'staff' | 'shop', id: string) {
  const client = await pool.connect();
  const counts = { live: 0, archived: 0, login: 0 };
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenant]);
    const now = new Date().toISOString();
    const put = async (tbl: string, docId: string, data: unknown) => {
      await client.query(`UPDATE docs SET data=$4, updated_at=$5, version=nextval('docs_version_seq') WHERE tenant_id=$1 AND tbl=$2 AND id=$3`, [tenant, tbl, docId, JSON.stringify(data), now]);
      counts.live++;
    };
    const live: { tbl: string; field: string; fn: (d: Record<string, unknown>) => Record<string, unknown> }[] = [];
    if (kind === 'staff') {
      counts.login = (await client.query('DELETE FROM users WHERE tenant_id=$1 AND id=$2', [tenant, id])).rowCount ?? 0;
      await client.query('DELETE FROM nominees WHERE tenant_id=$1 AND user_id=$2', [tenant, id]);
      const s = (await client.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl='staff' AND id=$2`, [tenant, id])).rows[0]?.data;
      if (s) { const d = { ...s, name: ERASED, phone: '', active: false, pin: '', updatedAt: now }; for (const k of ['photo', 'hq', 'address']) delete d[k]; await put('staff', id, d); }
      for (const [tbl, field] of Object.entries(PERSON_TABLES)) live.push({ tbl, field, fn: scrubPersonRecord });
    } else {
      const s = (await client.query(`SELECT data FROM docs WHERE tenant_id=$1 AND tbl='shops' AND id=$2`, [tenant, id])).rows[0]?.data;
      if (s) await put('shops', id, { ...scrubShop(s), updatedAt: now });
      live.push({ tbl: 'invoices', field: 'shopId', fn: scrubBillForShop }, { tbl: 'visits', field: 'shopId', fn: scrubPersonRecord }, { tbl: 'orders', field: 'shopId', fn: scrubPersonRecord });
    }
    for (const l of live) {
      for (const r of (await client.query(`SELECT id, data FROM docs WHERE tenant_id=$1 AND tbl=$2 AND data->>$3 = $4`, [tenant, l.tbl, l.field, id])).rows) {
        const next = { ...l.fn(r.data), updatedAt: now };
        if (JSON.stringify(next) !== JSON.stringify({ ...r.data, updatedAt: now })) await put(l.tbl, r.id, next);
      }
      // the archive bundles of that table (gzip JSON lists): rewritten only where they hold this person's records
      for (const b of (await client.query(`SELECT month, part, data FROM docs_archive WHERE tenant_id=$1 AND tbl=$2 FOR UPDATE`, [tenant, l.tbl])).rows) {
        const list = JSON.parse(gunzipSync(b.data).toString()) as { id: string; updatedAt: string; data: Record<string, unknown> }[];
        let changed = 0;
        const next = list.map(x => { if (String(x.data?.[l.field] ?? '') !== id) return x; changed++; return { ...x, data: l.fn(x.data) }; });
        if (!changed) continue;
        const gz = gzipSync(Buffer.from(JSON.stringify(next)));
        await client.query('UPDATE docs_archive SET data=$5, bytes=$6 WHERE tenant_id=$1 AND tbl=$2 AND month=$3 AND part=$4', [tenant, l.tbl, b.month, b.part, gz, gz.length]);
        counts.archived += changed;
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return counts;
}

// ---------------------------------------------------------------- retention (monthly job)
/**
 * What is kept how long (docs/security/17-data-retention.md). Only small, non-business tables are purged here; bills,
 * payments, credit notes and the archive are never touched. A dry run counts without changing anything.
 */
export async function retention(pool: pg.Pool, dry = false) {
  const jobs: [string, string][] = [
    ['rate_hits', `FROM rate_hits WHERE since < now() - interval '30 days' AND (until IS NULL OR until < now())`],
    ['scan_daily', `FROM scan_daily WHERE day < current_date - 30`],
    ['relay_failed', `FROM relay_failed WHERE failed_at < now() - interval '30 days'`],
    ['receipt_claims', `FROM receipt_claims WHERE at < now() - interval '90 days'`],
    ['access_log', `FROM access_log WHERE at < now() - interval '12 months'`],
    ['payment_events', `FROM payment_events WHERE received_at < now() - interval '8 years'`],
    ['consents_of_erased', `FROM consents c WHERE at < now() - interval '8 years' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant_id=c.tenant_id AND u.id=c.user_id)`],
    ['privacy_requests_closed', `FROM privacy_requests WHERE status <> 'open' AND closed_at < now() - interval '3 years'`],
  ];
  const counts: Record<string, number> = {};
  for (const [name, from] of jobs) {
    counts[name] = dry ? Number((await pool.query(`SELECT count(*)::int n ${from}`)).rows[0].n) : ((await pool.query(`DELETE ${from}`)).rowCount ?? 0);
  }
  // free trials that never paid, 90 days after the trial ended: an erasure request is opened (the owner is told and the
  // control panel runs it after the notice period) — a whole firm is never deleted by a job on its own
  const stale = (await pool.query(`SELECT id FROM tenants t WHERE paid_until IS NULL AND trial_ends < current_date - 90
    AND NOT EXISTS (SELECT 1 FROM privacy_requests p WHERE p.tenant_id = t.id AND p.kind = 'trial_expired')`)).rows.map(r => String(r.id));
  if (!dry) for (const t of stale) await pool.query(`INSERT INTO privacy_requests(id, tenant_id, requester, kind, subject_kind, note, due)
    VALUES ($1, $2, 'retention', 'trial_expired', 'owner', 'Free trial ended over 90 days ago and was never paid: tell the owner, offer the export, then erase', current_date + 30)`, [`trial-${t}`, t]);
  counts.trial_expired_flagged = stale.length;
  return counts;
}
