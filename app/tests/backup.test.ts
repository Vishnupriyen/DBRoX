// The owner's "Download full backup" (security review of Part 1, 14 Nov 2026): the login token, PIN hashes and each
// person's private TESRAX chats and My files never go into the file. Every meta key on the phone is listed as backed up
// or kept out, so a new kind of key cannot slip into (or out of) the backup unnoticed.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import fs from 'fs'; import path from 'path';
import { db } from '../src/core/db';
import { backupDump, keepInBackup, META_BACKED_UP, META_EXCLUDED } from '../src/core/backup';

describe('full backup', () => {
  it('leaves out chat:, myfiles:, auth., pinv: and pinFails; keeps the rest', async () => {
    for (const k of ['chat:u2:2026-11-14', 'myfiles:u2', 'auth.token', 'pinv:t1|u2', 'pinFails', 'cursor', 'licence', 'consent:u2:privacy']) await db.meta.put({ key: k, value: 1 });
    const dump = await backupDump();
    expect((dump.meta as { key: string }[]).map(r => r.key).sort()).toEqual(['consent:u2:privacy', 'cursor', 'licence']);
    expect(JSON.stringify(dump)).not.toMatch(/chat:u2|myfiles:u2/);
  });
  it('every meta key the app writes is listed as backed up or excluded (and never both)', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
    walk(path.join(__dirname, '../src'));
    const found = new Set<string>();
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const re of [/meta\.(?:get|put|delete)\(\s*(?:\{\s*key:\s*)?['`]([A-Za-z]+)/g, /where\('key'\)\.startsWith\(['`]([A-Za-z]+)/g])
        for (const m of src.matchAll(re)) found.add(m[1]);
      // a key kept in a name (TOKEN_KEY, vKey(…), const key = `archive:…`) counts when that name is used for a meta key
      for (const m of src.matchAll(/\bconst\s+([A-Za-z_]*(?:Key|KEY)|key)\s*=\s*(?:\([^)]*\)\s*=>\s*)?['`]([A-Za-z]+)/g))
        if (new RegExp(`meta\\.(?:get|put|delete)\\(\\s*(?:\\{\\s*key:\\s*)?${m[1]}\\b|\\{\\s*key: ${m[1]}\\b|\\{ ${m[1]}, value`).test(src)) found.add(m[2]);
    }
    for (const k of ['chat', 'myfiles', 'auth', 'pinv', 'pinFails', 'mustPin', 'archive', 'consent', 'cursor', 'purgedOn']) expect(found.has(k), `scan finds ${k}`).toBe(true);
    const listed = new Set<string>([...META_BACKED_UP, ...META_EXCLUDED]);
    expect([...found].filter(k => !listed.has(k)).sort()).toEqual([]);
    expect(META_BACKED_UP.filter(k => (META_EXCLUDED as readonly string[]).includes(k))).toEqual([]);
    for (const k of META_EXCLUDED) expect(keepInBackup(`${k}.x`) && keepInBackup(`${k}:x`) && keepInBackup(k)).toBe(false);
    for (const k of META_BACKED_UP) expect(keepInBackup(`${k}:x`)).toBe(true);
  });
});
