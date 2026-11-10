import { inr } from '../core/i18n';
import { printPage } from '../core/files';
import { useEffect, useState } from 'react';
import { db, getSettings } from '../core/db';
import { shopOutstanding } from '../core/ledger';
import type { Company, Invoice, Settings, Shop } from '../core/types';

// Office printing on a normal printer (A4 / A5 / dot-matrix) or Save as PDF. No Bluetooth.
export function PrintBill({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [ctx, setCtx] = useState<{ s: Settings; shop: Shop; co: Company; oldBal: number } | null>(null);
  useEffect(() => {
    (async () => {
      const s = await getSettings();
      const shop = (await db.shops.get(invoice.shopId))!;
      const co = (await db.companies.get(invoice.companyId))!;
      const out = await shopOutstanding(shop.id);
      setCtx({ s, shop, co, oldBal: Math.max(0, Math.round(out.total - invoice.total)) });
    })();
  }, [invoice]);
  if (!ctx) return null;
  const { s, shop, co, oldBal } = ctx;
  const width = s.billFormat === 'A4' ? 760 : 540;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, overflow: 'auto', padding: 16 }}>
      <div className="row noprint" style={{ maxWidth: width, margin: '0 auto 8px' }}>
        <button className="btn primary" onClick={() => void printPage()}>🖨 Print / Save PDF</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="bill" style={{ maxWidth: width, margin: '0 auto', fontFamily: s.billFormat === 'dotmatrix' ? 'monospace' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{s.firmName}</div>
            <div>{s.address}</div>
            <div>GSTIN: {s.gstin} · Ph: {s.phone}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800 }}>TAX INVOICE</div>
            <div>{co.name}</div>
            <div>No: <b>{invoice.number}</b></div>
            <div>Date: {invoice.date.split('-').reverse().join('-')}</div>
          </div>
        </div>
        <div style={{ margin: '8px 0', padding: 6, border: '1px solid #999' }}>
          <b>To: {shop.name}</b> · {shop.area}{shop.address ? ` · ${shop.address}` : ''}{shop.gstin ? ` · GSTIN ${shop.gstin}` : ''} · {invoice.kind}
        </div>
        <table>
          <thead>
            <tr><th>#</th><th>Item</th><th>HSN</th><th className="r">Qty</th><th className="r">Free</th><th className="r">MRP</th><th className="r">Rate</th><th className="r">Disc</th><th className="r">Taxable</th><th className="r">GST%</th><th className="r">Amount</th></tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{l.name}<div style={{ fontSize: 10, color: '#555' }}>{l.batches.map(b => `${b.batch} exp ${b.expiry}`).join(', ')}</div></td>
                <td>{l.hsn}</td><td className="r">{l.qty}</td><td className="r">{l.freeQty || ''}</td><td className="r">{l.mrp}</td>
                <td className="r">{l.rate.toFixed(2)}</td><td className="r">{l.discount ? l.discount.toFixed(2) : ''}</td>
                <td className="r">{l.taxable.toFixed(2)}</td><td className="r">{l.gst}</td><td className="r">{l.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div>Amount in words: <b>{rupeesInWords(invoice.total)}</b></div>
            {invoice.schemeSaving > 0 && <div>Scheme savings: <b>₹{invoice.schemeSaving.toFixed(2)}</b></div>}
            <div>Previous balance: {inr(oldBal)}</div>
            <div>Total due: <b>{inr((oldBal + invoice.total))}</b></div>
          </div>
          <table style={{ width: 220 }}>
            <tbody>
              <tr><td>Taxable</td><td className="r">{invoice.taxable.toFixed(2)}</td></tr>
              {invoice.cgst > 0 && <tr><td>CGST</td><td className="r">{invoice.cgst.toFixed(2)}</td></tr>}
              {invoice.sgst > 0 && <tr><td>SGST</td><td className="r">{invoice.sgst.toFixed(2)}</td></tr>}
              {invoice.igst > 0 && <tr><td>IGST</td><td className="r">{invoice.igst.toFixed(2)}</td></tr>}
              <tr><td>Round off</td><td className="r">{invoice.roundOff.toFixed(2)}</td></tr>
              <tr><td><b>Total</b></td><td className="r"><b>₹{invoice.total.toFixed(2)}</b></td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between' }}>
          <span>Goods received in good condition</span><span>For {s.firmName}</span>
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
