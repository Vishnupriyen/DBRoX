import { keepFile, type FileKind } from './myfiles';
import { saveFile } from './files';
// xlsx is loaded only when a file is read or downloaded, so the app opens fast on cheap phones
const xlsx = () => import('xlsx');
import { norm } from './match';

// Code reads Excel/CSV directly: exact and free. AI is only for photos and scanned PDFs.
export async function readSheet(file: File): Promise<string[][]> {
  const XLSX = await xlsx();
  const buf = await file.arrayBuffer();
  let wb;
  try { wb = XLSX.read(buf, { type: 'array', cellDates: true }); }
  catch (e) {
    if (/password|encrypt|CFB|ECMA-376/i.test(String((e as Error).message))) {
      throw new Error('This file is password-protected (SBI and some banks do this). Open it once, save a copy without the password, and send that — or download the statement as CSV.');
    }
    throw e;
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
  // Some banks write cells as ="05 Nov 2026" (Canara) or put line breaks inside the narration (SBI)
  return rows.map(r => r.map(c => String(c ?? '').replace(/^=\s*"?|"$/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim()));
}

export function isSheet(file: File) {
  return /\.(xlsx|xls|csv|ods)$/i.test(file.name) || /sheet|excel|csv/.test(file.type);
}
export function isImageOrPdf(file: File) {
  return /^image\//.test(file.type) || /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
}

type Synonyms = Record<string, string[]>;

// Find the header row and map each wanted field to a column, whatever the layout.
export function mapColumns(rows: string[][], wanted: Synonyms, required: string[]) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r].map(c => norm(c));
    const map: Record<string, number> = {};
    const used = new Set<number>();
    for (const [field, syns] of Object.entries(wanted)) {
      // exact header first, then whole-word match, then long-word contains
      const tests: ((c: string) => boolean)[] = [
        c => syns.includes(c),
        c => syns.some(s => ` ${c} `.includes(` ${s} `)),
        c => syns.some(s => s.length >= 5 && c.includes(s)),
      ];
      for (const test of tests) {
        const i = cells.findIndex((c, idx) => c && !used.has(idx) && test(c));
        if (i >= 0) { map[field] = i; used.add(i); break; }
      }
    }
    if (required.every(f => f in map)) return { headerRow: r, map };
  }
  return null;
}

export const num = (s: string | undefined) => {
  if (s == null) return 0;
  const v = String(s).replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/(cr|dr)$/i, '');
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function toIsoDate(s: string): string {
  const t = s.trim();
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // expiry printed as month + year only: 09/27, 09/2027, SEP-27, Sep 2027 → last day of that month
  const my = t.match(/^(\d{1,2}|[A-Za-z]{3})[/\-. ]?(\d{2}|\d{4})$/);
  if (my) {
    const mon = /\d/.test(my[1]) ? Number(my[1]) : months.indexOf(my[1].toLowerCase()) + 1;
    let y = Number(my[2]); if (y < 100) y += 2000;
    if (mon >= 1 && mon <= 12) {
      const last = new Date(Date.UTC(y, mon, 0)).getUTCDate();
      return `${y}-${String(mon).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3})[/\-. ](\d{2,4})/);
  if (m) {
    const mon = /\d/.test(m[2]) ? Number(m[2]) : months.indexOf(m[2].toLowerCase()) + 1;
    let y = Number(m[3]); if (y < 100) y += 2000;
    return `${y}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  const d = new Date(t); // "November 3, 2026" is read as local midnight: take the local day, not UTC (a day early in India)
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- purchase bill lines ----------
export interface PurchaseRow {
  item: string; code: string; hsn: string; batch: string; expiry: string; mrp: number;
  qty: number; free: number; rate: number; discount: number; gst: number; amount: number;
}

export function readPurchaseRows(rows: string[][]): PurchaseRow[] | null {
  const m = mapColumns(rows, {
    item: ['item', 'description', 'product', 'particulars', 'material', 'sku name', 'name'],
    code: ['code', 'sku', 'item code', 'material code'],
    hsn: ['hsn', 'hsn sac', 'hsn code'],
    batch: ['batch', 'batch no', 'lot'],
    expiry: ['exp', 'expiry', 'exp date', 'best before', 'bbd'],
    mrp: ['mrp'],
    qty: ['qty', 'quantity', 'billed qty', 'pcs', 'units'],
    free: ['free', 'free qty', 'sch qty', 'scheme qty'],
    rate: ['rate', 'price', 'ptr', 'unit price', 'basic rate'],
    discount: ['disc', 'discount', 'scheme amt', 'sch disc', 'td'],
    gst: ['gst', 'gst %', 'tax %', 'tax rate', 'igst', 'gst rate'],
    amount: ['amount', 'taxable', 'value', 'net amount', 'total', 'taxable value'],
  }, ['item', 'qty']);
  if (!m) return null;
  const { headerRow, map } = m;
  const get = (row: string[], f: string) => (map[f] != null ? row[map[f]] ?? '' : '');
  const out: PurchaseRow[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const item = get(row, 'item');
    const qtyCell = get(row, 'qty');
    const plus = qtyCell.match(/^\s*(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*$/); // "10+1" = 10 billed + 1 free
    const qty = plus ? Number(plus[1]) : num(qtyCell);
    if (!item || !qty || /^\s*(sub\s*|grand\s*)?total\b/i.test(item)) continue;
    out.push({
      item, code: get(row, 'code'), hsn: get(row, 'hsn'), batch: get(row, 'batch'),
      expiry: toIsoDate(get(row, 'expiry')), mrp: num(get(row, 'mrp')), qty, free: num(get(row, 'free')),
      ...(plus ? { free: Number(plus[2]) } : {}),
      rate: num(get(row, 'rate')), discount: num(get(row, 'discount')), gst: num(get(row, 'gst')),
      amount: num(get(row, 'amount')),
    });
  }
  return out;
}

// Bill number / date / supplier GSTIN / bill total from the text around the item table.
export function readBillHeader(rows: string[][]) {
  const text = rows.slice(0, 15).map(r => r.join(' ')).join('\n');
  const billNo = text.match(/(?:invoice|bill|inv)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9/\-]{3,20})/i)?.[1] ?? '';
  const dateRaw = text.match(/(?:invoice|bill|inv)?\s*date\s*[:\-]?\s*([0-9]{1,2}[/\-.][0-9A-Za-z]{1,3}[/\-.][0-9]{2,4})/i)?.[1] ?? '';
  const gstin = text.match(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/)?.[1] ?? '';
  let total = 0;
  for (const r of rows) {
    if (r.some(c => /^\s*(grand\s*)?total\b/i.test(c))) {
      const nums = r.map(c => num(c)).filter(x => x > 0);
      if (nums.length) total = nums[nums.length - 1];
    }
  }
  return { billNo, date: dateRaw ? toIsoDate(dateRaw) : '', gstin, total };
}

// ---------- bank statements (any Indian bank layout with a header row) ----------
export interface BankRow { date: string; narration: string; credit: number; debit: number; ref: string }

export function readBankRows(rows: string[][]): BankRow[] | null {
  const m = mapColumns(rows, {
    date: ['txn date', 'transaction date', 'value date', 'date', 'tran date', 'posting date'],
    narration: ['narration', 'description', 'particulars', 'remarks', 'details', 'transaction details'],
    ref: ['ref no', 'chq ref', 'cheque no', 'chq no', 'utr', 'reference', 'ref'],
    credit: ['credit', 'deposit', 'cr amount', 'deposits', 'cr'],
    debit: ['debit', 'withdrawal', 'dr amount', 'withdrawals', 'dr'],
    amount: ['amount', 'txn amount'],
    crdr: ['cr dr', 'dr cr', 'type'],
  }, ['date', 'narration']);
  if (!m) return null;
  const { headerRow, map } = m;
  const get = (row: string[], f: string) => (map[f] != null ? row[map[f]] ?? '' : '');
  const out: BankRow[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const date = toIsoDate(get(row, 'date'));
    if (!date) continue;
    let credit = num(get(row, 'credit'));
    let debit = num(get(row, 'debit'));
    if (!credit && !debit && map.amount != null) {
      const a = num(get(row, 'amount'));
      const t = norm(get(row, 'crdr') || get(row, 'amount'));
      if (/dr|debit|withdraw/.test(t)) debit = Math.abs(a); else credit = Math.abs(a);
    }
    const narration = get(row, 'narration');
    const refInText = narration.match(/\b(\d{12})\b/)?.[1] ?? '';
    out.push({ date, narration, credit, debit, ref: get(row, 'ref') || refInText });
  }
  return out;
}

// ---------- master lists (onboarding: upload Excel, approve) ----------
export function readProductRows(rows: string[][]) {
  const m = mapColumns(rows, {
    name: ['product', 'item', 'name', 'description', 'sku name'],
    company: ['company', 'brand', 'manufacturer', 'principal'],
    code: ['code', 'sku', 'item code'],
    hsn: ['hsn'], gst: ['gst', 'tax'], mrp: ['mrp'], rate: ['rate', 'selling', 'price', 'ptr'],
    purchase: ['purchase', 'cost', 'landing'], caseSize: ['case', 'pack', 'upc', 'case size', 'units per case'],
  }, ['name']);
  if (!m) return null;
  const g = (r: string[], f: string) => (m.map[f] != null ? r[m.map[f]] ?? '' : '');
  return rows.slice(m.headerRow + 1).filter(r => g(r, 'name')).map(r => ({
    name: g(r, 'name'), company: g(r, 'company'), code: g(r, 'code'), hsn: g(r, 'hsn'), gst: num(g(r, 'gst')),
    mrp: num(g(r, 'mrp')), rate: num(g(r, 'rate')), purchase: num(g(r, 'purchase')),
    caseSize: num(g(r, 'caseSize')) || 1,
  }));
}

export function readShopRows(rows: string[][]) {
  const m = mapColumns(rows, {
    name: ['shop', 'party', 'customer', 'retailer', 'outlet', 'name'],
    owner: ['owner', 'contact person'], phone: ['phone', 'mobile', 'contact'], gstin: ['gstin', 'gst no', 'gst'],
    area: ['area', 'town', 'village', 'city'], beat: ['beat', 'route', 'day'], creditLimit: ['credit limit', 'limit'],
    creditDays: ['credit days', 'days'], address: ['address'],
  }, ['name']);
  if (!m) return null;
  const g = (r: string[], f: string) => (m.map[f] != null ? r[m.map[f]] ?? '' : '');
  return rows.slice(m.headerRow + 1).filter(r => g(r, 'name')).map(r => ({
    name: g(r, 'name'), owner: g(r, 'owner'), phone: g(r, 'phone'), gstin: g(r, 'gstin').toUpperCase(),
    area: g(r, 'area'), beat: g(r, 'beat'), creditLimit: num(g(r, 'creditLimit')),
    creditDays: num(g(r, 'creditDays')) || 7, address: g(r, 'address'),
  }));
}

// ---------- opening balances (the day a distributor starts on Hanubix) ----------
const isTotalRow = (s: string) => /^\s*(sub\s*|grand\s*)?total\b/i.test(s);
/** old dues per shop: bill-wise (bill no + date + balance) or one amount per shop (with a date, or the "as on" date) */
export function readOpeningDueRows(rows: string[][]) {
  const m = mapColumns(rows, {
    shop: ['shop', 'shop name', 'party', 'party name', 'customer', 'retailer', 'outlet', 'name'],
    ref: ['bill no', 'bill number', 'invoice no', 'inv no', 'voucher no', 'ref no', 'ref', 'bill'],
    date: ['date', 'bill date', 'invoice date', 'inv date'],
    amount: ['balance', 'due', 'pending', 'outstanding', 'closing balance', 'balance amount', 'bal amt', 'amount'],
  }, ['shop', 'amount']);
  if (!m) return null;
  const g = (r: string[], f: string) => (m.map[f] != null ? r[m.map[f]] ?? '' : '');
  return rows.slice(m.headerRow + 1).filter(r => g(r, 'shop') && !isTotalRow(g(r, 'shop')) && g(r, 'amount').trim() !== '')
    .map(r => ({ shop: g(r, 'shop').trim(), ref: g(r, 'ref').trim(), date: toIsoDate(g(r, 'date')), amount: num(g(r, 'amount')) }));
}
/** opening stock per product and batch (no purchase bill: nothing is owed to the company for it) */
export function readOpeningStockRows(rows: string[][]) {
  const m = mapColumns(rows, {
    item: ['product', 'item', 'item name', 'product name', 'description', 'sku name', 'name'],
    code: ['code', 'sku', 'item code'],
    batch: ['batch', 'batch no', 'lot'],
    expiry: ['expiry', 'exp', 'exp date', 'best before'],
    mrp: ['mrp'],
    qty: ['qty', 'quantity', 'stock', 'pcs', 'closing stock', 'units'],
    rate: ['rate', 'buy rate', 'purchase rate', 'cost', 'landing'],
  }, ['item', 'qty']);
  if (!m) return null;
  const g = (r: string[], f: string) => (m.map[f] != null ? r[m.map[f]] ?? '' : '');
  return rows.slice(m.headerRow + 1).filter(r => g(r, 'item') && !isTotalRow(g(r, 'item')) && g(r, 'qty').trim() !== '')
    .map(r => ({ item: g(r, 'item').trim(), code: g(r, 'code').trim(), batch: g(r, 'batch').trim(), expiry: toIsoDate(g(r, 'expiry')), mrp: num(g(r, 'mrp')), qty: num(g(r, 'qty')), rate: num(g(r, 'rate')) }));
}

// Excel out: any table the user sees can be downloaded.
export async function downloadSheet(name: string, header: string[], rows: (string | number)[][], keep = true, kind?: FileKind) {
  const XLSX = await xlsx();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  await saveWorkbook(XLSX, wb, name);
  if (keep) void keepFile(name, [{ name, header, rows }], kind).catch(() => {}); // every Excel made is kept in My files (14 Nov 2026)
}

export async function downloadWorkbook(name: string, sheets: { name: string; header: string[]; rows: (string | number)[][] }[], keep = true, kind?: FileKind) {
  const XLSX = await xlsx();
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.header, ...s.rows]), s.name.slice(0, 31));
  await saveWorkbook(XLSX, wb, name);
  if (keep) void keepFile(name, sheets, kind).catch(() => {});
}
// one way to save, browser or Android app (core/files.ts)
async function saveWorkbook(XLSX: Awaited<ReturnType<typeof xlsx>>, wb: unknown, name: string) {
  const bytes = XLSX.write(wb as never, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  await saveFile(`${name}.xlsx`, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  return saveFile(filename, text, type);
}
