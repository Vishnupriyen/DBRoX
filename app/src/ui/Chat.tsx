import { useEffect, useRef, useState } from 'react';
import { Paperclip, Mic, Send, Printer, Undo2, History, FolderOpen, Eraser, ArrowLeft } from 'lucide-react';
import { handle, type Reply } from '../core/engine';
import { undoBatch, undoRefusal } from '../core/db';
import { t } from '../core/i18n';
import { ApproveTable, ReadTable } from './ApproveTable';
import { PrintBill } from './PrintBill';
import type { Invoice, Role } from '../core/types';
import { notify } from './dialog';
import { TesraxCore, type CoreState } from './TesraxCore';
import { sound } from '../core/sound';
import { noteMessage, noteOutcome } from '../core/tesraxReport';
import { chatDay, chatDays, clearChatDay, keepFile, saveChatDay, type ChatLine } from '../core/myfiles';
import { showDate } from '../core/i18n';
import { MyFilesPage } from './MyFiles';
import { confirmBox } from './dialog';
import { today } from '../core/db';

interface Msg { id: number; from: 'me' | 'bot'; text: string; files?: string[]; reply?: Reply; batchId?: string; undone?: boolean; invoices?: Invoice[]; closed?: boolean; replaced?: string; day?: string; changed?: boolean; old?: boolean }

// chat history (item 44): what is kept of a message — words, tone and any read-only table; a table to approve is kept as a note
const toLine = (m: Msg): ChatLine => ({ from: m.from, text: m.text, tone: m.reply?.tone, table: m.reply?.table, files: m.files,
  note: m.reply?.proposal ? (m.replaced ?? (m.closed ? 'Table closed.' : 'Table not saved — ask again to see it.')) : undefined });
const fromLine = (l: ChatLine): Omit<Msg, 'id'> => ({ from: l.from, text: l.note ? `${l.text}\n${l.note}` : l.text, files: l.files, reply: { text: l.text, tone: l.tone, table: l.table }, closed: true, old: true });
// TESRAX never jumps to another screen (item 6): "Opening X." becomes an answer with a button the person may tap
const shown = (m: Msg) => m.reply?.go && /^Opening (.+)\.$/.test(m.text) ? `${m.text.replace(/^Opening (.+)\.$/, '$1')} — tap below to open it.` : m.text;

const SUGGEST: Record<Role, string[]> = {
  owner: ['orders received', 'delivery plan', 'diesel 1500', 'who owes more than 5000', 'P&L', 'GST', 'Karthik leave tomorrow', 'help'],
  office: ['today sales', 'outstanding', 'load sheet', 'gstr1', 'e-invoice', 'help'],
  salesman: ['Murugan Stores 1 case Surf, 24 Good Day', 'Selvam Kirana paid 500 cash', 'leave Monday', 'advance 1000', 'help'],
  godown: ['pick orders', 'load sheet', 'near expiry', 'stock of surf', '5 Good Day damaged', 'help'],
  delivery: ['my trip', 'diesel 1500', 'Kumar Mart outstanding', 'help'],
  cadmin: ['sales this month', 'stock at distributors', 'pending claims', 'who did not visit today', 'help'],
  manager: ['who did not visit today', 'pending claims', 'team sales this month', 'help'],
  rep: ['start day', 'Murugan Stores 2 case Kaveri Gold', 'lunch 120, bus 45', 'my sales this month', 'help'],
};

let seq = 1;

export function Chat({ role, onGo }: { role: Role; onGo?: (page: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [ready, setReady] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const [view, setView] = useState<'chat' | 'history' | 'files' | { day: string; lines: ChatLine[] }>('chat');
  const [days, setDays] = useState<{ day: string; count: number }[]>([]);
  const loaded = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, view]);
  // the last conversation stays (item 44): today's log is read back when TESRAX opens; old days (> 30) are deleted
  useEffect(() => { void (async () => { const lines = await chatDay(); setMsgs(now => [...lines.map(l => ({ ...fromLine(l), id: seq++ })), ...now]); loaded.current = true; void chatDays(); })(); }, []);
  useEffect(() => { if (loaded.current) void saveChatDay(msgs.map(toLine)); }, [msgs]);

  const push = (m: Omit<Msg, 'id'>) => setMsgs(x => [...x, { ...m, id: seq++ }]);

  const send = async (override?: string) => {
    const said = (override ?? text).trim();
    if (!said && !files.length) return;
    push({ from: 'me', text: said || '(file)', files: files.map(f => f.name) });
    const fs = files;
    setText(''); setFiles([]); setBusy(true);
    try {
      // the table or question just shown, so a reply like "make it 600" or "Murugan" can refer to it
      const lastBot = [...msgs].reverse().find(m => m.from === 'bot' && m.reply && !m.reply.parts);
      const open = lastBot && !lastBot.closed && (lastBot.reply!.proposal || lastBot.reply!.pending) ? lastBot : undefined;
      const t0 = performance.now();
      const reply = await handle(said, fs, { last: open?.reply });
      const day = await noteMessage(role, said, reply, performance.now() - t0);
      if (reply.replaces && open) setMsgs(x => x.map(y => y.id === open.id ? { ...y, closed: true, replaced: reply.follow === 'dropped' ? 'Dropped — nothing saved.' : 'Changed — see below.' } : y));
      if (reply.replaces && open && reply.follow === 'dropped' && open.reply?.proposal) void noteOutcome(open.day ?? day, role, 'cancelled');
      // a table changed by a follow-up ("make it 600") counts as edited when it is approved
      const changed = !!(reply.replaces && open) || undefined;
      push({ from: 'bot', text: reply.text, reply: reply.parts ? { text: reply.text, parts: [] } : reply, day, changed });
      for (const part of reply.parts ?? []) push({ from: 'bot', text: part.text, reply: part, day });
      // everything asked is kept in My files (item 6)
      for (const r of [reply, ...(reply.parts ?? [])]) if (r.table?.rows.length) void keepFile(r.table.name, [{ name: r.table.name, header: r.table.columns, rows: r.table.rows }]).catch(() => {});
      setBusy(false);
      if (reply.tone === 'warn' || reply.tone === 'error') sound.warn(); else { sound.done(); setReady(true); setTimeout(() => setReady(false), 1600); }
    } catch (e) {
      void noteMessage(role, said, null, 0);
      sound.warn();
      push({ from: 'bot', text: `Something went wrong: ${(e as Error).message}`, reply: { text: '', tone: 'error' } });
    } finally { setBusy(false); }
  };

  const listen = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Rec) { void notify('Voice typing not available here', 'Use the microphone key on your phone keyboard instead.'); return; }
    const r = new Rec();
    r.lang = 'en-IN';
    r.interimResults = false;
    r.onresult = (e: SREvent) => setText(x => (x ? x + ' ' : '') + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  const onDone = (msgId: number) => (res: { message: string; batchId: string; invoices?: Invoice[]; edited?: boolean } | null) => {
    const m = msgs.find(y => y.id === msgId);
    if (m?.day) void noteOutcome(m.day, role, !res ? 'cancelled' : res.edited || m.changed ? 'edited' : 'approved');
    setMsgs(x => x.map(y => y.id === msgId ? { ...y, closed: true } : y));
    if (!res) return;
    push({ from: 'bot', text: res.message, batchId: res.batchId, invoices: res.invoices });
  };

  const undo = async (m: Msg) => {
    if (!m.batchId) return;
    const n = await undoBatch(m.batchId);
    if (n < 0) { push({ from: 'bot', text: undoRefusal(n), reply: { text: '', tone: 'warn' } }); return; }
    setMsgs(x => x.map(y => y.id === m.id ? { ...y, undone: true } : y));
    push({ from: 'bot', text: n ? `${t('undone')} (${n} change${n > 1 ? 's' : ''} reversed).` : 'Already undone.' });
  };

  const openHistory = async () => { setDays(await chatDays()); setView('history'); };
  const clear = async () => { if (!msgs.length || !await confirmBox('Clear this chat?', "Today's conversation with TESRAX is removed from this phone. Your files stay in My files.", 'Clear')) return; await clearChatDay(); setMsgs([]); };
  const tools = (
    <div className={`chat-tools${view !== 'chat' ? ' back' : ''}`}>
      {view !== 'chat' && <button className="chat-tool" onClick={() => setView(typeof view === 'object' ? 'history' : 'chat')}><ArrowLeft /> {typeof view === 'object' ? 'History' : 'Chat'}</button>}
      {view === 'chat' && <><button className="chat-tool" onClick={openHistory}><History /> History</button><button className="chat-tool" onClick={() => setView('files')}><FolderOpen /> My files</button>{msgs.length > 0 && <button className="chat-tool" onClick={clear}><Eraser /> Clear chat</button>}</>}
    </div>
  );
  if (view === 'files') return <div className="chat engine-chat talking">{tools}<div className="msgs"><MyFilesPage /></div></div>;
  if (view === 'history') return (
    <div className="chat engine-chat talking">{tools}
      <div className="msgs"><div className="muted" style={{ marginBottom: 8 }}>Your chats with TESRAX, by day — kept 30 days. Only you see them.</div>
        {!days.length && <div className="card muted">No chats yet.</div>}
        <div className="list">{days.map(d => <button key={d.day} className="item tap" onClick={async () => setView({ day: d.day, lines: await chatDay(d.day) })}><div className="grow" style={{ textAlign: 'left' }}><div className="t">{d.day === today() ? 'Today' : showDate(d.day)}</div><div className="s">{d.count} message{d.count === 1 ? '' : 's'}</div></div></button>)}</div>
      </div></div>);
  if (typeof view === 'object') return (
    <div className="chat engine-chat talking">{tools}
      <div className="msgs"><div className="muted" style={{ marginBottom: 8 }}>{view.day === today() ? 'Today' : showDate(view.day)}</div>
        {view.lines.map((l, i) => <div key={i} className={`msg ${l.from} ${l.tone ?? ''} ${l.table ? 'wide' : ''}`}>{l.text}{l.note && <div className="muted" style={{ marginTop: 6 }}>{l.note}</div>}{l.table && <div style={{ marginTop: 10 }}><ReadTable table={l.table} /></div>}</div>)}
        <div ref={endRef} /></div></div>);

  const fresh = msgs.length === 0 && !busy;
  const state: CoreState = busy ? 'thinking' : ready ? 'ready' : (listening || text.length > 0) ? 'listening' : 'idle';
  const status = busy ? ('Working on it…') : ready ? ('Done') : listening ? ('Listening…') : '';
  return (
    <div className={`chat engine-chat ${fresh ? 'fresh' : 'talking'}`}>
      {tools}
      <div className="stage">
        <TesraxCore state={state} size={fresh ? 176 : 56} pulse={pulse} />
        {fresh
          ? <div className="say">{'What shall we do?'}<span className="ta">{'Type, speak or send a photo. I prepare it, you approve.'}</span></div>
          : <div className="status">{status || ('Anything else?')}</div>}
      </div>
      {fresh
        ? <div className="hero-chips">{SUGGEST[role].filter(s => s !== 'help').map(s => <button key={s} className="chip" onClick={() => { setText(s); setPulse(p => p + 1); }}>{s}</button>)}</div>
        : <div className="msgs">
        {msgs.map(m => (
          <div key={m.id} className={`msg ${m.from} ${m.reply?.tone ?? ''} ${m.reply?.proposal || m.reply?.table ? 'wide' : ''}`}>
            {shown(m)}
            {m.files?.map(f => <div key={f} className="att"><Paperclip size={12} style={{ verticalAlign: -2 }} /> {f}</div>)}
            {m.reply?.proposal && (m.replaced ? <div className="muted" style={{ marginTop: 6 }}>{m.replaced}</div> : <div style={{ marginTop: 10 }}><ApproveTable proposal={m.reply.proposal} onDone={onDone(m.id)} /></div>)}
            {m.reply?.table && <div style={{ marginTop: 10 }}><ReadTable table={m.reply.table} /></div>}
            {m.reply?.link && onGo ? <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => onGo(m.reply!.link!.page)}>{m.reply.link.label} →</button></div> : null}
            {m.reply?.go && !m.old && onGo ? <div className="row" style={{ marginTop: 8 }}><button className="btn small" onClick={() => onGo(m.reply!.go!)}>Open {m.text.replace(/^Opening (.+)\.$/, '$1')} →</button></div> : null}
            {m.reply?.actions?.length ? <div className="row" style={{ marginTop: 8 }}>{m.reply.actions.map(a => <button key={a.label} className="btn primary small" onClick={() => a.run()}>{a.label}</button>)}</div> : null}
            {m.invoices?.length ? <div className="row" style={{ marginTop: 8 }}>{m.invoices.map(i => <button key={i.id} className="btn small" onClick={() => setPrinting(i)}><Printer /> <span className="billno">{i.number}</span></button>)}</div> : null}
            {m.batchId && !m.undone && <div style={{ marginTop: 6 }}><button className="btn small ghost" onClick={() => undo(m)}><Undo2 /> {t('undo')}</button></div>}
          </div>
        ))}
        {busy && <div className="msg bot typing"><i /><i /><i /></div>}
        <div ref={endRef} />
      </div>}
      {!fresh && <div className="chips">
        {SUGGEST[role].map(s => <button key={s} className="chip" onClick={() => { setText(s); setPulse(p => p + 1); }}>{s}</button>)}
      </div>}
      {files.length > 0 && <div className="filechip"><Paperclip size={16} /> {files.map(f => f.name).join(', ')} <button className="btn small ghost" onClick={() => setFiles([])}>✕</button></div>}
      <div className="composer">
        <input ref={fileRef} type="file" hidden accept="image/*,.pdf,.xlsx,.xls,.csv" onChange={e => { setFiles(Array.from(e.target.files ?? [])); e.target.value = ''; setPulse(p => p + 1); }} />
        <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label={t('attach')}><Paperclip /></button>
        <textarea rows={1} value={text} placeholder={'Type or speak…'} onChange={e => { setText(e.target.value); setPulse(p => p + 1); sound.key(); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        {text.trim() || files.length
          ? <button className="icon-btn gold" onClick={() => send()} aria-label={t('send')}><Send /></button>
          : <button className={`icon-btn gold ${listening ? 'rec' : ''}`} onClick={listen} aria-label="Voice"><Mic /></button>}
      </div>
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

interface SREvent { results: { [i: number]: { [j: number]: { transcript: string } } } }
interface SR { lang: string; interimResults: boolean; onresult: (e: SREvent) => void; onend: () => void; start: () => void }
