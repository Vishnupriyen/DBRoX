import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ClipboardCheck, Route, MapPinned, IndianRupee, Banknote, Boxes, FileCheck2, Scale, BarChart3, PackageOpen, Truck, Store, ListChecks, Upload, Users, Receipt, ShoppingBag, PackagePlus, Landmark, Wallet, PieChart, Printer, ClipboardList, Target, UserPlus, CalendarCheck, Clock, TrendingUp, Download, FileWarning, Hourglass, ReceiptText } from 'lucide-react';
import { counts } from '../core/pipeline';
import { db, today, session } from '../core/db';
import type { ModuleKey, Role } from '../core/types';
import { licenceState } from '../core/licence';
import { ENV_SERVER } from '../core/sync';
import { MODULE_ICON } from './icons';
import { Search } from 'lucide-react';
import { invoiceBalances } from '../core/ledger';
import { inr } from '../core/i18n';

export type Page = 'home'
  | 'orders-received' | 'verify' | 'billed' | 'newshops' | 'targets' | 'beat' | 'myday' | 'newshop' | 'orders-excel'
  | 'stockin' | 'stock' | 'damages' | 'ageing' | 'stock-reports'
  | 'plan' | 'live' | 'status' | 'trips' | 'load' | 'print' | 'trip' | 'pick'
  | 'collect' | 'outstanding' | 'cash' | 'cheques'
  | 'bank' | 'expenses' | 'pnl' | 'cashflow' | 'export' | 'reports' | 'vans'
  | 'gst' | 'today' | 'salary' | 'staff' | 'claims' | 'dayclose' | 'bills'
  | 'lite-shops' | 'lite-plan' | 'lite-delivery' | 'lite-collect' | 'lite-export' | 'more' | 'billing';

interface Tile { page?: Page; module?: string; icon: LucideIcon; en: string; count?: number; tone?: 'bad' | 'warn' | 'ok'; tag?: string }

export function standalone(mods: Record<ModuleKey, boolean> | undefined) { return !!mods && !mods.bill && !mods.sales; }
// which paid module each home tile belongs to: a tile shows only if that module is in the licence
const NEED: Partial<Record<Page, ModuleKey>> = {
  beat: 'sales', newshop: 'sales', myday: 'sales', collect: 'collection', pick: 'bill', load: 'delivery', print: 'delivery',
  stockin: 'inventory', stock: 'inventory', damages: 'inventory', trip: 'delivery', gst: 'gst', dayclose: 'bill',
  'lite-delivery': 'delivery', 'lite-plan': 'delivery', 'lite-collect': 'collection',
};

const TAG: Record<string, string> = {
  sales: 'Take orders in 30 seconds. No typing.',
  bill: 'One click. Bill is ready.',
  inventory: 'Take a photo of the bill. Stock is added.',
  delivery: 'Plan, load, deliver. All easy.',
  collection: 'Collect money with one tap.',
  accountant: 'Accounts done in minutes.',
  gst: 'GST file ready in one click.',
  payroll: 'No confusion. Just a click.',
};

// Opening screen: module icons with counts. Tap a module → its few screens. Nothing else.
export function Home({ role, go, open, onOpen }: { role: Role; go: (p: Page) => void; open: string | null; onOpen: (m: string | null) => void }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [subs, setSubs] = useState<Record<string, Tile[]>>({});
  const [morning, setMorning] = useState<{ name: string; orders: number; toDeliver: number; overdue: number; cash: number; first: Page | null } | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    (async () => {
      const s = await db.settings.toCollection().first();
      const mods = (await licenceState(!!ENV_SERVER, s)).mods;
      const c = await counts();
      const me = session().userId;
      const newShops = (await db.shops.toArray()).filter(x => !x.approved).length;
      const leaves = (await db.leaves.where('status').equals('waiting').count()) + (await db.advances.where('status').equals('waiting').count());
      const checkedIn = (await db.checkIns.where('date').equals(today()).count());
      const staffN = (await db.staff.toArray()).filter(x => x.active && x.role !== 'owner').length;
      const diffs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.delivery && !i.diffAction && ((i.delivery.shortages?.length ?? 0) > 0 || (i.delivery.excess?.length ?? 0) > 0)).length;
      const sub: Record<string, Tile[]> = {};
      let t: Tile[] = [];
      if (standalone(mods)) {
        const plan = await db.dayPlans.where('date').equals(today()).first();
        const done = (await db.liteEntries.where('date').equals(today()).toArray()).filter(e => e.kind !== 'payment').length;
        const shops = await db.shops.count();
        t = role === 'owner' || role === 'office' ? [
          { page: 'lite-shops', icon: Upload, en: 'Shop list', count: shops || undefined },
          { page: 'lite-plan', icon: ListChecks, en: "Today's shops", count: plan?.shopIds.length, tone: 'ok' },
          { page: 'lite-delivery', icon: Truck, en: 'Delivery', count: plan ? plan.shopIds.length - done : undefined, tone: 'bad' },
          { page: 'lite-collect', icon: IndianRupee, en: 'Collection' },
          { page: 'lite-export', icon: BarChart3, en: "Day's Excel" },
          { page: 'staff', icon: Users, en: 'Staff' },
        ] : [
          { page: 'lite-delivery', icon: Truck, en: 'Delivery', count: plan ? plan.shopIds.length - done : undefined, tone: 'bad' },
          { page: 'lite-collect', icon: IndianRupee, en: 'Collection' },
        ];
      } else if (role === 'owner' || role === 'office') {
        const owner = role === 'owner';
        sub.sales = [
          { page: 'newshops', icon: UserPlus, en: 'New shops', count: newShops, tone: 'warn' },
          { page: 'targets', icon: Target, en: 'Targets' },
          { page: 'beat', icon: Route, en: 'Beats' },
        ];
        sub.bill = [
          { page: 'orders-received', icon: ClipboardList, en: 'Orders received', count: c.toApproveOrders, tone: 'bad' },
          { page: 'verify', icon: ClipboardCheck, en: 'Picked — to verify', count: c.toApprove, tone: 'warn' },
          { page: 'billed', icon: Receipt, en: 'Billed' },
        ];
        sub.inventory = [
          { page: 'stockin', icon: PackagePlus, en: 'Purchases' },
          { page: 'stock', icon: Boxes, en: 'Stock position', count: c.stockAlerts, tone: 'warn' },
          { page: 'damages', icon: FileWarning, en: 'Damages' },
          { page: 'ageing', icon: Hourglass, en: 'Ageing' },
          { page: 'claims', icon: FileCheck2, en: 'Claims', count: c.claimsOpen },
          { page: 'stock-reports', icon: TrendingUp, en: 'Reports' },
        ];
        sub.delivery = [
          { page: 'plan', icon: Route, en: 'Plan', count: c.toPlan, tone: 'warn' },
          ...(owner ? [{ page: 'live' as Page, icon: MapPinned, en: 'Live', count: c.out, tone: 'ok' as const }] : []),
          { page: 'status', icon: Truck, en: 'Delivery status', count: diffs || undefined, tone: 'bad' },
          { page: 'trips', icon: BarChart3, en: 'Trip reports' },
          ...(owner ? [{ page: 'vans' as Page, icon: Truck, en: 'Vans & drivers' }] : []),
        ];
        sub.collection = [
          { page: 'outstanding', icon: Wallet, en: 'Outstanding' },
          ...(owner ? [{ page: 'cash' as Page, icon: Banknote, en: 'Cash with staff', count: c.cashStaff, tone: 'bad' as const }] : []),
          { page: 'cheques', icon: ReceiptText, en: 'Cheques & UPI' },
        ];
        sub.accountant = [
          { page: 'bank', icon: Landmark, en: 'Bank' },
          { page: 'expenses', icon: Wallet, en: 'Expenses' },
          { page: 'pnl', icon: PieChart, en: 'P&L' },
          { page: 'cashflow', icon: Scale, en: 'Cash flow' },
          { page: 'reports', icon: BarChart3, en: 'Reports' },
          { page: 'export', icon: Download, en: 'Export' },
        ];
        sub.payroll = [
          { page: 'today', icon: CalendarCheck, en: 'Today', count: leaves || undefined, tone: 'warn' },
          { page: 'staff', icon: Users, en: 'Staff' },
          ...(owner ? [{ page: 'salary' as Page, icon: IndianRupee, en: 'Salary sheet' }] : []),
        ];
        const sum = (k: string) => sub[k].reduce((a, x) => a + (x.count ?? 0), 0) || undefined;
        const tone = (k: string) => sub[k].find(x => x.count && x.tone === 'bad') ? 'bad' : sub[k].find(x => x.count && x.tone === 'warn') ? 'warn' : 'ok';
        t = [
          { module: 'bill', icon: Receipt, en: 'Bill', count: sum('bill'), tone: tone('bill') },
          { module: 'delivery', icon: Truck, en: 'Delivery', count: sum('delivery'), tone: tone('delivery') },
          { module: 'collection', icon: IndianRupee, en: 'Collection', count: sum('collection'), tone: tone('collection') },
          { module: 'sales', icon: ShoppingBag, en: 'Sales', count: sum('sales'), tone: tone('sales') },
          { module: 'inventory', icon: Boxes, en: 'Inventory', count: sum('inventory'), tone: tone('inventory') },
          { module: 'accountant', icon: Landmark, en: 'Accountant' },
          { page: 'gst', icon: FileCheck2, en: 'GST' },
          { module: 'payroll', icon: Users, en: 'Payroll', count: sum('payroll') || (staffN - checkedIn > 0 ? staffN - checkedIn : undefined), tone: sum('payroll') ? 'warn' : 'bad' },
          ...(owner ? [{ page: 'dayclose' as Page, icon: Scale, en: 'Day close', count: c.dayClosed ? undefined : (c.tripsToday || diffs || undefined), tone: 'ok' as const }] : []),
        ];
      } else if (role === 'salesman') {
        const myShops = (await db.shops.toArray()).filter(x => x.salesmanId === me);
        const visited = new Set((await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === me).map(v => v.shopId));
        t = [
          { page: 'beat', icon: Route, en: "Today's beat", count: (() => { const d = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]; const todays = myShops.filter(x => x.beat === d || x.aliases.includes(`beat:${d}`)); return todays.filter(x => !visited.has(x.id)).length || undefined; })(), tone: 'ok' },
          { page: 'collect', icon: IndianRupee, en: 'Collect' },
          { page: 'myday', icon: BarChart3, en: 'My day' },
          { page: 'newshop', icon: UserPlus, en: 'New shop' },
        ];
      } else if (role === 'godown') {
        t = [
          { page: 'pick', icon: PackageOpen, en: 'Pick orders', count: c.toPick, tone: 'bad' },
          { page: 'load', icon: Truck, en: 'Load vans', count: c.toLoad, tone: 'warn' },
          { page: 'print', icon: Printer, en: 'Print load sheet' },
          { page: 'stockin', icon: PackagePlus, en: 'Stock in' },
          { page: 'stock', icon: Boxes, en: 'Stock', count: c.stockAlerts },
          { page: 'damages', icon: FileWarning, en: 'Damages' },
        ];
      } else {
        t = [
          { page: 'trip', icon: Truck, en: 'My trip', count: c.stopsLeft, tone: 'bad' },
          { page: 'collect', icon: IndianRupee, en: 'Collect' },
        ];
      }
      const allowed = (x: Tile) => x.module ? mods[x.module as ModuleKey] !== false : !(x.page && NEED[x.page]) || mods[NEED[x.page]!];
      setTiles(t.filter(allowed)); setSubs(sub);
      if ((role === 'owner' || role === 'office') && !standalone(mods)) {
        const bal = (await invoiceBalances()).filter(b => b.balance > 0.5 && b.overdueDays > 0);
        const meName = (await db.staff.get(me))?.name.split(' ')[0] ?? '';
        setMorning({ name: meName, orders: c.toApproveOrders, toDeliver: c.toPlan, overdue: Math.round(bal.reduce((a, b) => a + b.balance, 0)), cash: c.cashStaff, first: c.toApproveOrders ? 'orders-received' : c.toApprove ? 'verify' : c.toPlan ? 'plan' : diffs ? 'status' : null });
      } else setMorning(null);
    })();
  }, [role, open]);

  const list = open ? subs[open] ?? [] : tiles;
  const label = (t: Tile) => t.en;
  const tag = open ? TAG[open] : null;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const all: (Tile & { mod?: string })[] = [...tiles.filter(t => t.page), ...Object.entries(subs).flatMap(([m, ts]) => ts.map(t => ({ ...t, mod: m })))];
  const hits = q.trim() ? all.filter(t => t.en.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div className={`home n${list.length}`}>
      {!open && <label className="home-search"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={'Search a screen or ask TESRAX…'} /></label>}
      {!open && hits.length > 0 && <div className="home-results">{hits.map(h => <button key={h.page} className="item tap" onClick={() => { setQ(''); go(h.page!); }}><div className="grow" style={{ textAlign: 'left' }}><div className="t">{label(h)}</div>{h.mod && <div className="s">{h.mod}</div>}</div></button>)}</div>}
      {!open && !q && morning && (
        <div className="morning">
          <div className="grow">
            <div className="t">{greet}{morning.name ? `, ${morning.name}` : ''}.</div>
            <div className="s">{morning.orders ? `${morning.orders} order${morning.orders > 1 ? 's' : ''} waiting for your OK.` : morning.toDeliver ? `${morning.toDeliver} bill${morning.toDeliver > 1 ? 's' : ''} to plan for delivery.` : 'Nothing is waiting on you right now.'}</div>
            <div className="kv"><div><b>{morning.orders}</b><span>{'orders'}</span></div><div><b>{morning.toDeliver}</b><span>{'to deliver'}</span></div><div><b>{inr(morning.overdue)}</b><span>{'overdue'}</span></div><div><b>{morning.cash}</b><span>{'cash w/ staff'}</span></div></div>
            {morning.first && <button className="pill" onClick={() => go(morning.first!)}>{'Start here'} →</button>}
          </div>
        </div>
      )}
      {open && <div className="home-back"><button onClick={() => onOpen(null)} aria-label="Back"><ArrowLeft /></button><span>{tiles.find(x => x.module === open) ? label(tiles.find(x => x.module === open)!) : open}</span></div>}
      {tag && <div className="home-tag">{tag}</div>}
      {list.map(t => (
        <button key={t.page ?? t.module} className={`tile ${t.module ? 'module' : ''}`} onClick={() => t.module ? onOpen(t.module) : go(t.page!)}>
          <span className="tile-ic">{t.module && MODULE_ICON[t.module] ? MODULE_ICON[t.module]({ size: 34 }) : t.page === 'dayclose' ? MODULE_ICON.dayclose({ size: 34 }) : t.page === 'gst' ? MODULE_ICON.gst({ size: 34 }) : <t.icon size={30} />}</span>
          <span className="tile-l">{label(t)}</span>
          {t.count ? <span className={`tile-n ${t.tone ?? ''}`}>{t.count}</span> : null}
        </button>
      ))}
      {!list.length && <div className="muted">…</div>}
    </div>
  );
}

export const StoreIcon = Store;
export const ClockIcon = Clock;
