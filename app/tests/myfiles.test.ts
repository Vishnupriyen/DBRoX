// TESRAX memory (founder, 14 Nov 2026 — items 6 and 44): My files keeps everything asked; the chat stays when TESRAX is
// reopened, history by day for 30 days, each person sees only their own; Clear chat removes today's log, files stay.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, setSession, today, daysFrom } from '../src/core/db';
import { chatDay, chatDays, clearChatDay, keepFile, myFiles, saveChatDay, dropFile, MAX_FILES } from '../src/core/myfiles';

beforeEach(async () => { await db.meta.clear(); setSession('demo', 'owner1'); });
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
