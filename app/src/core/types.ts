// DBRoX core data types.
// Scale rule: every record carries tenantId (the distributor) and an id created on the device,
// so the server can split data by distributor and phones never wait for a central counter.

export type Role = 'owner' | 'office' | 'salesman' | 'godown' | 'delivery';

export type ModuleKey =
  | 'orders' | 'billing' | 'godown' | 'delivery' | 'collection'
  | 'bank' | 'accounts' | 'claims' | 'scan';

export const MODULES: { key: ModuleKey; name: string }[] = [
  { key: 'orders', name: 'RoX Orders' },
  { key: 'billing', name: 'RoX Billing' },
  { key: 'godown', name: 'RoX Godown' },
  { key: 'delivery', name: 'RoX Delivery' },
  { key: 'collection', name: 'RoX Collection' },
  { key: 'bank', name: 'RoX Bank' },
  { key: 'accounts', name: 'RoX Accounts' },
  { key: 'claims', name: 'RoX Claim Prep' },
  { key: 'scan', name: 'RoX Scan' },
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
}

export interface Staff extends Base {
  name: string;
  phone: string;
  role: Role;
  pin: string; // local only; server keeps a hash
  active: boolean;
  vanId?: string;
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

export interface OrderLine { productId: string; qty: number; rate: number }

export interface Order extends Base {
  shopId: string;
  offRoute?: boolean;
  visitId?: string;
  salesmanId?: string;
  source: 'salesman' | 'phone' | 'photo' | 'office';
  lines: OrderLine[];
  // pipeline: new → picked (godown) → billed (owner approved) ; cancelled at any point
  status: 'new' | 'picked' | 'needs_ok' | 'billed' | 'cancelled';
  issues: string[];
  date: string;
  invoiceIds: string[];
  picked?: { productId: string; qty: number }[]; // what the godown actually packed
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
  };
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
}

export interface Purchase extends Base {
  companyId: string;
  supplierGstin?: string;
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
  | 'bankLines' | 'claimEntries' | 'claims' | 'vans' | 'audit' | 'visits' | 'targets' | 'trips' | 'dayCloses' | 'dayPlans' | 'liteEntries';
