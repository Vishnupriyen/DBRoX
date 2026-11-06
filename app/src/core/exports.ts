// TESRAX Accounts + TESRAX Claim Prep outputs. Pure code: exact, repeatable, explainable.
import { ChangeSet, db, getSettings } from './db';
import { r2 } from './ledger';
import { downloadText, downloadWorkbook } from './readers';
import type { Reply } from './engine';
import type { Invoice } from './types';

const inMonth = (d: string, m: string) => d.startsWith(m);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tdate = (d: string) => d.replace(/-/g, '');
const dmy = (d: string) => d.split('-').reverse().join('/');

// ---------------------------------------------------------------- Tally (XML import file)
export async function tallyXml(month: string): Promise<{ xml: string; counts: Record<string, number> }> {
  const s = await getSettings();
  const invs = (await db.invoices.toArray()).filter(i => inMonth(i.date, month) && !i.cancelled);
  const pays = (await db.payments.toArray()).filter(p => inMonth(p.date, month) && p.status === 'ok');
  const cns = (await db.creditNotes.toArray()).filter(c => inMonth(c.date, month));
  const exps = (await db.expenses.toArray()).filter(e => inMonth(e.date, month));
  const shops = new Map((await db.shops.toArray()).map(x => [x.id, x]));
  const party = (id: string) => shops.get(id)?.name ?? 'Cash Sales';
  const entry = (ledger: string, amount: number, debit: boolean) =>
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${(debit ? -1 : 1) * r2(amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const voucher = (type: string, date: string, no: string, partyName: string, entries: string[], narration = '') =>
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${tdate(date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(no)}</VOUCHERNUMBER><PARTYLEDGERNAME>${esc(partyName)}</PARTYLEDGERNAME><NARRATION>${esc(narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${entries.join('')}</VOUCHER></TALLYMESSAGE>`;

  const ledgers = new Map<string, string>(); // name → group
  const out: string[] = [];
  for (const i of invs) {
    const p = party(i.shopId); ledgers.set(p, 'Sundry Debtors');
    const byRate = new Map<number, number>();
    for (const l of i.lines) byRate.set(l.gst, r2((byRate.get(l.gst) ?? 0) + l.taxable));
    const e = [entry(p, i.total, true)];
    for (const [rate, amt] of byRate) { const n = `Sales @${rate}%`; ledgers.set(n, 'Sales Accounts'); e.push(entry(n, amt, false)); }
    if (i.cgst) { ledgers.set('Output CGST', 'Duties & Taxes'); e.push(entry('Output CGST', i.cgst, false)); }
    if (i.sgst) { ledgers.set('Output SGST', 'Duties & Taxes'); e.push(entry('Output SGST', i.sgst, false)); }
    if (i.igst) { ledgers.set('Output IGST', 'Duties & Taxes'); e.push(entry('Output IGST', i.igst, false)); }
    if (i.roundOff) { ledgers.set('Round Off', 'Indirect Expenses'); e.push(entry('Round Off', Math.abs(i.roundOff), i.roundOff < 0)); }
    out.push(voucher('Sales', i.date, i.number, p, e, `Hanubix ${i.kind}`));
  }
  for (const c of cns) {
    const p = party(c.shopId);
    ledgers.set('Sales Returns', 'Sales Accounts');
    out.push(voucher('Credit Note', c.date, c.number, p, [entry('Sales Returns', c.total, true), entry(p, c.total, false)], c.reason));
  }
  for (const pay of pays) {
    const p = party(pay.shopId);
    const cashLedger = pay.mode === 'cash' ? 'Cash' : 'Bank Account';
    ledgers.set(cashLedger, pay.mode === 'cash' ? 'Cash-in-Hand' : 'Bank Accounts');
    out.push(voucher('Receipt', pay.date, pay.id.slice(-8), p, [entry(cashLedger, pay.amount, true), entry(p, pay.amount, false)], `${pay.mode} ${pay.ref ?? ''}`));
  }
  for (const ex of exps) {
    const led = ex.category === 'Drawings' ? 'Drawings' : ex.category;
    ledgers.set(led, ex.category === 'Drawings' ? 'Capital Account' : 'Indirect Expenses'); ledgers.set('Cash', 'Cash-in-Hand');
    out.push(voucher('Payment', ex.date, ex.id.slice(-8), 'Cash', [entry(led, ex.amount, true), entry('Cash', ex.amount, false)], ex.note ?? ''));
  }
  const masters = [...ledgers.entries()].map(([name, parent]) =>
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT></LEDGER></TALLYMESSAGE>`);
  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(s.firmName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${masters.join('')}${out.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
  return { xml, counts: { sales: invs.length, creditNotes: cns.length, receipts: pays.length, expenses: exps.length } };
}

export async function exportTally(month: string): Promise<Reply> {
  const { xml, counts } = await tallyXml(month);
  return {
    text: `Tally file for ${month}: ${counts.sales} sales, ${counts.creditNotes} credit notes, ${counts.receipts} receipts, ${counts.expenses} expenses. In Tally: Import → Vouchers → pick this file. New party ledgers are created under Sundry Debtors.`,
    table: { name: `Tally ${month}`, columns: ['Type', 'Count'], rows: Object.entries(counts) },
    actions: [{ label: 'Download Tally XML', run: () => downloadText(`Hanubix-Tally-${month}.xml`, xml, 'application/xml') }],
  };
}

// ---------------------------------------------------------------- GSTR-1 (Excel in the offline-tool layout)
export async function exportGstr1(month: string): Promise<Reply> {
  const s = await getSettings();
  const invs = (await db.invoices.toArray()).filter(i => inMonth(i.date, month) && !i.cancelled);
  const shops = new Map((await db.shops.toArray()).map(x => [x.id, x]));
  const cns = (await db.creditNotes.toArray()).filter(c => inMonth(c.date, month));
  const pos = (i: Invoice) => `${(shops.get(i.shopId)?.gstin ?? s.stateCode).slice(0, 2)}-${stateName((shops.get(i.shopId)?.gstin ?? s.stateCode).slice(0, 2))}`;
  const b2b: (string | number)[][] = [];
  const b2cs = new Map<string, number>();
  const hsn = new Map<string, { desc: string; qty: number; value: number; taxable: number; igst: number; cgst: number; sgst: number; rate: number }>();
  for (const i of invs) {
    const byRate = new Map<number, number>();
    for (const l of i.lines) {
      byRate.set(l.gst, r2((byRate.get(l.gst) ?? 0) + l.taxable));
      const k = `${l.hsn}|${l.gst}`;
      const h = hsn.get(k) ?? { desc: l.name, qty: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, rate: l.gst };
      h.qty += l.qty + l.freeQty; h.value = r2(h.value + l.total); h.taxable = r2(h.taxable + l.taxable);
      h.igst = r2(h.igst + l.igst); h.cgst = r2(h.cgst + l.cgst); h.sgst = r2(h.sgst + l.sgst); hsn.set(k, h);
    }
    for (const [rate, taxable] of byRate) {
      if (i.kind === 'B2B') b2b.push([shops.get(i.shopId)?.gstin ?? '', shops.get(i.shopId)?.name ?? '', i.number, dmy(i.date), i.total, pos(i), 'N', '', 'Regular B2B', '', rate, taxable, 0]);
      else { const k = `${pos(i)}|${rate}`; b2cs.set(k, r2((b2cs.get(k) ?? 0) + taxable)); }
    }
  }
  const cdnr = cns.filter(c => shops.get(c.shopId)?.gstin).map(c => {
    const inv = invs.find(i => i.id === c.invoiceId);
    const rate = inv?.lines.find(l => c.lines.some(x => x.productId === l.productId))?.gst ?? 0;
    const taxable = r2(c.total / (1 + rate / 100));
    return [shops.get(c.shopId)?.gstin ?? '', shops.get(c.shopId)?.name ?? '', c.number, dmy(c.date), 'C', pos(inv ?? ({ shopId: c.shopId } as Invoice)), 'N', 'Regular B2B', c.total, '', rate, taxable, 0];
  });
  const sheets = [
    { name: 'b2b', header: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'], rows: b2b },
    { name: 'b2cs', header: ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], rows: [...b2cs.entries()].map(([k, v]) => { const [p, r] = k.split('|'); return ['OE', p, '', Number(r), v, 0, '']; }) },
    { name: 'cdnr', header: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'], rows: cdnr },
    { name: 'hsn', header: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'], rows: [...hsn.entries()].map(([k, h]) => [k.split('|')[0], h.desc, 'PCS-PIECES', h.qty, h.value, h.rate, h.taxable, h.igst, h.cgst, h.sgst, 0]) },
  ];
  const tot = r2(invs.reduce((a, i) => a + i.taxable, 0));
  return {
    text: `GSTR-1 for ${month}: ${b2b.length} B2B lines, ${b2cs.size} B2C summary lines, ${hsn.size} HSN lines, taxable ₹${tot.toLocaleString('en-IN')}. Give this to your CA or load it in the GST offline tool.`,
    table: { name: `GSTR1 ${month}`, columns: sheets[3].header, rows: sheets[3].rows },
    actions: [{ label: 'Download GSTR-1 Excel', run: () => downloadWorkbook(`Hanubix-GSTR1-${month}`, sheets) }],
  };
}

// ---------------------------------------------------------------- e-invoice JSON (NIC schema 1.1, bulk upload)
export async function exportEinvoice(month: string): Promise<Reply> {
  const s = await getSettings();
  const shops = new Map((await db.shops.toArray()).map(x => [x.id, x]));
  const invs = (await db.invoices.toArray()).filter(i => inMonth(i.date, month) && !i.cancelled && i.kind === 'B2B');
  const pin = (addr?: string) => Number(addr?.match(/\b(6\d{5})\b/)?.[1] ?? 0);
  const sellerPin = pin(s.address);
  const missing: string[] = [];
  const docs = invs.map(i => {
    const shop = shops.get(i.shopId)!;
    if (!pin(shop.address)) missing.push(shop.name);
    return {
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
      DocDtls: { Typ: 'INV', No: i.number, Dt: dmy(i.date) },
      SellerDtls: { Gstin: s.gstin, LglNm: s.firmName, Addr1: s.address.slice(0, 100), Loc: s.address.split(',').slice(-2, -1)[0]?.trim() || 'Tamil Nadu', Pin: sellerPin, Stcd: s.stateCode },
      BuyerDtls: { Gstin: shop.gstin, LglNm: shop.name, Pos: shop.gstin!.slice(0, 2), Addr1: (shop.address || shop.area).slice(0, 100), Loc: shop.area || 'NA', Pin: pin(shop.address), Stcd: shop.gstin!.slice(0, 2) },
      ItemList: i.lines.map((l, k) => ({
        SlNo: String(k + 1), PrdDesc: l.name, IsServc: 'N', HsnCd: l.hsn, Qty: l.qty, FreeQty: l.freeQty, Unit: 'PCS',
        UnitPrice: l.rate, TotAmt: l.gross, Discount: l.discount, AssAmt: l.taxable, GstRt: l.gst,
        IgstAmt: l.igst, CgstAmt: l.cgst, SgstAmt: l.sgst, TotItemVal: l.total,
      })),
      ValDtls: { AssVal: i.taxable, CgstVal: i.cgst, SgstVal: i.sgst, IgstVal: i.igst, RndOffAmt: i.roundOff, TotInvVal: i.total },
    };
  });
  // Checks from the e-invoice schema: HSN 6 or 8 digits, bill no ≤16 chars (no leading 0, / or -), names ≥3 letters
  const shortHsn = new Set<string>();
  const badNo: string[] = [];
  for (const i of invs) {
    for (const l of i.lines) if (!/^(\d{6}|\d{8})$/.test(l.hsn)) shortHsn.add(`${l.name} (${l.hsn || 'blank'})`);
    if (!/^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/.test(i.number)) badNo.push(i.number);
  }
  const shortNames = invs.map(i => shops.get(i.shopId)!).filter(x => x.name.trim().length < 3 || (x.area || '').trim().length < 3).map(x => x.name);
  const warn = [
    !sellerPin ? 'Your firm address has no 6-digit PIN code (More → Settings).' : '',
    missing.length ? `PIN code missing in address for: ${[...new Set(missing)].join(', ')}.` : '',
    shortHsn.size ? `HSN must be 6 or 8 digits for e-invoice: ${[...shortHsn].slice(0, 8).join(', ')}${shortHsn.size > 8 ? '…' : ''}.` : '',
    badNo.length ? `Bill numbers the portal will reject: ${badNo.slice(0, 5).join(', ')}.` : '',
    shortNames.length ? `Shop name or area too short (min 3 letters): ${[...new Set(shortNames)].join(', ')}.` : '',
  ].filter(Boolean).join('\n⚠ ');
  return {
    text: `${docs.length} B2B bill(s) for ${month} in the government e-invoice format. Upload this file in the free bulk tool on the e-invoice portal, then download the IRN file.` + (warn ? `\n⚠ ${warn}` : ''),
    tone: warn ? 'warn' : 'ok',
    table: { name: `E-invoice ${month}`, columns: ['Bill', 'Date', 'Buyer', 'Value ₹'], rows: invs.map(i => [i.number, i.date, shops.get(i.shopId)?.name ?? '', i.total]) },
    actions: [{ label: 'Download e-invoice JSON', run: () => downloadText(`Hanubix-einvoice-${month}.json`, JSON.stringify(docs, null, 2)) }],
  };
}

// ---------------------------------------------------------------- TESRAX Claim Prep
export async function exportClaims(month: string): Promise<Reply> {
  const entries = (await db.claimEntries.toArray()).filter(e => e.month === month);
  const companies = await db.companies.toArray();
  const products = new Map((await db.products.toArray()).map(p => [p.id, p]));
  const invs = new Map((await db.invoices.toArray()).map(i => [i.id, i]));
  const claims = await db.claims.toArray();
  const rows: (string | number)[][] = [];
  const sheets: { name: string; header: string[]; rows: (string | number)[][] }[] = [];
  const cs = new ChangeSet();
  for (const c of companies) {
    const es = entries.filter(e => e.companyId === c.id);
    if (!es.length) continue;
    const scheme = r2(es.filter(e => e.kind === 'scheme').reduce((a, e) => a + e.amount, 0));
    const damage = r2(es.filter(e => e.kind !== 'scheme').reduce((a, e) => a + e.amount, 0));
    const total = r2(scheme + damage);
    rows.push([c.name, scheme, damage, total]);
    const existing = claims.find(x => x.companyId === c.id && x.month === month);
    if (!existing) cs.put('claims', { companyId: c.id, month, amount: total, status: 'draft' }, 'claim draft');
    else if (existing.status === 'draft') cs.put('claims', { ...existing, amount: total }, 'claim refresh');
    sheets.push({
      name: `${c.code} ${month}`,
      header: ['Type', 'Bill / note', 'Date', 'Product', 'Qty', 'Claim ₹', 'Scheme / reason'],
      rows: es.map(e => [e.kind, e.invoiceId ? invs.get(e.invoiceId)?.number ?? '' : 'Godown entry', e.invoiceId ? invs.get(e.invoiceId)?.date ?? '' : e.createdAt.slice(0, 10), products.get(e.productId ?? '')?.name ?? '', e.qty, e.amount, e.note ?? '']),
    });
  }
  if (cs.size) await cs.commit('Claim drafts');
  return {
    text: rows.length ? `Claims for ${month}: ₹${r2(rows.reduce((a, r) => a + Number(r[3]), 0)).toLocaleString('en-IN')} across ${rows.length} compan${rows.length > 1 ? 'ies' : 'y'}. Every line has its bill as proof.` : `No claim lines for ${month}.`,
    table: { name: `Claims ${month}`, columns: ['Company', 'Scheme ₹', 'Damage/expiry ₹', 'Total ₹'], rows },
    actions: sheets.length ? [{ label: 'Download claim file', run: () => downloadWorkbook(`Hanubix-Claims-${month}`, [{ name: 'Summary', header: ['Company', 'Scheme ₹', 'Damage/expiry ₹', 'Total ₹'], rows }, ...sheets]) }] : [],
  };
}

const STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
function stateName(code: string) { return STATES[code] ?? 'Tamil Nadu'; }
