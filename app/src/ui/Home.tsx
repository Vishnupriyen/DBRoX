import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ClipboardCheck, Route, MapPinned, IndianRupee, Banknote, Boxes, FileCheck2, Scale, BarChart3, PackageOpen, Truck, Store, ListChecks, Upload, Users, Receipt, ShoppingBag, PackagePlus, Landmark, Wallet, PieChart, Printer, ClipboardList, Target, UserPlus, CalendarCheck, Clock, TrendingUp, Download, FileWarning, Hourglass, ReceiptText } from 'lucide-react';
import { counts } from '../core/pipeline';
import { getLang } from '../core/i18n';
import { db, today, session } from '../core/db';
import type { Role, Settings } from '../core/types';
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
  | 'lite-shops' | 'lite-plan' | 'lite-delivery' | 'lite-collect' | 'lite-export' | 'more';

interface Tile { page?: Page; module?: string; icon: LucideIcon; en: string; ta: string; count?: number; tone?: 'bad' | 'warn' | 'ok'; tag?: [string, string] }

const L = (en: string, ta: string) => (getLang() === 'ta' ? ta : en);
export function standalone(s: Settings | undefined) { return !!s && !s.modules.bill && !s.modules.sales; }

const TAG: Record<string, [string, string]> = {
  sales: ['Take orders in 30 seconds. No typing.', '30 நொடியில் ஆர்டர். டைப்பிங் இல்ல.'],
  bill: ['One click. Bill is ready.', 'ஒரே கிளிக். பில் ரெடி.'],
  inventory: ['Take a photo of the bill. Stock is added.', 'பில் போட்டோ எடுங்க. ஸ்டாக் சேர்ந்தது.'],
  delivery: ['Plan, load, deliver. All easy.', 'திட்டம், ஏற்றம், டெலிவரி. எல்லாம் ஈசி.'],
  collection: ['Collect money with one tap.', 'ஒரே தட்டில் வசூல்.'],
  accountant: ['Accounts done in minutes.', 'கணக்கு நிமிஷத்தில் முடிஞ்சு.'],
  gst: ['GST file ready in one click.', 'GST ஃபைல் ஒரே கிளிக்கில் ரெடி.'],
  payroll: ['No confusion. Just a click.', 'குழப்பம் இல்ல. ஒரே கிளிக்.'],
};

// Opening screen: module icons with counts. Tap a module → its few screens. Nothing else.
export function Home({ role, go, open, onOpen }: { role: Role; go: (p: Page) => void; open: string | null; onOpen: (m: string | null) => void }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [subs, setSubs] = useState<Record<string, Tile[]>>({});
  const [morning, setMorning] = useState<{ name: string; orders: number; toDeliver: number; overdue: number; cash: number; first: Page | null } | null>(null);
  const [q, setQ] = useState('');
  const lang = getLang();
  useEffect(() => {
    (async () => {
      const s = await db.settings.toCollection().first();
      const c = await counts();
      const me = session().userId;
      const newShops = (await db.shops.toArray()).filter(x => !x.approved).length;
      const leaves = (await db.leaves.where('status').equals('waiting').count()) + (await db.advances.where('status').equals('waiting').count());
      const checkedIn = (await db.checkIns.where('date').equals(today()).count());
      const staffN = (await db.staff.toArray()).filter(x => x.active && x.role !== 'owner').length;
      const diffs = (await db.invoices.toArray()).filter(i => !i.cancelled && i.delivery && !i.diffAction && ((i.delivery.shortages?.length ?? 0) > 0 || (i.delivery.excess?.length ?? 0) > 0)).length;
      const sub: Record<string, Tile[]> = {};
      let t: Tile[] = [];
      if (standalone(s)) {
        const plan = await db.dayPlans.where('date').equals(today()).first();
        const done = (await db.liteEntries.where('date').equals(today()).toArray()).filter(e => e.kind !== 'payment').length;
        const shops = await db.shops.count();
        t = role === 'owner' || role === 'office' ? [
          { page: 'lite-shops', icon: Upload, en: 'Shop list', ta: 'கடை பட்டியல்', count: shops || undefined },
          { page: 'lite-plan', icon: ListChecks, en: "Today's shops", ta: 'இன்றைய கடைகள்', count: plan?.shopIds.length, tone: 'ok' },
          { page: 'lite-delivery', icon: Truck, en: 'Delivery', ta: 'டெலிவரி', count: plan ? plan.shopIds.length - done : undefined, tone: 'bad' },
          { page: 'lite-collect', icon: IndianRupee, en: 'Collection', ta: 'வசூல்' },
          { page: 'lite-export', icon: BarChart3, en: "Day's Excel", ta: 'இன்றைய Excel' },
          { page: 'staff', icon: Users, en: 'Staff', ta: 'ஊழியர்கள்' },
        ] : [
          { page: 'lite-delivery', icon: Truck, en: 'Delivery', ta: 'டெலிவரி', count: plan ? plan.shopIds.length - done : undefined, tone: 'bad' },
          { page: 'lite-collect', icon: IndianRupee, en: 'Collection', ta: 'வசூல்' },
        ];
      } else if (role === 'owner' || role === 'office') {
        const owner = role === 'owner';
        sub.sales = [
          { page: 'newshops', icon: UserPlus, en: 'New shops', ta: 'புதிய கடைகள்', count: newShops, tone: 'warn' },
          { page: 'targets', icon: Target, en: 'Targets', ta: 'இலக்கு' },
          { page: 'beat', icon: Route, en: 'Beats', ta: 'பீட்' },
        ];
        sub.bill = [
          { page: 'orders-received', icon: ClipboardList, en: 'Orders received', ta: 'வந்த ஆர்டர்கள்', count: c.toApproveOrders, tone: 'bad' },
          { page: 'verify', icon: ClipboardCheck, en: 'Picked — to verify', ta: 'சரிபார்க்க', count: c.toApprove, tone: 'warn' },
          { page: 'billed', icon: Receipt, en: 'Billed', ta: 'பில் ஆனது' },
        ];
        sub.inventory = [
          { page: 'stockin', icon: PackagePlus, en: 'Purchases', ta: 'கொள்முதல்' },
          { page: 'stock', icon: Boxes, en: 'Stock position', ta: 'ஸ்டாக் நிலை', count: c.stockAlerts, tone: 'warn' },
          { page: 'damages', icon: FileWarning, en: 'Damages', ta: 'சேதம்' },
          { page: 'ageing', icon: Hourglass, en: 'Ageing', ta: 'பழைய ஸ்டாக்' },
          { page: 'claims', icon: FileCheck2, en: 'Claims', ta: 'கிளைம்', count: c.claimsOpen },
          { page: 'stock-reports', icon: TrendingUp, en: 'Reports', ta: 'அறிக்கை' },
        ];
        sub.delivery = [
          { page: 'plan', icon: Route, en: 'Plan', ta: 'திட்டம்', count: c.toPlan, tone: 'warn' },
          ...(owner ? [{ page: 'live' as Page, icon: MapPinned, en: 'Live', ta: 'வண்டிகள்', count: c.out, tone: 'ok' as const }] : []),
          { page: 'status', icon: Truck, en: 'Delivery status', ta: 'டெலிவரி நிலை', count: diffs || undefined, tone: 'bad' },
          { page: 'trips', icon: BarChart3, en: 'Trip reports', ta: 'டிரிப் அறிக்கை' },
          ...(owner ? [{ page: 'vans' as Page, icon: Truck, en: 'Vans & drivers', ta: 'வண்டிகள்' }] : []),
        ];
        sub.collection = [
          { page: 'outstanding', icon: Wallet, en: 'Outstanding', ta: 'நிலுவை' },
          ...(owner ? [{ page: 'cash' as Page, icon: Banknote, en: 'Cash with staff', ta: 'ஊழியர் பணம்', count: c.cashStaff, tone: 'bad' as const }] : []),
          { page: 'cheques', icon: ReceiptText, en: 'Cheques & UPI', ta: 'செக் & UPI' },
        ];
        sub.accountant = [
          { page: 'bank', icon: Landmark, en: 'Bank', ta: 'வங்கி' },
          { page: 'expenses', icon: Wallet, en: 'Expenses', ta: 'செலவு' },
          { page: 'pnl', icon: PieChart, en: 'P&L', ta: 'லாப நஷ்டம்' },
          { page: 'cashflow', icon: Scale, en: 'Cash flow', ta: 'பண ஓட்டம்' },
          { page: 'reports', icon: BarChart3, en: 'Reports', ta: 'அறிக்கை' },
          { page: 'export', icon: Download, en: 'Export', ta: 'ஏற்றுமதி' },
        ];
        sub.payroll = [
          { page: 'today', icon: CalendarCheck, en: 'Today', ta: 'இன்று', count: leaves || undefined, tone: 'warn' },
          { page: 'staff', icon: Users, en: 'Staff', ta: 'ஊழியர்கள்' },
          ...(owner ? [{ page: 'salary' as Page, icon: IndianRupee, en: 'Salary sheet', ta: 'சம்பள பட்டியல்' }] : []),
        ];
        const sum = (k: string) => sub[k].reduce((a, x) => a + (x.count ?? 0), 0) || undefined;
        const tone = (k: string) => sub[k].find(x => x.count && x.tone === 'bad') ? 'bad' : sub[k].find(x => x.count && x.tone === 'warn') ? 'warn' : 'ok';
        t = [
          { module: 'bill', icon: Receipt, en: 'Bill', ta: 'பில்', count: sum('bill'), tone: tone('bill') },
          { module: 'delivery', icon: Truck, en: 'Delivery', ta: 'டெலிவரி', count: sum('delivery'), tone: tone('delivery') },
          { module: 'collection', icon: IndianRupee, en: 'Collection', ta: 'வசூல்', count: sum('collection'), tone: tone('collection') },
          { module: 'sales', icon: ShoppingBag, en: 'Sales', ta: 'விற்பனை', count: sum('sales'), tone: tone('sales') },
          { module: 'inventory', icon: Boxes, en: 'Inventory', ta: 'ஸ்டாக்', count: sum('inventory'), tone: tone('inventory') },
          { module: 'accountant', icon: Landmark, en: 'Accountant', ta: 'கணக்கு' },
          { page: 'gst', icon: FileCheck2, en: 'GST', ta: 'GST' },
          { module: 'payroll', icon: Users, en: 'Payroll', ta: 'சம்பளம்', count: sum('payroll') || (staffN - checkedIn > 0 ? staffN - checkedIn : undefined), tone: sum('payroll') ? 'warn' : 'bad' },
          ...(owner ? [{ page: 'dayclose' as Page, icon: Scale, en: 'Day close', ta: 'நாள் முடிவு', count: c.dayClosed ? undefined : (c.tripsToday || diffs || undefined), tone: 'ok' as const }] : []),
        ];
      } else if (role === 'salesman') {
        const myShops = (await db.shops.toArray()).filter(x => x.salesmanId === me);
        const visited = new Set((await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === me).map(v => v.shopId));
        t = [
          { page: 'beat', icon: Route, en: "Today's beat", ta: 'இன்றைய பீட்', count: Math.max(0, myShops.length - visited.size), tone: 'ok' },
          { page: 'collect', icon: IndianRupee, en: 'Collect', ta: 'வசூல்' },
          { page: 'myday', icon: BarChart3, en: 'My day', ta: 'என் நாள்' },
          { page: 'newshop', icon: UserPlus, en: 'New shop', ta: 'புதிய கடை' },
        ];
      } else if (role === 'godown') {
        t = [
          { page: 'pick', icon: PackageOpen, en: 'Pick orders', ta: 'ஆர்டர் எடு', count: c.toPick, tone: 'bad' },
          { page: 'load', icon: Truck, en: 'Load vans', ta: 'வண்டி ஏற்று', count: c.toLoad, tone: 'warn' },
          { page: 'print', icon: Printer, en: 'Print load sheet', ta: 'லோடு ஷீட் பிரிண்ட்' },
          { page: 'stockin', icon: PackagePlus, en: 'Stock in', ta: 'ஸ்டாக் சேர்' },
          { page: 'stock', icon: Boxes, en: 'Stock', ta: 'ஸ்டாக்', count: c.stockAlerts },
          { page: 'damages', icon: FileWarning, en: 'Damages', ta: 'சேதம்' },
        ];
      } else {
        t = [
          { page: 'trip', icon: Truck, en: 'My trip', ta: 'என் டிரிப்', count: c.stopsLeft, tone: 'bad' },
          { page: 'collect', icon: IndianRupee, en: 'Collect', ta: 'வசூல்' },
        ];
      }
      setTiles(t); setSubs(sub);
      if ((role === 'owner' || role === 'office') && !standalone(s)) {
        const bal = (await invoiceBalances()).filter(b => b.balance > 0.5 && b.overdueDays > 0);
        const meName = (await db.staff.get(me))?.name.split(' ')[0] ?? '';
        setMorning({ name: meName, orders: c.toApproveOrders, toDeliver: c.toPlan, overdue: Math.round(bal.reduce((a, b) => a + b.balance, 0)), cash: c.cashStaff, first: c.toApproveOrders ? 'orders-received' : c.toApprove ? 'verify' : c.toPlan ? 'plan' : diffs ? 'status' : null });
      } else setMorning(null);
    })();
  }, [role, open]);

  const list = open ? subs[open] ?? [] : tiles;
  const label = (t: Tile) => lang === 'ta' ? t.ta : t.en;
  const tag = open ? TAG[open] : null;
  const hour = new Date().getHours();
  const greet = hour < 12 ? L('Good morning', 'காலை வணக்கம்') : hour < 17 ? L('Good afternoon', 'மதிய வணக்கம்') : L('Good evening', 'மாலை வணக்கம்');
  const all: (Tile & { mod?: string })[] = [...tiles.filter(t => t.page), ...Object.entries(subs).flatMap(([m, ts]) => ts.map(t => ({ ...t, mod: m })))];
  const hits = q.trim() ? all.filter(t => `${t.en} ${t.ta}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div className={`home n${list.length}`}>
      {!open && <label className="home-search"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={L('Search a screen or ask RoX…', 'திரை தேடு அல்லது RoX-இடம் கேள்…')} /></label>}
      {!open && hits.length > 0 && <div className="home-results">{hits.map(h => <button key={h.page} className="item tap" onClick={() => { setQ(''); go(h.page!); }}><div className="grow" style={{ textAlign: 'left' }}><div className="t">{label(h)}</div>{h.mod && <div className="s">{h.mod}</div>}</div></button>)}</div>}
      {!open && !q && morning && (
        <div className="morning">
          <div className="grow">
            <div className="t">{greet}{morning.name ? `, ${morning.name}` : ''}.</div>
            <div className="s">{morning.orders ? L(`${morning.orders} orders waiting for your OK.`, `${morning.orders} ஆர்டர் உங்கள் ஒப்புதலுக்கு.`) : morning.toDeliver ? L(`${morning.toDeliver} bills to plan for delivery.`, `${morning.toDeliver} பில் டெலிவரி திட்டத்திற்கு.`) : L('Nothing is waiting on you right now.', 'இப்போது எதுவும் காத்திருக்கவில்லை.')}</div>
            <div className="kv"><div><b>{morning.orders}</b><span>{L('orders', 'ஆர்டர்')}</span></div><div><b>{morning.toDeliver}</b><span>{L('to deliver', 'டெலிவரி')}</span></div><div><b>{inr(morning.overdue)}</b><span>{L('overdue', 'தாமதம்')}</span></div><div><b>{morning.cash}</b><span>{L('cash w/ staff', 'ஊழியர் பணம்')}</span></div></div>
            {morning.first && <button className="pill" onClick={() => go(morning.first!)}>{L('Start here', 'இங்கே தொடங்கு')} →</button>}
          </div>
        </div>
      )}
      {open && <div className="home-back"><button onClick={() => onOpen(null)} aria-label="Back"><ArrowLeft /></button><span>{tiles.find(x => x.module === open) ? label(tiles.find(x => x.module === open)!) : open}</span></div>}
      {tag && <div className="home-tag">{lang === 'ta' ? tag[1] : tag[0]}</div>}
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
