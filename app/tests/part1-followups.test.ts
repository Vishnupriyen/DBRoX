// Part 1 follow-ups (tester's re-check of 250600b, 14 Nov 2026): approvals answered in place, owner-only files hidden
// when the role is unknown, file kinds tagged where the file is made, personal data cleared on every way out.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db, setSession } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { handle } from '../src/core/engine';
import { keepFile, myFiles, saveChatDay, forgetSession } from '../src/core/myfiles';
import type { Role } from '../src/core/types';

const ids: Partial<Record<Role, string>> = {};
beforeAll(async () => { await seedDemo(); for (const s of await db.staff.toArray()) ids[s.role] ??= s.id; });
beforeEach(() => setSession('demo', ids.owner!));
const as = (r: Role) => setSession('demo', ids[r]!);
const say = (t: string) => handle(t, [], {});

describe('1. "orders to approve" answers in place (owner/office), the screen opens by its own name', () => {
  for (const t of ['orders to approve', 'needs ok', '3 orders waiting for my ok', 'what needs ok', 'orders to aprove', 'approvals', 'pending approvals'])
    it(`"${t}" → Needs OK table + Open Orders received`, async () => {
      for (const r of ['owner', 'office'] as Role[]) {
        as(r); const x = await say(t);
        expect(x.go, `${r}: ${t}`).toBeUndefined(); expect(x.table?.name).toBe('Needs OK'); expect(x.link?.page).toBe('orders-received');
      }
    });
  it('the table lists the orders still to approve (new and needs OK)', async () => {
    const waiting = (await db.orders.toArray()).filter(o => o.status === 'new' || o.status === 'needs_ok').length;
    const x = await say('orders to approve');
    expect(x.table?.rows.length).toBe(waiting);
  });
  for (const t of ['orders received', 'open orders received']) it(`"${t}" still opens the screen`, async () => {
    expect((await say(t)).go).toBe('orders-received');
  });
  it('a salesman asking "orders to approve" gets the reply, not a refusal', async () => {
    as('salesman'); const x = await say('orders to approve');
    expect(x.refused).toBeFalsy(); expect(x.table?.name).toBe('Needs OK'); expect(x.link).toBeUndefined();
  });
  it('"loadsheet" is understood as load sheet', async () => {
    as('godown'); const x = await say('loadsheet');
    expect(x.table?.name).toBe('Load sheet'); expect(x.link?.page).toBe('load');
  });
});

describe('2–3. My files: owner-only kinds hidden when the role is unknown; kind tagged at the source', () => {
  const sheet = (name: string) => [{ name, header: ['A', 'B'], rows: [['x', 1]] }];
  beforeEach(async () => { await db.meta.clear(); setSession('demo', 'nobody-on-this-phone'); });
  it('no staff row on the phone: salary, P&L and cash flow files are hidden; other files show', async () => {
    await keepFile('Salary sheet', sheet('s')); await keepFile('Outstanding', sheet('o'));
    expect((await myFiles()).map(f => f.name)).toEqual(['Outstanding']);
  });
  it('a file tagged where it is made keeps its kind whatever its name', async () => {
    await keepFile('Hanubix-2026-11', sheet('x'), 'salary');
    await keepFile('Team-2026-11', sheet('y'), 'cashflow');
    const raw = (await db.meta.get('myfiles:nobody-on-this-phone'))!.value as { name: string; kind?: string }[];
    expect(raw.map(f => f.kind)).toEqual(['cashflow', 'salary']);
    expect(await myFiles()).toEqual([]);
  });
  it('the salary sheet, P&L file and staff list with salaries are tagged at the source', async () => {
    const fs = await import('fs');
    expect(fs.readFileSync('src/ui/Payroll.tsx', 'utf8')).toMatch(/downloadSheet\(`salary-\$\{month\}`, SALARY_HEADER, salaryCells\(rows\), true, 'salary'\)/);
    expect(fs.readFileSync('src/core/engine.ts', 'utf8')).toMatch(/downloadSheet\(`salary-\$\{month\}`, SALARY_HEADER, salaryCells\(rows\), true, 'salary'\)/);
    const { pnlFile } = await import('../src/core/screenFiles');
    setSession('demo', ids.owner!);
    expect((await pnlFile('month')).kind).toBe('pnl');
  });
});

describe('4. every way out of a session clears that person\'s chats and files (never the firm\'s unsent work)', () => {
  it('forgetSession clears the saved session and that person\'s chats/files only', async () => {
    const store = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
    await db.meta.clear();
    setSession('demo', 'u1'); await saveChatDay([{ from: 'me', text: 'a' }]); await keepFile('Sales', [{ name: 'S', header: ['a'], rows: [['1']] }]);
    setSession('demo', 'u2'); await saveChatDay([{ from: 'me', text: 'b' }]);
    store.set('dbrox.session', JSON.stringify({ tenantId: 'demo', userId: 'u1' }));
    const orders = await db.orders.count();
    await forgetSession();
    expect(store.has('dbrox.session')).toBe(false);
    expect((await db.meta.toArray()).map(r => r.key).filter(k => k.includes('u1'))).toEqual([]);
    expect((await db.meta.toArray()).some(r => r.key.startsWith('chat:u2:'))).toBe(true);
    expect(await db.orders.count()).toBe(orders);
  });
  it('App: the offline-too-long path and the access-removed/kicked paths use forgetSession', async () => {
    const app = (await import('fs')).readFileSync('src/App.tsx', 'utf8');
    expect(app).not.toMatch(/localStorage\.removeItem\('dbrox\.session'\); setLoginMsg/);
    expect(app).toMatch(/else if \(off\.mustLogin\) \{ await forgetSession\(\)/);
    expect(app).toMatch(/else if \(removed\) \{ await forgetSession\(\)/);
    expect(app).toMatch(/const kicked = \(\) => \{ void forgetSession\(\)/);
  });
});
