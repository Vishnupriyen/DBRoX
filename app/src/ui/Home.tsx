import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ClipboardCheck, Route, MapPinned, IndianRupee, Banknote, Boxes, FileCheck2, Scale, BarChart3, Receipt, PackageOpen, Truck, Store, ListChecks, Upload } from 'lucide-react';
import { counts } from '../core/pipeline';
import { getLang } from '../core/i18n';
import { db, today } from '../core/db';
import { session } from '../core/db';
import type { Role, Settings } from '../core/types';

export type Page = 'home' | 'approve' | 'plan' | 'live' | 'collect' | 'cash' | 'stock' | 'claims' | 'dayclose' | 'reports' | 'bills'
  | 'pick' | 'load' | 'trip' | 'beat' | 'myday' | 'lite-shops' | 'lite-plan' | 'lite-delivery' | 'lite-collect' | 'lite-export' | 'more';

interface Tile { page: Page; icon: LucideIcon; en: string; ta: string; count?: number; tone?: 'bad' | 'warn' | 'ok' }

export function standalone(s: Settings | undefined) {
  // delivery/collection bought without orders+billing → nothing to connect to: standalone screens
  return !!s && !s.modules.billing && !s.modules.orders;
}

// Opening screen for every role: large icons, a count where something waits. Nothing else.
export function Home({ role, go }: { role: Role; go: (p: Page) => void }) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const lang = getLang();
  useEffect(() => {
    (async () => {
      const s = await db.settings.toCollection().first();
      const c = await counts();
      const me = session().userId;
      let t: Tile[] = [];
      if (standalone(s)) {
        const plan = await db.dayPlans.where('date').equals(today()).first();
        const done = (await db.liteEntries.where('date').equals(today()).toArray()).filter(e => e.kind !== 'payment').length;
        const shops = await db.shops.count();
        if (role === 'owner' || role === 'office') t = [
          { page: 'lite-shops', icon: Upload, en: 'Shop list', ta: 'கடை பட்டியல்', count: shops || undefined },
          { page: 'lite-plan', icon: ListChecks, en: "Today's shops", ta: 'இன்றைய கடைகள்', count: plan?.shopIds.length, tone: 'ok' },
          { page: 'lite-delivery', icon: Truck, en: 'Delivery', ta: 'டெலிவரி', count: plan ? plan.shopIds.length - done : undefined, tone: 'bad' },
          { page: 'lite-collect', icon: IndianRupee, en: 'Collection', ta: 'வசூல்' },
          { page: 'lite-export', icon: BarChart3, en: "Day's Excel", ta: 'இன்றைய Excel' },
        ];
        else t = [
          { page: 'lite-delivery', icon: Truck, en: 'Delivery', ta: 'டெலிவரி', count: plan ? plan.shopIds.length - done : undefined, tone: 'bad' },
          { page: 'lite-collect', icon: IndianRupee, en: 'Collection', ta: 'வசூல்' },
        ];
      } else if (role === 'owner' || role === 'office') {
        t = [
          { page: 'approve', icon: ClipboardCheck, en: 'Approve', ta: 'ஒப்புதல்', count: c.toApprove, tone: 'bad' },
          { page: 'plan', icon: Route, en: 'Delivery plan', ta: 'டெலிவரி திட்டம்', count: c.toPlan, tone: 'warn' },
          { page: 'live', icon: MapPinned, en: 'Live vans', ta: 'வண்டிகள்', count: c.out, tone: 'ok' },
          { page: 'collect', icon: IndianRupee, en: 'Collect', ta: 'வசூல்', count: c.waitingShop || undefined, tone: 'warn' },
          { page: 'cash', icon: Banknote, en: 'Cash with staff', ta: 'ஊழியர் பணம்', count: c.cashStaff, tone: 'bad' },
          { page: 'stock', icon: Boxes, en: 'Stock alerts', ta: 'ஸ்டாக்', count: c.stockAlerts, tone: 'warn' },
          { page: 'claims', icon: FileCheck2, en: 'Claims', ta: 'கிளைம்', count: c.claimsOpen },
          { page: 'dayclose', icon: Scale, en: 'Day close', ta: 'நாள் முடிவு', count: c.dayClosed ? undefined : (c.tripsToday || undefined), tone: 'ok' },
          { page: 'reports', icon: BarChart3, en: 'Reports', ta: 'அறிக்கை' },
          { page: 'bills', icon: Receipt, en: 'Bills', ta: 'பில்கள்' },
        ];
        if (role === 'office') t = t.filter(x => !['cash', 'dayclose'].includes(x.page));
      } else if (role === 'salesman') {
        const myShops = (await db.shops.toArray()).filter(x => x.salesmanId === me);
        const visited = new Set((await db.visits.where('date').equals(today()).toArray()).filter(v => v.staffId === me).map(v => v.shopId));
        t = [
          { page: 'beat', icon: Route, en: "Today's beat", ta: 'இன்றைய பீட்', count: Math.max(0, myShops.length - visited.size), tone: 'ok' },
          { page: 'collect', icon: IndianRupee, en: 'Collect', ta: 'வசூல்' },
          { page: 'myday', icon: BarChart3, en: 'My day', ta: 'என் நாள்' },
        ];
      } else if (role === 'godown') {
        t = [
          { page: 'pick', icon: PackageOpen, en: 'Pick orders', ta: 'ஆர்டர் எடு', count: c.toPick, tone: 'bad' },
          { page: 'load', icon: Truck, en: 'Load vans', ta: 'வண்டி ஏற்று', count: c.toLoad, tone: 'warn' },
          { page: 'stock', icon: Boxes, en: 'Stock alerts', ta: 'ஸ்டாக்', count: c.stockAlerts },
        ];
      } else {
        t = [
          { page: 'trip', icon: Truck, en: 'My trip', ta: 'என் டிரிப்', count: c.stopsLeft, tone: 'bad' },
          { page: 'collect', icon: IndianRupee, en: 'Collect', ta: 'வசூல்' },
        ];
      }
      setTiles(t);
    })();
  }, [role]);

  return (
    <div className="home">
      {tiles.map(t => (
        <button key={t.page} className="tile" onClick={() => go(t.page)}>
          <span className="tile-ic"><t.icon size={30} /></span>
          <span className="tile-l">{lang === 'ta' ? t.ta : t.en}</span>
          {t.count ? <span className={`tile-n ${t.tone ?? ''}`}>{t.count}</span> : null}
        </button>
      ))}
      {!tiles.length && <div className="muted">…</div>}
    </div>
  );
}

export const StoreIcon = Store;
