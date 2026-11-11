import { inr, showDate } from '../core/i18n';
import { printPage } from '../core/files';
import { useEffect, useState } from 'react';
import { db, getSettings, localDay } from '../core/db';
import { r2 } from '../core/ledger';
import { balanceBefore, markPrinted } from '../core/credit';
import { cnTaxLines, shopStateCode, stateLabel, UQC } from '../core/gst';
import type { Company, CreditNote, Invoice, Settings, Shop } from '../core/types';

type Row = { name: string; hsn: string; qty: number; free: number; mrp?: number; rate: number; discount: number; taxable: number; gst: number; total: number; batches?: string };
type Tax = { gst: number; taxable: number; cgst: number; sgst: number; igst: number };

// Office printing on a normal printer (A4 / A5 / dot-matrix) or Save as PDF. No Bluetooth.
// One layout for the tax invoice and the credit note (Rule 46 / Rule 53 fields). Printing marks the bill printed (core).
export function PrintBill({ invoice, creditNote, onClose }: { invoice?: Invoice; creditNote?: CreditNote; onClose: () => void }) {
  const [ctx, setCtx] = useState<{ s: Settings; shop: Shop; co?: Company; oldBal: number; inv?: Invoice } | null>(null);
  useEffect(() => {
    (async () => {
      const s = await getSettings();
      const inv = invoice ?? (creditNote ? await db.invoices.get(creditNote.invoiceId) : undefined);
      const shop = (await db.shops.get((invoice ?? creditNote)!.shopId))!;
      const co = await db.companies.get((invoice ?? creditNote)!.companyId);
      setCtx({ s, shop, co, inv, oldBal: invoice ? Math.max(0, Math.round(await balanceBefore(invoice))) : 0 });
    })();
  }, [invoice, creditNote]);
  if (!ctx) return null;
  const { s, shop, co, oldBal, inv } = ctx;
  const doc = invoice ?? creditNote!;
  const width = s.billFormat === 'A4' ? 760 : 540;
  const pos = shopStateCode(shop, s);
  const rows: Row[] = invoice
    ? invoice.lines.map(l => ({ name: l.name, hsn: l.hsn, qty: l.qty, free: l.freeQty, mrp: l.mrp, rate: l.rate, discount: l.discount, taxable: l.taxable, gst: l.gst, total: l.total, batches: l.batches.map(b => `${b.batch} exp ${b.expiry}`).join(', ') }))
    : creditNote!.lines.map(cl => { const l = inv?.lines[cl.line ?? -1] ?? inv?.lines.find(x => x.productId === cl.productId); return { name: l?.name ?? '', hsn: cl.hsn ?? l?.hsn ?? '', qty: cl.qty, free: cl.freeQty ?? 0, mrp: l?.mrp, rate: l?.rate ?? 0, discount: 0, taxable: cl.taxable ?? r2(cl.amount / (1 + (l?.gst ?? 0) / 100)), gst: cl.gst ?? l?.gst ?? 0, total: cl.amount }; });
  // tax by rate: CGST and SGST each at half the rate, or IGST at the full rate
  const byRate = new Map<number, Tax>();
  const add = (t: Tax) => { const x = byRate.get(t.gst) ?? { gst: t.gst, taxable: 0, cgst: 0, sgst: 0, igst: 0 }; x.taxable = r2(x.taxable + t.taxable); x.cgst = r2(x.cgst + t.cgst); x.sgst = r2(x.sgst + t.sgst); x.igst = r2(x.igst + t.igst); byRate.set(t.gst, x); };
  if (invoice) invoice.lines.forEach(add); else cnTaxLines(creditNote!, inv).forEach(add);
  const taxes = [...byRate.values()].sort((a, b) => a.gst - b.gst);
  const inter = taxes.some(t => t.igst > 0);
  const total = doc.total, roundOff = invoice ? invoice.roundOff : creditNote!.roundOff ?? 0;
  const taxable = r2(taxes.reduce((a, t) => a + t.taxable, 0));
  const print = async () => { if (invoice) await markPrinted(invoice.id); await printPage(); };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, overflow: 'auto', padding: 16 }}>
      <div className="row noprint" style={{ maxWidth: width, margin: '0 auto 8px' }}>
        <button className="btn primary" onClick={() => void print()}>🖨 Print / Save PDF</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="bill" style={{ maxWidth: width, margin: '0 auto', fontFamily: s.billFormat === 'dotmatrix' ? 'monospace' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{s.firmName}</div>
            <div>{s.address}</div>
            <div>GSTIN: {s.gstin} · State: {stateLabel(s.stateCode || '33')} · Ph: {s.phone}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10 }}>ORIGINAL FOR RECIPIENT</div>
            <div style={{ fontWeight: 800 }}>{invoice ? 'TAX INVOICE' : 'CREDIT NOTE'}{invoice?.cancelled ? ' — CANCELLED' : ''}</div>
            {co && <div>{co.name}</div>}
            <div>No: <b>{doc.number}</b></div>
            <div>Date: {doc.date.split('-').reverse().join('-')}</div>
            {creditNote && <div>Against invoice <b>{creditNote.invoiceNumber ?? inv?.number ?? ''}</b> dated {(creditNote.invoiceDate ?? inv?.date ?? '').split('-').reverse().join('-')}</div>}
          </div>
        </div>
        {invoice?.cancelled && <div style={{ margin: '8px 0', padding: 6, border: '1px solid #999', fontWeight: 800 }}>CANCELLED on {showDate(localDay(invoice.cancelled.at))} — {invoice.cancelled.reason}. This bill is not payable.</div>}
        <div style={{ margin: '8px 0', padding: 6, border: '1px solid #999' }}>
          <b>{invoice ? 'Bill to' : 'Recipient'}: {shop.name}</b> · {shop.area}{shop.address ? ` · ${shop.address}` : ''}{shop.gstin ? ` · GSTIN ${shop.gstin}` : ' · Unregistered'} · State: {stateLabel(pos)}
          <div>Place of supply: {stateLabel(pos)} · Tax payable on reverse charge: No{creditNote ? ` · Reason: ${creditNote.reason}` : ''}</div>
        </div>
        <table>
          <thead>
            <tr><th>#</th><th>Item</th><th>HSN</th><th className="r">Qty ({UQC})</th><th className="r">Free</th><th className="r">MRP</th><th className="r">Rate</th><th className="r">Disc</th><th className="r">Taxable</th><th className="r">GST%</th><th className="r">Amount</th></tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{l.name}{l.batches && <div style={{ fontSize: 10, color: '#555' }}>{l.batches}</div>}</td>
                <td>{l.hsn}</td><td className="r">{l.qty}</td><td className="r">{l.free || ''}</td><td className="r">{l.mrp ?? ''}</td>
                <td className="r">{l.rate.toFixed(2)}</td><td className="r">{l.discount ? l.discount.toFixed(2) : ''}</td>
                <td className="r">{l.taxable.toFixed(2)}</td><td className="r">{l.gst}</td><td className="r">{l.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th className="r">GST rate</th><th className="r">Taxable</th>{inter ? <th className="r">IGST</th> : <><th className="r">CGST</th><th className="r">SGST</th></>}</tr></thead>
          <tbody>
            {taxes.map(t => (
              <tr key={t.gst}><td className="r">{t.gst}%</td><td className="r">{t.taxable.toFixed(2)}</td>
                {inter ? <td className="r">@{t.gst}% {t.igst.toFixed(2)}</td> : <><td className="r">@{t.gst / 2}% {t.cgst.toFixed(2)}</td><td className="r">@{t.gst / 2}% {t.sgst.toFixed(2)}</td></>}</tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div>Amount in words: <b>{rupeesInWords(total)}</b></div>
            {invoice && invoice.schemeSaving > 0 && <div>Scheme savings: <b>₹{invoice.schemeSaving.toFixed(2)}</b></div>}
            {invoice && !invoice.cancelled && <><div>Previous balance: {inr(oldBal)}</div><div>Total due: <b>{inr((oldBal + invoice.total))}</b></div></>}
          </div>
          <table style={{ width: 220 }}>
            <tbody>
              <tr><td>Taxable</td><td className="r">{taxable.toFixed(2)}</td></tr>
              {!inter && <tr><td>CGST</td><td className="r">{r2(taxes.reduce((a, t) => a + t.cgst, 0)).toFixed(2)}</td></tr>}
              {!inter && <tr><td>SGST</td><td className="r">{r2(taxes.reduce((a, t) => a + t.sgst, 0)).toFixed(2)}</td></tr>}
              {inter && <tr><td>IGST</td><td className="r">{r2(taxes.reduce((a, t) => a + t.igst, 0)).toFixed(2)}</td></tr>}
              <tr><td>Round off</td><td className="r">{roundOff.toFixed(2)}</td></tr>
              <tr><td><b>Total</b></td><td className="r"><b>₹{total.toFixed(2)}</b></td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between' }}>
          <span>{invoice ? 'Goods received in good condition' : 'Received the credit'}</span><span style={{ textAlign: 'right' }}>For {s.firmName}<br /><br />Authorised signatory</span>
        </div>
      </div>
    </div>
  );
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n: number) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function three(n: number) { return n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + two(n % 100) : ''}` : two(n); }
export function rupeesInWords(amount: number) {
  let n = Math.round(amount);
  if (n === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  return `Rupees ${parts.join(' ')} Only`;
}
