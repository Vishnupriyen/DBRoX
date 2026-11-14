// TESRAX memory (founder, 14 Nov 2026 — items 6 and 44): My files keeps everything asked; the chat stays when TESRAX is
// reopened, history by day for 30 days, each person sees only their own; Clear chat removes today's log, files stay.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, setSession, today, daysFrom } from '../src/core/db';
import { chatDay, chatDays, clearChatDay, keepFile, myFiles, saveChatDay, dropFile, MAX_FILES, purgePersonal, dailyPurge } from '../src/core/myfiles';

beforeEach(async () => { await db.meta.clear(); await db.staff.clear(); setSession('demo', 'owner1'); });
const sheet = (name: string, n = 2) => [{ name, header: ['Shop', 'Amount'], rows: Array.from({ length: n }, (_, i) => [`Shop ${i}`, 100 + i]) }];

describe('My files', () => {
  it('keeps every file, newest first; the same file made twice within a minute is kept once', async () => {
    await keepFile('Outstanding', sheet('Outstanding'));
    await keepFile('Outstanding', sheet('Outstanding'));
    await keepFile('Sales', sheet('Sales'));
    expect((await myFiles()).map(f => f.name)).toEqual(['Sales', 'Outstanding']);
  });
  it('an empty table is not kept', async () => {
    await keepFile('Nothing', sheet('Nothing', 0));
    expect(await myFiles()).toEqual([]);
  });
  it('each person sees only their own files', async () => {
    await db.staff.put({ id: 'owner1', name: 'owner1', role: 'owner', active: true, phone: '9000000001' } as never); // the owner's P&L needs a known owner (unknown role hides it)
    await keepFile('Owner P&L', sheet('P&L'));
    setSession('demo', 'driver1');
    expect(await myFiles()).toEqual([]);
    await keepFile('My trip', sheet('Trip'));
    setSession('demo', 'owner1');
    expect((await myFiles()).map(f => f.name)).toEqual(['Owner P&L']);
  });
  it('delete removes one file; the list never grows past the cap', async () => {
    for (let i = 0; i < MAX_FILES + 5; i++) await keepFile(`Report ${i}`, sheet(`R${i}`));
    const all = await myFiles();
    expect(all.length).toBe(MAX_FILES);
    expect(all[0].name).toBe(`Report ${MAX_FILES + 4}`);
    await dropFile(all[0].id);
    expect((await myFiles()).length).toBe(MAX_FILES - 1);
  });
});

describe('TESRAX chat history', () => {
  it("today's conversation is read back when TESRAX opens again", async () => {
    await saveChatDay([{ from: 'me', text: 'outstanding' }, { from: 'bot', text: 'Here it is.', table: { name: 'Outstanding', columns: ['Shop'], rows: [['Murugan']] } }]);
    const back = await chatDay();
    expect(back.map(l => l.text)).toEqual(['outstanding', 'Here it is.']);
    expect(back[1].table?.rows).toEqual([['Murugan']]);
  });
  it('history by day keeps 30 days; older days are deleted', async () => {
    await saveChatDay([{ from: 'me', text: 'old' }], daysFrom(-40));
    await saveChatDay([{ from: 'me', text: 'recent' }], daysFrom(-29));
    await saveChatDay([{ from: 'me', text: 'today' }]);
    const days = await chatDays();
    expect(days.map(d => d.day)).toEqual([today(), daysFrom(-29)]);
    expect(await chatDay(daysFrom(-40))).toEqual([]);
  });
  it('each person sees only their own chats', async () => {
    await saveChatDay([{ from: 'me', text: 'owner secret P&L' }]);
    setSession('demo', 'sales1');
    expect(await chatDay()).toEqual([]);
    expect(await chatDays()).toEqual([]);
  });
  it("Clear chat removes today's conversation; files stay", async () => {
    await keepFile('GST summary', sheet('GST'));
    await saveChatDay([{ from: 'me', text: 'gst' }]);
    await clearChatDay();
    expect(await chatDay()).toEqual([]);
    expect((await myFiles()).length).toBe(1);
  });
});

// security review of Part 1 (14 Nov 2026) and the owner's decisions (logout clears; My files kept 30 days)
describe('My files and chats: clearing, roles, no shared bucket', () => {
  const staff = async (id: string, role: string) => { await db.staff.put({ id, name: id, role, active: true, phone: '9' + id.length.toString().padStart(9, '0') } as never); };
  it('nobody logged in: nothing is kept, nothing is shown (no shared "nobody" bucket)', async () => {
    setSession('demo', '');
    await keepFile('Sales', sheet('Sales')); await saveChatDay([{ from: 'me', text: 'hi' }]);
    expect((await db.meta.toArray()).map(r => r.key)).toEqual([]);
    expect(await myFiles()).toEqual([]); expect(await chatDay()).toEqual([]);
  });
  it('a file keeps the role and kind it was made with; owner-only kinds are hidden when the same person is office or salesman', async () => {
    await staff('owner1', 'owner');
    await keepFile('P&L', sheet('P&L')); await keepFile('Salary sheet', sheet('Salary')); await keepFile('Outstanding', sheet('Outstanding'));
    const raw = (await db.meta.get('myfiles:owner1'))!.value as { name: string; role?: string; kind?: string }[];
    expect(raw.find(f => f.name === 'P&L')).toMatchObject({ role: 'owner', kind: 'pnl' });
    expect(raw.find(f => f.name === 'Salary sheet')).toMatchObject({ role: 'owner', kind: 'salary' });
    expect((await myFiles()).length).toBe(3);
    for (const role of ['office', 'salesman']) { await staff('owner1', role); expect((await myFiles()).map(f => f.name)).toEqual(['Outstanding']); }
  });
  it('purgePersonal(id) deletes only that person\'s chats and files; with no id, everyone\'s', async () => {
    await keepFile('Sales', sheet('Sales')); await saveChatDay([{ from: 'me', text: 'a' }]);
    setSession('demo', 'owner12'); await keepFile('Sales', sheet('Sales')); await saveChatDay([{ from: 'me', text: 'b' }]);
    await db.meta.put({ key: 'cursor', value: 5 });
    await purgePersonal('owner1');
    expect((await db.meta.toArray()).map(r => r.key).sort()).toEqual([`chat:owner12:${today()}`, 'cursor', 'myfiles:owner12']);
    await purgePersonal();
    expect((await db.meta.toArray()).map(r => r.key)).toEqual(['cursor']);
  });
  it('once a day at start: chat days and My files older than 30 days go, for every person; a second run the same day does nothing', async () => {
    await saveChatDay([{ from: 'me', text: 'old' }], daysFrom(-40)); await saveChatDay([{ from: 'me', text: 'new' }]);
    await keepFile('Sales', sheet('Sales'));
    const list = (await db.meta.get('myfiles:owner1'))!.value as { at: string }[];
    await db.meta.put({ key: 'myfiles:owner1', value: [...list, { ...list[0], id: 'old', name: 'Old', at: new Date(Date.now() - 31 * 86_400_000).toISOString() }] });
    await db.meta.put({ key: `chat:driver1:${daysFrom(-31)}`, value: [{ from: 'me', text: 'x' }] });
    expect(await dailyPurge()).toBe(true);
    expect((await db.meta.where('key').startsWith('chat:').primaryKeys())).toEqual([`chat:owner1:${today()}`]);
    expect(((await db.meta.get('myfiles:owner1'))!.value as { name: string }[]).map(f => f.name)).toEqual(['Sales']);
    expect(await dailyPurge()).toBe(false);
  });
  it('My files never shows a file older than 30 days, even before the daily purge ran', async () => {
    await keepFile('Sales', sheet('Sales'));
    const list = (await db.meta.get('myfiles:owner1'))!.value as { at: string }[];
    await db.meta.put({ key: 'myfiles:owner1', value: [...list, { ...list[0], id: 'old', name: 'Old', at: new Date(Date.now() - 31 * 86_400_000).toISOString() }] });
    expect((await myFiles()).map(f => f.name)).toEqual(['Sales']);
  });
  it('App: logout clears that person\'s chats and files, and the daily purge runs at start; Privacy: erase and the delete button clear them', async () => {
    const fs = await import('fs');
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/const logout = \(\) => \{[^\n]*purgePersonal\(uid\)/);
    expect(app).toMatch(/useEffect\(\(\) => \{ void dailyPurge\(\)/);
    const priv = fs.readFileSync('src/ui/Privacy.tsx', 'utf8');
    expect(priv).toMatch(/kind === 'delete'\) await purgePersonal\(me\.id\)/);
    expect(priv).toMatch(/Delete my chats and files from this phone/);
  });
});
