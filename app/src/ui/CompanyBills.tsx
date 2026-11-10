// Distributor side: bills from linked companies to receive (digital GRN), and the order to a company (suggested).
import { useEffect, useState } from 'react';
import { ChevronRight, QrCode, Check, Send } from 'lucide-react';
import { db } from '../core/db';
import { inr } from '../core/i18n';
import { compareQr, readDifferences, readEinvoiceQr, receiveInbound, receiptOf, sendPrimaryOrder, suggestOrder, type Diff, type SuggestRow } from '../core/grn';
import { getSettings } from '../core/db';
import { PhotoButton } from './PhotoButton';
import { confirmBox, notify } from './dialog';
import type { Company, Inbound, PrimaryOrder, Product, Receipt } from '../core/types';

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const act = async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { await notify('Not done', (e as Error).message); return false; } };

/** read the QR from a photo (the bill's e-invoice QR); null if none found */
async function qrFromPhoto(dataUrl: string): Promise<string | null> {
  const jsQR = (await import('jsqr')).default;
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  return jsQR(d.data, d.width, d.height)?.data ?? null;
}

export function CompanyBills() {
  const [list, setList] = useState<(Inbound & { company: string; got?: Receipt })[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = async () => {
    const cos = new Map((await db.companies.toArray()).map(c => [c.id, c.name]));
    const got = new Map((await db.receipts.toArray()).map(r => [r.inboundId, r]));
    setList((await db.inbound.toArray()).map(i => ({ ...i, company: cos.get(i.companyId) ?? '', got: got.get(i.id) })).sort((a, b) => Number(!!a.got) - Number(!!b.got) || b.date.localeCompare(a.date)));
  };
  useEffect(() => { void load(); }, []);
  if (open) return <ReceiveBill id={open} onBack={() => { setOpen(null); void load(); }} />;
  if (!list) return <div className="card muted">{'Loading…'}</div>;
  return (
    <div className="stack">
      <div className="muted">{'Bills from companies that use Hanubix arrive here with every line filled in. Check the goods, type anything short or damaged, and receive.'}</div>
      <div className="list">{list.map(i => (
        <button key={i.id} className="item tap" onClick={() => setOpen(i.id)}>
          <div className="grow" style={{ textAlign: 'left' }}><div className="t">{`${i.company} · ${i.number}`}</div><div className="s">{[day(i.date), `${i.lines.length} lines`, i.cancelled ? (i.got ? 'Cancelled by the company after you received it — talk to them' : 'Cancelled by the company') : !i.got ? 'To receive' : i.got.status === 'disputed' ? 'Received with differences (claimed)' : 'Received'].join(' · ')}</div></div>
          <div className="num">{inr(i.total)}</div><ChevronRight size={18} />
        </button>
      ))}</div>
      {!list.length && <div className="card muted">{'No company bills yet. They appear when a linked company sends an invoice.'}</div>}
    </div>
  );
}

function ReceiveBill({ id, onBack }: { id: string; onBack: () => void }) {
  const [inb, setInb] = useState<Inbound | null>(null);
  const [got, setGot] = useState<Receipt | undefined>();
  const [products, setProducts] = useState<Map<string, Product>>(new Map());
  const [qr, setQr] = useState<{ ok: boolean; text: string } | null>(null);
  const [said, setSaid] = useState('');
  const [diff, setDiff] = useState<{ short: Diff[]; damaged: Diff[]; unclear: string[] }>({ short: [], damaged: [], unclear: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { const i = (await db.inbound.get(id)) ?? null; setInb(i); setGot(await receiptOf(id)); if (i) setProducts(new Map((await db.products.bulkGet(i.lines.map(l => l.productId))).filter((p): p is Product => !!p).map(p => [p.id, p]))); })(); }, [id]);
  if (!inb) return <div className="card muted">{'Loading…'}</div>;
  const pending = !got && !inb.cancelled;
  const name = (pid: string) => products.get(pid)?.name ?? inb.lines.find(l => l.productId === pid)?.name ?? '';
  return (
    <div className="stack">
      <button className="btn small" onClick={onBack}>← {'Company bills'}</button>
      <div className="card"><h3>{inb.number}</h3><div className="muted">{[day(inb.date), inr(inb.total), inb.irn ? `IRN …${inb.irn.slice(-8)}` : 'no IRN on the bill'].join(' · ')}</div></div>
      {pending && (
        <div className="card">
          <h3><QrCode size={16} /> {'Check the bill (optional)'}</h3>
          <div className="muted" style={{ marginBottom: 6 }}>{'Photo of the QR on the paper bill: Hanubix checks it is this bill (number, value, lines, your GSTIN).'}</div>
          <PhotoButton label="" onPhoto={async url => { const txt = await qrFromPhoto(url).catch(() => null); const q = txt ? readEinvoiceQr(txt) : null; if (!q) { setQr({ ok: false, text: 'No e-invoice QR found in the photo. Try closer, in good light.' }); return; } const probs = compareQr(inb, q, (await getSettings()).gstin); setQr({ ok: !probs.length, text: probs.length ? probs.join(' · ') : 'Same bill ✓' }); }} />
          {qr && <div style={{ marginTop: 6, color: qr.ok ? 'var(--ok)' : 'var(--bad)' }}>{qr.text}</div>}
        </div>
      )}
      <div className="card">
        <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Product'}</th><th>{'Qty'}</th><th>{'Batch'}</th></tr></thead>
          <tbody>{inb.lines.map(l => <tr key={l.productId || l.name}><td>{l.name}</td><td className="num">{l.qty}{l.freeQty ? `+${l.freeQty}` : ''}</td><td>{l.batch ?? '—'}{l.expiry ? <div className="s">{`exp ${day(l.expiry)}`}</div> : null}</td></tr>)}</tbody></table></div>
      </div>
      {pending ? (
        <>
          <div className="card">
            <h3>{'Anything short or damaged?'}</h3>
            <div className="field"><textarea rows={2} value={said} placeholder={'e.g. coconut oil 1 case short, 6 sambar damaged'} onChange={e => setSaid(e.target.value)} /></div>
            <button className="btn small" disabled={!said.trim()} onClick={async () => setDiff(await readDifferences(said, inb))}>{'Read it'}</button>
            {[...diff.short.map(d => ({ ...d, k: 'Short' })), ...diff.damaged.map(d => ({ ...d, k: 'Damaged' }))].map((d, i) => <div key={i} className="item"><div className="grow">{`${d.k}: ${name(d.productId)}`}</div><div className="num">{d.qty} pcs</div></div>)}
            {diff.unclear.map(u => <div key={u} style={{ color: 'var(--warn)' }}>{`Not clear: "${u}" — say the product and short or damaged.`}</div>)}
          </div>
          <button className="btn primary big block" disabled={busy || diff.unclear.length > 0} onClick={async () => {
            const n = diff.short.length + diff.damaged.length;
            if (!await confirmBox(n ? `Receive with ${n} difference${n > 1 ? 's' : ''}?` : 'Receive everything?', n ? 'Good stock goes in. The differences become a claim to the company, with this bill\'s number and IRN.' : 'All goods go into stock and the purchase is recorded.', 'Receive')) return;
            setBusy(true); try { if (await act(() => receiveInbound(inb.id, diff.short, diff.damaged))) onBack(); } finally { setBusy(false); }
          }}><Check size={18} /> {'Receive'}</button>
        </>
      ) : <div className="card">{!got ? 'The company cancelled this bill.' : got.status === 'disputed' ? 'Received with differences — they are in Claims for this company.' : 'Received in full.'}</div>}
    </div>
  );
}

export function OrderToCompany() {
  const [cos, setCos] = useState<Company[] | null>(null);
  const [co, setCo] = useState('');
  const [cover, setCover] = useState(15);
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const [cases, setCases] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<(PrimaryOrder & { invoiced: boolean })[]>([]);
  const [busy, setBusy] = useState(false);
  const loadOrders = async (id: string) => { const inv = await db.inbound.toArray(); setOrders((await db.primaryOrders.where('companyId').equals(id).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(o => ({ ...o, invoiced: inv.some(i => i.primaryOrderId === o.id) }))); };
  useEffect(() => { (async () => { const l = (await db.companies.toArray()).filter(c => c.link?.status === 'linked'); setCos(l); if (l[0]) setCo(l[0].id); })(); }, []);
  useEffect(() => { if (!co) return; (async () => { const r = await suggestOrder(co, cover); setRows(r); setCases(Object.fromEntries(r.map(x => [x.productId, x.cases]))); await loadOrders(co); })(); }, [co, cover]);
  if (!cos) return <div className="card muted">{'Loading…'}</div>;
  if (!cos.length) return <div className="card muted">{'No linked company yet. Link one in More → Company links.'}</div>;
  const lines = rows.filter(r => (cases[r.productId] ?? 0) > 0).map(r => ({ productId: r.productId, qty: (cases[r.productId] ?? 0) * r.caseSize }));
  return (
    <div className="stack">
      {cos.length > 1 && <div className="chips">{cos.map(c => <button key={c.id} className={`chip ${c.id === co ? 'on' : ''}`} onClick={() => setCo(c.id)}>{c.name}</button>)}</div>}
      <div className="card">
        <div className="field"><label>{'Stock to hold after the goods come (days)'}</label><input inputMode="numeric" value={cover} onChange={e => setCover(Math.max(1, Math.min(90, Number(e.target.value.replace(/\D/g, '')) || 1)))} /></div>
        <div className="muted">{'Suggested cases = what you sold per day (last 30 days) × (these days + 3 days for delivery) − stock − bills not yet received.'}</div>
      </div>
      <div className="card">
        <div className="tablewrap"><table className="tbl"><thead><tr><th>{'Product'}</th><th>{'Per day'}</th><th>{'Stock'}</th><th>{'Cases'}</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.productId}><td>{r.name}{r.inTransit ? <div className="s">{`${r.inTransit} coming`}</div> : null}</td><td className="num">{r.perDay}</td><td className="num">{r.stock}</td>
            <td><input aria-label={`Cases of ${r.name}`} inputMode="numeric" style={{ width: 56 }} value={cases[r.productId] ?? 0} onChange={e => setCases({ ...cases, [r.productId]: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></td></tr>)}</tbody></table></div>
      </div>
      <button className="btn primary big block" disabled={busy || !lines.length} onClick={async () => { setBusy(true); try { if (await act(() => sendPrimaryOrder(co, lines))) { await notify('Order sent', 'The company sees it and sends the invoice here.'); await loadOrders(co); } } finally { setBusy(false); } }}><Send size={18} /> {lines.length ? `Send order · ${lines.length} products` : 'Nothing to order'}</button>
      {orders.length > 0 && <div className="list">{orders.map(o => <div key={o.id} className="item"><div className="grow"><div className="t">{day(o.date)}</div><div className="s">{`${o.lines.length} products · ${o.invoiced ? 'Invoiced by the company' : 'Sent'}`}</div></div></div>)}</div>}
    </div>
  );
}
