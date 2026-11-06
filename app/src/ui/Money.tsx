import { useEffect, useState } from 'react';
import { Check, X, Phone, AlertTriangle, Landmark, MessageSquareText, Download, FileCheck2, ChevronRight, Wallet } from 'lucide-react';
import { ChangeSet, db, today, activeShops } from '../core/db';
import { getLang, inr } from '../core/i18n';
import { invoiceBalances, r2 } from '../core/ledger';
import { exportClaims, exportEinvoice, exportGstr1, exportTally } from '../core/exports';
import { downloadWorkbook } from '../core/readers';
import { askText, notify } from './dialog';
import type { BankLine, Expense, Payment } from '../core/types';
import { ShopStatement } from './ShopStatement';

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
const month = () => today().slice(0, 7);

// ---------- Outstanding by shop and age ----------
export function Outstanding() {
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<{ id: string; name: string; phone?: string; area: string; total: number; b0: number; b8: number; b16: number; b31: number; days: number; limit: number }[]>([]);
  useEffect(() => { (async () => {
    const shops = await activeShops(); const bal = (await invoiceBalances()).filter(b => b.balance > 0.5);
    setRows(shops.map(s => { const mine = bal.filter(b => b.invoice.shopId === s.id); const age = (b: typeof mine[0]) => Math.floor((Date.now() - new Date(b.invoice.date).getTime()) / 86400000); const sum = (f: (d: number) => boolean) => r2(mine.filter(b => f(age(b))).reduce((a, b) => a + b.balance, 0)); return { id: s.id, name: s.name, phone: s.phone, area: s.area, total: r2(mine.reduce((a, b) => a + b.balance, 0)), b0: sum(d => d <= 7), b8: sum(d => d > 7 && d <= 15), b16: sum(d => d > 15 && d <= 30), b31: sum(d => d > 30), days: Math.max(0, ...mine.map(age)), limit: s.creditLimit }; }).filter(r => r.total > 0.5).sort((a, b) => b.days - a.days || b.total - a.total));
  })(); }, []);
  const tot = (k: 'b0' | 'b8' | 'b16' | 'b31') => r2(rows.reduce((a, r) => a + r[k], 0));
  if (open) return <ShopStatement shopId={open} onBack={() => setOpen(null)} />;
  return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{inr(rows.reduce((a, r) => a + r.total, 0))}</div><div className="l">{L('in the market', 'மார்க்கெட்டில்')} · {rows.length} {L('shops', 'கடைகள்')}</div></div>
      <div className="kpis"><div className="kpi"><div className="v">{inr(tot('b0'))}</div><div className="l">0–7 {L('days', 'நாள்')}</div></div><div className="kpi"><div className="v">{inr(tot('b8'))}</div><div className="l">8–15</div></div><div className="kpi"><div className="v" style={{ color: 'var(--warn)' }}>{inr(tot('b16'))}</div><div className="l">16–30</div></div><div className="kpi"><div className="v" style={{ color: 'var(--bad)' }}>{inr(tot('b31'))}</div><div className="l">30+</div></div></div>
      <div className="list">{rows.map(r => <button key={r.id} className="item tap" onClick={() => setOpen(r.id)}><div className={`avatar ${r.days > 30 ? 'bad' : r.days > 15 ? 'gold' : ''}`}>{r.name[0]}</div><div className="grow" style={{ textAlign: 'left' }}><div className="t">{r.name}</div><div className="s">{r.area} · {L('oldest', 'பழைய')} {r.days}d{r.limit && r.total > r.limit ? ' · ' : ''}{r.limit > 0 && r.total > r.limit && <span className="badge bad">{L('over limit', 'வரம்பு மீறல்')}</span>}</div></div><span className="amt num">{inr(r.total)}</span>{r.phone && <a className="btn small" href={`tel:${r.phone}`} onClick={e => e.stopPropagation()} aria-label="Call"><Phone size={16} /></a>}</button>)}</div>
      <div className="muted">{L('Tap a shop for its full statement.', 'கடையை தட்டினால் முழு கணக்கு.')}</div>
    </div>
  );
}

// ---------- Cheques & UPI: today's non-cash, references, cleared/bounced; duplicate alerts ----------
export function Cheques() {
  const [rows, setRows] = useState<(Payment & { shop: string; by: string; bills: string })[]>([]);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { (async () => { const shops = new Map((await activeShops()).map(s => [s.id, s.name])); const staff = new Map((await db.staff.toArray()).map(s => [s.id, s.name])); const inv = new Map((await db.invoices.toArray()).map(i => [i.id, i.number])); setRows((await db.payments.toArray()).filter(p => p.mode !== 'cash' && p.status !== 'cancelled').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60).map(p => ({ ...p, shop: shops.get(p.shopId) ?? '', by: staff.get(p.collectedBy) ?? '', bills: p.allocations.map(a => inv.get(a.invoiceId) ?? '').filter(Boolean).join(', ') }))); })(); }, [tick]);
  const dup = (p: Payment) => rows.some(q => q.id !== p.id && q.shopId === p.shopId && q.amount === p.amount && q.date === p.date);
  const setRef = async (p: Payment) => { const r = await askText(L('Reference number', 'குறிப்பு எண்'), p.ref ?? ''); if (!r) return; const cs = new ChangeSet(); cs.put('payments', { ...p, ref: r }, 'reference'); await cs.commit('Reference'); setTick(x => x + 1); };
  const bounce = async (p: Payment) => { const cs = new ChangeSet(); cs.put('payments', { ...p, status: 'bounced' }, 'cheque bounced'); await cs.commit('Bounced'); setTick(x => x + 1); };
  if (open) return <ShopStatement shopId={open} onBack={() => setOpen(null)} />;
  return (
    <div className="stack">
      <div className="list">
        {rows.map(p => <div key={p.id} className="item" style={{ flexWrap: 'wrap' }}>
          <div className={`avatar ${p.status === 'bounced' ? 'bad' : !p.ref && !p.confirmPhoto ? 'gold' : 'ok'}`}>{p.mode === 'upi' ? 'U' : 'C'}</div>
          <div className="grow"><div className="t"><button className="link" style={{ fontSize: 15, fontWeight: 700, padding: 0 }} onClick={() => setOpen(p.shopId)}>{p.shop}</button> · {inr(p.amount)}</div><div className="s">{p.date} {p.createdAt.slice(11, 16)} · {p.mode.toUpperCase()} {p.ref || <span className="badge warn">{L('no reference', 'குறிப்பு இல்லை')}</span>} · {L('bills', 'பில்')} {p.bills || '—'} · {L('by', 'வசூல்')} {p.by}{p.status === 'bounced' ? ' · ' : ''}{p.status === 'bounced' && <span className="badge bad">{L('bounced', 'திரும்பியது')}</span>}{dup(p) && <span className="badge bad" style={{ marginLeft: 6 }}><AlertTriangle size={11} /> {L('same amount twice', 'இரண்டு முறை')}</span>}</div></div>
          {!p.ref && <button className="btn small" onClick={() => setRef(p)}>{L('Add ref', 'குறிப்பு')}</button>}
          {p.mode === 'cheque' && p.status !== 'bounced' && <button className="btn small" onClick={() => bounce(p)}><X size={14} /> {L('Bounced', 'திரும்பியது')}</button>}
          {p.confirmPhoto && <img src={p.confirmPhoto} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />}
        </div>)}
        {!rows.length && <div className="card muted">{L('No UPI or cheque payments yet.', 'UPI / செக் இல்லை.')}</div>}
      </div>
    </div>
  );
}

// ---------- Bank: statement comes through RoX chat; this shows what's matched and what isn't ----------
export function Bank({ onRox }: { onRox?: () => void }) {
  const [lines, setLines] = useState<(BankLine & { shop?: string })[]>([]);
  useEffect(() => { (async () => { const shops = new Map((await activeShops()).map(s => [s.id, s.name])); setLines((await db.bankLines.toArray()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60).map(b => ({ ...b, shop: b.shopId ? shops.get(b.shopId) : undefined }))); })(); }, []);
  const un = lines.filter(l => l.status === 'unmatched');
  return (
    <div className="stack">
      <button className="btn primary big block" onClick={onRox}><MessageSquareText /> {L('Drop the statement in RoX → "match this"', 'ஸ்டேட்மென்ட்டை RoX-ல் போடுங்கள் → "match this"')}</button>
      <div className="muted">{L('Upload daily or weekly — only new lines are matched; the same line is never counted twice.', 'தினமும் அல்லது வாரம் ஒருமுறை — புதிய வரிகள் மட்டும்.')}</div>
      <div className="kpis"><div className="kpi"><div className="v">{lines.filter(l => l.status === 'matched').length}</div><div className="l">{L('matched', 'பொருந்தியது')}</div></div><div className="kpi"><div className="v" style={{ color: un.length ? 'var(--warn)' : undefined }}>{un.length}</div><div className="l">{L('to check', 'சரிபார்க்க')}</div></div></div>
      <div className="list">{lines.map(l => <div key={l.id} className="item"><div className={`avatar ${l.status === 'matched' ? 'ok' : l.status === 'ignored' ? '' : 'gold'}`}><Landmark size={18} /></div><div className="grow"><div className="t">{l.shop ?? l.narration.slice(0, 40)}</div><div className="s">{l.date}{l.ref ? ` · ${l.ref}` : ''} · {l.status}</div></div><span className="amt num" style={{ color: l.debit ? 'var(--bad)' : undefined }}>{l.credit ? inr(l.credit) : `−${inr(l.debit)}`}</span></div>)}{!lines.length && <div className="card muted">{L('No statement uploaded yet.', 'ஸ்டேட்மென்ட் இல்லை.')}</div>}</div>
    </div>
  );
}

// ---------- Expenses: entered by chat; owner approves in bulk; by head and by van ----------
export function Expenses({ onRox }: { onRox?: () => void }) {
  const [rows, setRows] = useState<(Expense & { van?: string })[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => { const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name])); setRows((await db.expenses.toArray()).filter(e => e.date.startsWith(month())).sort((a, b) => b.date.localeCompare(a.date)).map(e => ({ ...e, van: e.vanId ? vans.get(e.vanId) : undefined }))); })(); }, [tick]);
  const pending = rows.filter(e => !e.approved && e.category !== 'advance');
  const approveAll = async () => { const cs = new ChangeSet(); for (const e of pending) cs.put('expenses', { ...e, approved: true }, 'approved'); await cs.commit('Expenses approved'); setTick(x => x + 1); };
  const byCat = new Map<string, number>(); for (const e of rows) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  return (
    <div className="stack">
      <button className="btn primary big block" onClick={onRox}><MessageSquareText /> {L('Tell RoX: "diesel 1500", "toll 80", "rent 12000"', 'RoX-க்கு சொல்லுங்கள்: "diesel 1500"')}</button>
      <div className="kpi navy"><div className="v">{inr(rows.reduce((a, e) => a + e.amount, 0))}</div><div className="l">{L('this month', 'இந்த மாதம்')} · {[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${inr(v)}`).join(' · ')}</div></div>
      {pending.length > 0 && <div className="alert"><Wallet /><div className="grow"><b>{pending.length} {L('to approve', 'ஒப்புதலுக்கு')}</b> · {inr(pending.reduce((a, e) => a + e.amount, 0))}</div><button className="btn small primary" onClick={approveAll}><Check /> {L('Approve all', 'எல்லாம் ஒப்புதல்')}</button></div>}
      <div className="list">{rows.map(e => <div key={e.id} className="item"><div className={`avatar ${e.approved || e.category === 'advance' ? 'ok' : 'gold'}`}><Wallet size={18} /></div><div className="grow"><div className="t">{e.category}{e.van ? ` · ${e.van}` : ''}</div><div className="s">{e.date} · {e.note?.slice(0, 50)}</div></div><span className="amt num">{inr(e.amount)}</span>{!e.approved && e.category !== 'advance' && <button className="btn small" onClick={async () => { const cs = new ChangeSet(); cs.put('expenses', { ...e, approved: true }, 'approved'); await cs.commit('Expense approved'); setTick(x => x + 1); }}><Check size={14} /></button>}</div>)}</div>
    </div>
  );
}

// ---------- P&L: the owner's most important screen ----------
export function PnL() {
  const [d, setD] = useState<{ sales: number; cn: number; cogs: number; claims: number; own: number; exp: Map<string, number>; interest: number; cash: number; bank: number; staff: number } | null>(null);
  const [period, setPeriod] = useState<'today' | 'month'>('month');
  useEffect(() => { (async () => {
    const from = period === 'today' ? today() : month();
    const inRange = (dt: string) => period === 'today' ? dt === from : dt.startsWith(from);
    const invs = (await db.invoices.toArray()).filter(i => !i.cancelled && inRange(i.date));
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const cns = (await db.creditNotes.toArray()).filter(c => inRange(c.date));
    const sales = r2(invs.reduce((a, i) => a + i.taxable, 0));
    const cogs = r2(invs.reduce((a, i) => a + i.lines.reduce((b, l) => b + (l.qty + l.freeQty) * (products.get(l.productId)?.purchaseRate ?? 0), 0), 0));
    const claimsAll = (await db.claimEntries.toArray()).filter(c => inRange(c.createdAt.slice(0, 10)));
    const schemes = await db.schemes.toArray();
    const own = r2(claimsAll.filter(c => c.kind === 'scheme' && schemes.some(s => s.source === 'own' && (s.productId === c.productId || !s.productId) && s.companyId === c.companyId)).reduce((a, c) => a + c.amount, 0));
    const claims = r2(claimsAll.filter(c => c.kind === 'scheme').reduce((a, c) => a + c.amount, 0) - own);
    const exps = (await db.expenses.toArray()).filter(e => inRange(e.date) && e.category !== 'advance');
    const exp = new Map<string, number>(); for (const e of exps) exp.set(e.category, r2((exp.get(e.category) ?? 0) + e.amount));
    const pays = (await db.payments.toArray()).filter(p => p.status === 'ok');
    const bank = r2((await db.bankLines.toArray()).reduce((a, b) => a + b.credit - b.debit, 0));
    setD({ sales, cn: r2(cns.reduce((a, c) => a + c.total, 0)), cogs, claims, own, exp, interest: exp.get('emi') ?? 0, cash: r2(pays.filter(p => p.mode === 'cash' && p.settled).reduce((a, p) => a + p.amount, 0) - exps.filter(e => e.approved).reduce((a, e) => a + e.amount, 0)), bank, staff: r2(pays.filter(p => p.mode === 'cash' && !p.settled).reduce((a, p) => a + p.amount, 0)) });
  })(); }, [period]);
  if (!d) return null;
  const net = r2(d.sales - d.cn); const gm = r2(net - d.cogs); const expT = r2([...d.exp.values()].reduce((a, v) => a + v, 0)); const profit = r2(gm + d.claims - d.own - expT);
  const Row = ({ l, v, bold, neg }: { l: string; v: number; bold?: boolean; neg?: boolean }) => <div className="row" style={{ justifyContent: 'space-between', minHeight: 34, fontWeight: bold ? 800 : 400, borderTop: bold ? '1px solid var(--line)' : undefined }}><span>{l}</span><span className="num" style={{ color: neg ? 'var(--bad)' : undefined }}>{neg ? '− ' : ''}{inr(Math.abs(v))}</span></div>;
  return (
    <div className="stack">
      <div className="segmented" style={{ maxWidth: 260 }}><button className={period === 'today' ? 'on' : ''} onClick={() => setPeriod('today')}>{L('Today', 'இன்று')}</button><button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>{L('This month', 'இந்த மாதம்')}</button></div>
      <div className="kpi navy"><div className="v" style={{ color: profit < 0 ? '#ffa39a' : undefined }}>{inr(profit)}</div><div className="l">{L('net profit', 'நிகர லாபம்')} · {net ? Math.round(profit / net * 100) : 0}%</div></div>
      <div className="card">
        <Row l={L('Sales (before tax)', 'விற்பனை')} v={d.sales} /><Row l={L('Returns / credit notes', 'திரும்பியது')} v={d.cn} neg /><Row l={L('Net sales', 'நிகர விற்பனை')} v={net} bold />
        <Row l={L('Cost of goods sold (FIFO)', 'விற்ற பொருள் செலவு')} v={d.cogs} neg /><Row l={L('Gross margin', 'மொத்த லாபம்')} v={gm} bold />
        <Row l={L('Company scheme claims', 'கம்பெனி கிளைம்')} v={d.claims} /><Row l={L('Own discounts given', 'சொந்த தள்ளுபடி')} v={d.own} neg />
        {[...d.exp.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <Row key={k} l={`${L('Expense', 'செலவு')} · ${k}`} v={v} neg />)}
        <Row l={L('Net profit', 'நிகர லாபம்')} v={profit} bold />
      </div>
      <div className="kpis"><div className="kpi"><div className="v">{inr(d.cash)}</div><div className="l">{L('cash in hand', 'கையில் பணம்')}</div></div><div className="kpi"><div className="v">{inr(d.bank)}</div><div className="l">{L('in bank', 'வங்கியில்')}</div></div><div className="kpi"><div className="v" style={{ color: d.staff ? 'var(--warn)' : undefined }}>{inr(d.staff)}</div><div className="l">{L('with staff', 'ஊழியரிடம்')}</div></div></div>
    </div>
  );
}

// ---------- Position: what I own − what I owe ----------
export function Position() {
  const [d, setD] = useState<{ stock: number; cash: number; bank: number; recv: number; claims: number; payCo: number; loans: number } | null>(null);
  useEffect(() => { (async () => {
    const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const stock = r2((await db.batches.toArray()).reduce((a, b) => a + b.qty * (products.get(b.productId)?.purchaseRate ?? 0), 0));
    const recv = r2((await invoiceBalances()).reduce((a, b) => a + Math.max(0, b.balance), 0));
    const purchases = await db.purchases.toArray(); const payCo = r2(purchases.reduce((a, p) => a + p.total - (p.paid ?? 0), 0));
    const claims = r2((await db.claims.toArray()).filter(c => ['submitted', 'approved'].includes(c.status)).reduce((a, c) => a + c.amount - (c.received ?? 0), 0));
    const pays = (await db.payments.toArray()).filter(p => p.status === 'ok');
    const bank = r2((await db.bankLines.toArray()).reduce((a, b) => a + b.credit - b.debit, 0));
    const loans = r2((await db.expenses.toArray()).filter(e => e.category === 'loan').reduce((a, e) => a + e.amount, 0));
    setD({ stock, cash: r2(pays.filter(p => p.mode === 'cash' && p.settled).reduce((a, p) => a + p.amount, 0)), bank, recv, claims, payCo, loans });
  })(); }, []);
  if (!d) return null;
  const own = r2(d.stock + d.cash + d.bank + d.recv + d.claims); const owe = r2(d.payCo + d.loans);
  const Row = ({ l, v, bold }: { l: string; v: number; bold?: boolean }) => <div className="row" style={{ justifyContent: 'space-between', minHeight: 34, fontWeight: bold ? 800 : 400, borderTop: bold ? '1px solid var(--line)' : undefined }}><span>{l}</span><span className="num">{inr(v)}</span></div>;
  return (
    <div className="stack">
      <div className="kpi navy"><div className="v">{inr(own - owe)}</div><div className="l">{L('net worth today', 'இன்றைய நிகர மதிப்பு')}</div></div>
      <div className="card"><div className="eyebrow">{L('What I own', 'என்னிடம் உள்ளது')}</div><Row l={L('Stock at cost', 'ஸ்டாக்')} v={d.stock} /><Row l={L('Cash', 'பணம்')} v={d.cash} /><Row l={L('Bank', 'வங்கி')} v={d.bank} /><Row l={L('Shops owe me', 'கடைகள் தர வேண்டியது')} v={d.recv} /><Row l={L('Claims to receive', 'வர வேண்டிய கிளைம்')} v={d.claims} /><Row l={L('Total', 'மொத்தம்')} v={own} bold /></div>
      <div className="card"><div className="eyebrow">{L('What I owe', 'நான் தர வேண்டியது')}</div><Row l={L('To companies', 'கம்பெனிக்கு')} v={d.payCo} /><Row l={L('Loans', 'கடன்')} v={d.loans} /><Row l={L('Total', 'மொத்தம்')} v={owe} bold /></div>
      <div className="muted">{L('Loans and private borrowings: tell RoX "loan 500000 from Canara, EMI 12000". (Entry screen in the next build.)', 'கடன்: RoX-க்கு சொல்லுங்கள்.')}</div>
    </div>
  );
}

// ---------- Export: Tally, Excel ledgers ----------
export function ExportPage() {
  const m = month();
  const run = async (f: () => Promise<{ text: string }>) => { const r = await f(); void notify(L('Export', 'ஏற்றுமதி'), r.text); };
  const ledgers = async () => {
    const shops = new Map((await activeShops()).map(s => [s.id, s.name]));
    const invs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.date.startsWith(m)); const pays = (await db.payments.toArray()).filter(p => p.date.startsWith(m) && p.status === 'ok'); const exps = (await db.expenses.toArray()).filter(e => e.date.startsWith(m));
    await downloadWorkbook(`DBRoX-ledgers-${m}`, [
      { name: 'Sales', header: ['Date', 'Bill', 'Shop', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'], rows: invs.map(i => [i.date, i.number, shops.get(i.shopId) ?? '', i.taxable, i.cgst, i.sgst, i.igst, i.total]) },
      { name: 'Receipts', header: ['Date', 'Shop', 'Mode', 'Ref', 'Amount'], rows: pays.map(p => [p.date, shops.get(p.shopId) ?? '', p.mode, p.ref ?? '', p.amount]) },
      { name: 'Expenses', header: ['Date', 'Head', 'Amount', 'Note'], rows: exps.map(e => [e.date, e.category, e.amount, e.note ?? '']) },
    ]);
  };
  return (
    <div className="stack">
      <button className="btn big block" onClick={() => run(() => exportTally(m))}><Download /> {L('Tally XML', 'Tally XML')} · {m}</button>
      <button className="btn big block" onClick={ledgers}><Download /> {L('Excel ledgers (sales, receipts, expenses)', 'Excel லெட்ஜர்')}</button>
      <button className="btn big block" onClick={() => run(() => exportClaims(m))}><Download /> {L('Claim file', 'கிளைம் ஃபைல்')}</button>
      <div className="muted">{L('Your auditor gets these monthly. GST files are under the GST icon.', 'ஆடிட்டருக்கு மாதந்தோறும்.')}</div>
    </div>
  );
}

// ---------- GST: RoX acts as the accountant; one screen, flags with one-tap fixes ----------
export function Gst({ go }: { go?: (p: string) => void }) {
  const [d, setD] = useState<{ sales: number; tax: number; bills: number; flags: { text: string; page?: string; tone?: 'bad' }[]; due: string; daysLeft: number } | null>(null);
  const m = month();
  useEffect(() => { (async () => {
    const invs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.date.startsWith(m));
    const products = await db.products.toArray(); const shops = await activeShops();
    const flags: { text: string; page?: string; tone?: 'bad' }[] = [];
    const noHsn = products.filter(p => p.active && !(p.hsn && (p.hsn.length === 6 || p.hsn.length === 8)));
    if (noHsn.length) flags.push({ text: L(`${noHsn.length} product(s) have no valid HSN: ${noHsn.slice(0, 3).map(p => p.name).join(', ')} — fix before filing`, `${noHsn.length} பொருட்களுக்கு HSN இல்லை`), tone: 'bad' });
    const revised = invs.filter(i => i.original);
    if (revised.length) flags.push({ text: L(`${revised.length} bill(s) revised after delivery — included as delivered quantities, originals kept inside`, `${revised.length} பில் மாற்றப்பட்டது`), page: 'status' });
    const badGst = shops.filter(s => s.gstin && s.gstin.length !== 15);
    if (badGst.length) flags.push({ text: L(`${badGst.length} shop(s) have a wrong GSTIN — billed as B2C until fixed`, `${badGst.length} கடை GSTIN தவறு`), page: 'outstanding' });
    const purchases = (await db.purchases.toArray()).filter(p => p.date.startsWith(m));
    if (purchases.length) flags.push({ text: L(`${purchases.length} company bill(s) this month — drop your GSTR-2B Excel in RoX ("match 2B") before claiming input credit`, `${purchases.length} கம்பெனி பில் — 2B பொருத்துங்கள்`) });
    const turnover = (await db.invoices.toArray()).filter(i => !i.cancelled).reduce((a, i) => a + i.total, 0);
    if (turnover > 50000000) flags.push({ text: L('Turnover crossed ₹5 crore — e-invoicing is mandatory', 'விற்றுமுதல் ₹5 கோடி — e-invoice கட்டாயம்'), tone: 'bad' });
    const next = new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 11); const daysLeft = Math.ceil((next.getTime() - Date.now()) / 86400000);
    setD({ sales: r2(invs.reduce((a, i) => a + i.taxable, 0)), tax: r2(invs.reduce((a, i) => a + i.cgst + i.sgst + i.igst, 0)), bills: invs.length, flags, due: next.toISOString().slice(0, 10), daysLeft });
  })(); }, []);
  if (!d) return null;
  const run = async (f: () => Promise<{ text: string }>) => { const r = await f(); void notify('GST', r.text); };
  return (
    <div className="stack">
      <div className="card" style={{ background: 'var(--navy)', color: 'var(--on-navy)' }}>
        <div className="eyebrow" style={{ color: 'var(--on-navy-2)' }}>{L('This month', 'இந்த மாதம்')} · {m}</div>
        <div style={{ fontSize: 17, lineHeight: 1.5 }}>{L(`Sales ₹${d.sales.toLocaleString('en-IN')} on ${d.bills} bills · tax to pay ₹${d.tax.toLocaleString('en-IN')} · ${d.flags.length ? `${d.flags.length} thing(s) to fix` : 'nothing to fix'} · file GSTR-1 by ${d.due.slice(8)}/${d.due.slice(5, 7)} (${d.daysLeft} days).`, `விற்பனை ₹${d.sales.toLocaleString('en-IN')} · வரி ₹${d.tax.toLocaleString('en-IN')} · ${d.flags.length} சரி செய்ய · GSTR-1 ${d.due.slice(8)}/${d.due.slice(5, 7)}க்குள்.`)}</div>
      </div>
      {d.flags.map((f, i) => <button key={i} className={`flag ${f.tone ?? ''}`} onClick={() => f.page && go?.(f.page)} style={{ textAlign: 'left' }}><AlertTriangle style={{ color: f.tone === 'bad' ? 'var(--bad)' : 'var(--warn)', flex: 'none' }} /><span className="grow">{f.text}</span>{f.page && <ChevronRight />}</button>)}
      {!d.flags.length && <div className="alert ok"><Check /><div>{L('Everything is in order for filing.', 'எல்லாம் சரியாக உள்ளது.')}</div></div>}
      <div className="card stack">
        <div className="eyebrow"><FileCheck2 size={14} style={{ verticalAlign: -2 }} /> {L('Ready for auditor', 'ஆடிட்டருக்கு தயார்')}</div>
        <button className="btn big block" onClick={() => run(() => exportGstr1(m))}><Download /> GSTR-1 ({L('portal format', 'போர்ட்டல் வடிவம்')})</button>
        <button className="btn big block" onClick={() => run(() => exportEinvoice(m))}><Download /> {L('E-invoice JSON (NIC)', 'E-invoice JSON')}</button>
        <div className="muted">{L('3B summary: output tax', '3B: வெளி வரி')} {inr(d.tax)} {L('minus input credit after 2B match.', '− 2B பொருத்திய உள்ளீட்டு வரவு.')}</div>
      </div>
    </div>
  );
}
