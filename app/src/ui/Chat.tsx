import { useEffect, useRef, useState } from 'react';
import { Paperclip, Mic, Send, Printer, Undo2 } from 'lucide-react';
import { handle, type Reply } from '../core/engine';
import { undoBatch } from '../core/db';
import { getLang, t } from '../core/i18n';
import { ApproveTable, ReadTable } from './ApproveTable';
import { PrintBill } from './PrintBill';
import type { Invoice, Role } from '../core/types';
import { notify } from './dialog';

interface Msg { id: number; from: 'me' | 'bot'; text: string; files?: string[]; reply?: Reply; batchId?: string; undone?: boolean; invoices?: Invoice[] }

const SUGGEST: Record<Role, string[]> = {
  owner: ['orders received', 'delivery plan', 'diesel 1500', 'who owes more than 5000', 'P&L', 'GST', 'Karthik leave tomorrow', 'help'],
  office: ['today sales', 'outstanding', 'load sheet', 'gstr1', 'e-invoice', 'help'],
  salesman: ['Murugan Stores 1 case Surf, 24 Good Day', 'Selvam Kirana paid 500 cash', 'leave Monday', 'advance 1000', 'help'],
  godown: ['pick orders', 'load sheet', 'near expiry', 'stock of surf', '5 Good Day damaged', 'help'],
  delivery: ['my trip', 'diesel 1500', 'Kumar Mart outstanding', 'help'],
};

let seq = 1;

export function Chat({ role, onGo }: { role: Role; onGo?: (page: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ id: seq++, from: 'bot', text: 'Vanakkam! Send a file or photo and say what to do, or just type. Say "help" for examples.' }]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [printing, setPrinting] = useState<Invoice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const push = (m: Omit<Msg, 'id'>) => setMsgs(x => [...x, { ...m, id: seq++ }]);

  const send = async (override?: string) => {
    const said = (override ?? text).trim();
    if (!said && !files.length) return;
    push({ from: 'me', text: said || '(file)', files: files.map(f => f.name) });
    const fs = files;
    setText(''); setFiles([]); setBusy(true);
    try {
      const reply = await handle(said, fs);
      push({ from: 'bot', text: reply.text, reply });
      if (reply.go && onGo) setTimeout(() => onGo(reply.go!), 350);
    } catch (e) {
      push({ from: 'bot', text: `Something went wrong: ${(e as Error).message}`, reply: { text: '', tone: 'error' } });
    } finally { setBusy(false); }
  };

  const listen = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Rec = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Rec) { void notify('Voice typing not available here', 'Use the microphone key on your phone keyboard instead.'); return; }
    const r = new Rec();
    r.lang = getLang() === 'ta' ? 'ta-IN' : 'en-IN';
    r.interimResults = false;
    r.onresult = (e: SREvent) => setText(x => (x ? x + ' ' : '') + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  const onDone = (msgId: number) => (res: { message: string; batchId: string; invoices?: Invoice[] } | null) => {
    if (!res) return;
    push({ from: 'bot', text: res.message, batchId: res.batchId, invoices: res.invoices });
    void msgId;
  };

  const undo = async (m: Msg) => {
    if (!m.batchId) return;
    const n = await undoBatch(m.batchId);
    setMsgs(x => x.map(y => y.id === m.id ? { ...y, undone: true } : y));
    push({ from: 'bot', text: n ? `${t('undone')} (${n} change${n > 1 ? 's' : ''} reversed).` : 'Already undone.' });
  };

  return (
    <div className="chat">
      <div className="msgs">
        {msgs.map(m => (
          <div key={m.id} className={`msg ${m.from} ${m.reply?.tone ?? ''} ${m.reply?.proposal || m.reply?.table ? 'wide' : ''}`}>
            {m.text}
            {m.files?.map(f => <div key={f} className="att"><Paperclip size={12} style={{ verticalAlign: -2 }} /> {f}</div>)}
            {m.reply?.proposal && <div style={{ marginTop: 10 }}><ApproveTable proposal={m.reply.proposal} onDone={onDone(m.id)} /></div>}
            {m.reply?.table && <div style={{ marginTop: 10 }}><ReadTable table={m.reply.table} /></div>}
            {m.reply?.actions?.length ? <div className="row" style={{ marginTop: 8 }}>{m.reply.actions.map(a => <button key={a.label} className="btn primary small" onClick={() => a.run()}>{a.label}</button>)}</div> : null}
            {m.invoices?.length ? <div className="row" style={{ marginTop: 8 }}>{m.invoices.map(i => <button key={i.id} className="btn small" onClick={() => setPrinting(i)}><Printer /> {i.number}</button>)}</div> : null}
            {m.batchId && !m.undone && <div style={{ marginTop: 6 }}><button className="btn small ghost" onClick={() => undo(m)}><Undo2 /> {t('undo')}</button></div>}
          </div>
        ))}
        {busy && <div className="msg bot muted">…</div>}
        <div ref={endRef} />
      </div>
      <div className="chips">
        {SUGGEST[role].map(s => <button key={s} className="chip" onClick={() => setText(s)}>{s}</button>)}
      </div>
      {files.length > 0 && <div className="filechip"><Paperclip size={16} /> {files.map(f => f.name).join(', ')} <button className="btn small ghost" onClick={() => setFiles([])}>✕</button></div>}
      <div className="composer">
        <input ref={fileRef} type="file" hidden accept="image/*,.pdf,.xlsx,.xls,.csv" onChange={e => { setFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label={t('attach')}><Paperclip /></button>
        <textarea rows={1} value={text} placeholder={t('typeHere')} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className={`icon-btn ${listening ? 'rec' : ''}`} onClick={listen} aria-label="Voice"><Mic /></button>
        <button className="icon-btn gold" onClick={() => send()} aria-label={t('send')}><Send /></button>
      </div>
      {printing && <PrintBill invoice={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

interface SREvent { results: { [i: number]: { [j: number]: { transcript: string } } } }
interface SR { lang: string; interimResults: boolean; onresult: (e: SREvent) => void; onend: () => void; start: () => void }
