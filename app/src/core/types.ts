// Hanubix core data types.
// Scale rule: every record carries tenantId (the distributor) and an id created on the device,
// so the server can split data by distributor and phones never wait for a central counter.

export type Role = 'owner' | 'office' | 'salesman' | 'godown' | 'delivery';

// The eight locked modules (spec 15.1). Switched from the Hanubix console, never shown to the distributor.
export type ModuleKey = 'sales' | 'bill' | 'inventory' | 'delivery' | 'collection' | 'accountant' | 'gst' | 'payroll';

export const MODULES: { key: ModuleKey; name: string }[] = [
  { key: 'sales', name: 'TESRAX Sales' },
  { key: 'bill', name: 'TESRAX Bill' },
  { key: 'inventory', name: 'TESRAX Inventory' },
  { key: 'delivery', name: 'TESRAX Delivery' },
  { key: 'collection', name: 'TESRAX Collection' },
  { key: 'accountant', name: 'TESRAX Accountant' },
  { key: 'gst', name: 'TESRAX GST' },
  { key: 'payroll', name: 'TESRAX Payroll' },
];

export interface Base {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  dirty?: 0 | 1; // 1 = changed on this phone, not yet synced
}

export interface Settings extends Base {
  firmName: string;
  gstin: string;
  address: string;
  stateCode: string; // '33' = Tamil Nadu
  phone: string;
  modules: Record<ModuleKey, boolean>;
  billFormat: 'A4' | 'A5' | 'dotmatrix';
  returnApprovalLimit: number; // returns above this ₹ need owner OK
  discountAlertPct: number;
  serverUrl?: string;
  backupApproverId?: string;
  billPrefix?: string;      // one running bill series for the distributor (locked spec 15.1)
  nextBillNo?: number;
  nextCnNo?: number;        // credit-note counter when there is no server
  checkInBy?: string;       // 'HH:MM' — check-in after this is "late"
  grnPhoto?: boolean;       // second delivery photo (signed bill / GRN); owner can switch off
  upiId?: string;           // shown as QR at collection
  godownLat?: number; godownLng?: number; // check-in distance is measured from here
}

export interface Staff extends Base {
  name: string;
  phone: string;
  role: Role;
  pin: string; // local only; server keeps a hash
  active: boolean;
  vanId?: string;
  salary?: number; batta?: number; // per month / per present day
  kind?: 'db' | 'company_rep'; // company rep sees only his company's products
  companyId?: string;
}

export interface Company extends Base {
  name: string;
  code: string; // bill series prefix
  gstin?: string;
  nextBillNo: number;
}

export interface Product extends Base {
  companyId: string;
  name: string;
  nameTa?: string;
  code?: string;
  hsn: string;
  gst: number;
  mrp: number;
  rate: number; // selling rate per piece, before GST
  purchaseRate: number;
  caseSize: number;
  aliases: string[];
  focus?: boolean;
  active: boolean;
}

export interface Shop extends Base {
  name: string;
  owner?: string;
  phone?: string;
  gstin?: string;
  address?: string;
  area: string;
  beat: string;
  salesmanId?: string;
  creditLimit: number;
  creditDays: number;
  cashOnly: boolean;
  type: 'retail' | 'wholesale' | 'subdistributor';
  approved: boolean;
  aliases: string[];
  lat?: number;
  lng?: number;
  photo?: string;
  priceMode?: 'company' | 'distributor';
  tradeDiscountPct?: number;
  creditMode?: 'days' | 'limit' | 'bill_to_bill' | 'none';
  diffPref?: 'modified' | 'credit_note'; // how this shop wants delivery differences handled
  active?: boolean; // false = rejected / closed shop; hidden everywhere
}

export interface Batch extends Base {
  productId: string;
  batch: string;
  expiry: string;
  mrp: number;
  qty: number;
  godown: string;
}

export interface Scheme extends Base {
  companyId: string;
  productId?: string;
  name: string;
  type: 'pct' | 'free';
  value: number;
  buyQty?: number;
  freeQty?: number;
  from: string;
  to: string;
  source: 'company' | 'own';
  combine: 'add' | 'replace';
}

export interface OrderLine { productId: string; qty: number; rate: number; batchId?: string; mrp?: number } // batch/MRP chosen by the picker

export interface Order extends Base {
  shopId: string;
  offRoute?: boolean;
  visitId?: string;
  salesmanId?: string;
  source: 'salesman' | 'phone' | 'photo' | 'office' | 'in_person' | 'whatsapp' | 'other';
  rateRemark?: string; // salesman asked for a lower rate; owner approves
  lines: OrderLine[];
  // pipeline: new → picked (godown) → billed (owner approved) ; cancelled at any point
  // new (owner to approve) → approved (godown to pick) → picked (owner to verify) → billed
  status: 'new' | 'approved' | 'picked' | 'needs_ok' | 'billed' | 'cancelled';
  approvedBy?: string; approvedAt?: string;
  issues: string[];
  date: string;
  invoiceIds: string[];
  picked?: { productId: string; qty: number; batchId?: string; mrp?: number }[]; // what the godown actually packed
  pickedBy?: string;
  pickedAt?: string;
}

export interface InvoiceLine {
  productId: string;
  name: string;
  nameTa?: string;
  hsn: string;
  qty: number;
  freeQty: number;
  rate: number;
  mrp: number;
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  batches: { batchId: string; batch: string; qty: number; expiry: string }[];
  schemeNames: string[];
}

export interface Invoice extends Base {
  number: string;
  companyId: string;
  shopId: string;
  orderId?: string;
  date: string;
  kind: 'B2B' | 'B2C';
  lines: InvoiceLine[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  schemeSaving: number;
  vanId?: string;
  tripId?: string;
  stopNo?: number;
  // pending → planned (on a trip) → out (van left) → delivered / partial / returned / undelivered
  deliveryStatus: 'pending' | 'planned' | 'out' | 'delivered' | 'partial' | 'returned' | 'undelivered';
  delivery?: {
    at: string; by: string; photo?: string; lat?: number; lng?: number;
    shortages: { productId: string; qty: number; reason: string }[];
    excess?: { productId: string; qty: number }[];
    shopPhoto?: string; billPhoto?: string; distanceM?: number;
  };
  diffAction?: 'modified' | 'credit_note'; // owner's choice at day close for delivery differences
  original?: { lines: InvoiceLine[]; total: number; at: string }; // kept when a bill is revised
  printedAt?: string;
  cancelled?: { at: string; by: string; reason: string };
}

export interface CreditNote extends Base {
  number: string;
  invoiceId: string;
  shopId: string;
  companyId: string;
  date: string;
  reason: string;
  lines: { productId: string; qty: number; amount: number; restock: boolean }[];
  total: number;
}

export interface Payment extends Base {
  shopId: string;
  amount: number;
  mode: 'cash' | 'upi' | 'cheque' | 'bank';
  ref?: string;
  date: string;
  collectedBy: string;
  shopConfirmed: boolean;
  confirmPhoto?: string;
  allocations: { invoiceId: string; amount: number }[];
  advance: number; // unallocated amount kept on account
  settled: boolean;
  bankLineId?: string;
  status: 'ok' | 'waiting_shop' | 'bounced' | 'cancelled';
  correctionOf?: string; // this payment replaces a wrong one (kept, cancelled, for the audit trail)
  note?: string;
}

export interface Purchase extends Base {
  companyId: string;
  supplierGstin?: string;
  paid?: number; // paid to the company so far
  billNo: string;
  date: string;
  lines: {
    productId: string; batch: string; expiry: string; mrp: number;
    qty: number; freeQty: number; rate: number; discount: number; gst: number; amount: number;
  }[];
  taxable: number;
  tax: number;
  total: number;
  source: 'photo' | 'excel' | 'typed';
}

export interface Expense extends Base {
  approved?: boolean; // owner approves in bulk at day close
  by?: string;
  date: string;
  category: string;
  amount: number;
  vanId?: string;
  note?: string;
  photo?: string;
}

export interface BankLine extends Base {
  date: string;
  narration: string;
  credit: number;
  debit: number;
  ref?: string;
  shopId?: string;
  paymentId?: string;
  status: 'matched' | 'unmatched' | 'ignored';
  statement: string;
}

export interface ClaimEntry extends Base {
  companyId: string;
  month: string;
  kind: 'scheme' | 'damage' | 'expiry' | 'transit';
  productId?: string;
  qty: number;
  amount: number;
  note?: string;
  photo?: string;
  invoiceId?: string;
}

export interface Claim extends Base {
  companyId: string;
  month: string;
  amount: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'received';
  received?: number;
  note?: string;
}

export interface Trip extends Base {
  vanId: string;
  driverId?: string;
  date: string;
  status: 'planned' | 'loaded' | 'out' | 'done';
  stops: string[]; // shopIds in order
  startedAt?: string;
  endedAt?: string;
  track: { at: string; lat: number; lng: number }[];
}

export interface DayClose extends Base {
  date: string;
  closedBy: string;
  summary: Record<string, unknown>;
}

export interface DayPlan extends Base {
  date: string;
  shopIds: string[]; // standalone delivery: today's chosen shops in route order
}

export interface CheckIn extends Base {
  staffId: string; date: string; at: string; lat?: number; lng?: number; distanceM?: number; late: boolean; out?: string;
}
export interface LeaveRequest extends Base {
  staffId: string; from: string; to: string; reason: string; status: 'waiting' | 'approved' | 'rejected';
}
export interface Advance extends Base {
  staffId: string; amount: number; reason: string; status: 'waiting' | 'approved' | 'rejected'; instalments?: number; recovered?: number;
  kind?: 'advance' | 'shortfall'; // shortfall = cash not handed over at day close; shown daily until cleared
  date?: string;
}
export interface LiteEntry extends Base {
  date: string;
  shopId: string;
  kind: 'delivered' | 'closed' | 'refused' | 'payment';
  amount?: number;
  mode?: 'cash' | 'upi' | 'cheque';
  ref?: string;
  photo?: string;
  by: string;
  shopConfirmed?: boolean;
}

export interface Visit extends Base {
  shopId: string;
  staffId: string;
  date: string;
  at: string;
  lat?: number;
  lng?: number;
  farFromShop?: boolean;
  outcome?: 'order' | 'no_order' | 'closed' | 'payment_only';
}

export interface Target extends Base {
  companyId: string;
  month: string;
  kind: 'sales' | 'purchase' | 'shops' | 'lines';
  value: number;
}

export interface Van extends Base {
  name: string;
  number: string;
  kind: 'own' | 'hired' | 'auto';
  driverId?: string;
}

export interface AuditEntry extends Base {
  at: string;
  by: string;
  action: string;
  table: string;
  recordId: string;
  before?: unknown;
  after?: unknown;
  batchId: string; // all changes from one approval share this, for undo
  undone?: boolean;
}

export type TableName =
  | 'settings' | 'staff' | 'companies' | 'products' | 'shops' | 'batches' | 'schemes'
  | 'orders' | 'invoices' | 'creditNotes' | 'payments' | 'purchases' | 'expenses'
  | 'bankLines' | 'claimEntries' | 'claims' | 'vans' | 'audit' | 'visits' | 'targets' | 'trips' | 'dayCloses' | 'dayPlans' | 'liteEntries' | 'checkIns' | 'leaves' | 'advances';
