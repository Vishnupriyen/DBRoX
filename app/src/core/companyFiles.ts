// Company side: every report as a file TESRAX sends (12 Nov 2026, owner: "every report it should send").
// Head office and managers: sales by distributor and by product, stock at distributors, shops, team today, targets.
// A rep: their own travel claim. Same figures as the company screens; a manager sees only their own distributors and team.
import { getSettings, session, thisMonth, today } from './db';
import { inr, plural, showDate, showMonth } from './i18n';
import { r2 } from './ledger';
import { myLinks, myTeam, outletList, salesByDistributor, salesByProduct, stockCover } from './company';
import { repSales, teamToday } from './field';
import { monthClaim } from './travel';
import { downloadWorkbook } from './readers';
import type { FileReply } from './screenFiles';

async function head(period: string) {
  const st = await getSettings();
  return [[`${st.firmName}${st.gstin ? ` · GSTIN ${st.gstin}` : ''}`], [`Period: ${period}`], [`Made on ${showDate(today())} · amounts in ₹, before GST`], []] as (string | number)[][];
}
const pct = (a: number, b: number) => (b ? `${Math.round(a / b * 100)}%` : '—');

export async function coSalesFile(month = thisMonth()): Promise<FileReply> {
  const ids = new Set((await myLinks(session().userId)).map(l => l.id));
  const rows = (await salesByDistributor(month)).filter(r => ids.has(r.link.id));
  const prods = await salesByProduct(month);
  const p = r2(rows.reduce((a, r) => a + r.primary, 0)), s = r2(rows.reduce((a, r) => a + r.secondary - r.returns, 0));
  return {
    text: `Sales ${showMonth(month)}: to distributors ${inr(p)}, distributors to shops ${inr(s)} (${pct(s, p)} sell-through), ${plural(rows.length, 'distributor')}.`,
    file: `Company-sales-${month}`,
    sheets: [
      { name: 'By distributor', header: ['Distributor', 'Town', 'Sales to distributor', 'Sales to shops', 'Returns', 'Sell-through', 'Shops billed', 'Bills', 'Stock value', 'Products running low'],
        rows: [...await head(showMonth(month)), ...rows.map(r => [r.link.name, r.link.town ?? '', r.primary, r.secondary, r.returns, pct(r.secondary - r.returns, r.primary), r.shops, r.bills, r.stockValue, r.lowCover]), ['Total', '', p, r2(rows.reduce((a, r) => a + r.secondary, 0)), r2(rows.reduce((a, r) => a + r.returns, 0)), pct(s, p)]] },
      { name: 'By product', header: ['Product', 'Qty to distributors', 'Qty to shops', 'Value to shops'], rows: prods.map(x => [x.name, x.primaryQty, x.secondaryQty, x.secondaryValue]) },
    ],
  };
}

export async function coStockFile(): Promise<FileReply> {
  const links = await myLinks(session().userId); const names = new Map(links.map(l => [l.id, l.name]));
  const rows = (await stockCover()).filter(c => names.has(c.dbLinkId));
  const low = rows.filter(r => r.status === 'low').length;
  return {
    text: `Stock at distributors: ${plural(rows.length, 'line')}, ${low} running low, value ${inr(r2(rows.reduce((a, r) => a + r.value, 0)))}.`,
    file: `Stock-at-distributors-${today()}`,
    sheets: [{ name: 'Stock', header: ['Distributor', 'Product', 'Stock (pcs)', 'Sold per day', 'Days of stock', 'Norm (days)', 'Status', 'Near expiry', 'Value'],
      rows: [...await head(`as on ${showDate(today())}`), ...rows.map(r => [names.get(r.dbLinkId) ?? '', r.name, r.qty, r.perDay, r.days ?? '—', r.norm, r.status, r.nearExpiry, r.value])] }],
  };
}

export async function coShopsFile(): Promise<FileReply> {
  const o = await outletList();
  return {
    text: `Shops: ${o.total}, ${o.bought} bought this month.`,
    file: `Shops-${today()}`,
    sheets: [{ name: 'Shops', header: ['Shop', 'Area', 'Beat', 'GSTIN', 'This month ₹'], rows: [...await head(showMonth(thisMonth())), ...o.shops.map(s => [s.name, s.area ?? '', s.beat ?? '', s.gstin ?? '', s.monthValue])] }],
  };
}

export async function coTeamFile(): Promise<FileReply> {
  const team = await myTeam(session().userId);
  const rows = await teamToday(team);
  const started = rows.filter(r => r.started).length;
  const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  return {
    text: `Team today: ${started} of ${rows.length} started, ${rows.reduce((a, r) => a + r.visits, 0)} visits, orders ${inr(r2(rows.reduce((a, r) => a + r.orderValue, 0)))}.`,
    file: `Team-today-${today()}`,
    sheets: [{ name: 'Team today', header: ['Name', 'Started', 'Ended', 'km', 'Visits', 'Productive', 'Visited far from shop', 'Orders', 'Order value', 'Flags'],
      rows: [...await head(showDate(today())), ...rows.map(r => [r.staff.name, time(r.started), time(r.ended), r.km, r.visits, r.productive, r.far, r.orders, r.orderValue, r.flags.join('; ')])] }],
  };
}

export async function coTargetsFile(month = thisMonth()): Promise<FileReply> {
  const team = await myTeam(session().userId);
  const rows = await teamToday(team);
  const sales = await repSales(month);
  return {
    text: `Targets ${showMonth(month)}: ${plural(team.length, 'person', 'people')}, sales ${inr(r2([...sales.values()].reduce((a, v) => a + v, 0)))}.`,
    file: `Targets-${month}`,
    sheets: [{ name: 'Targets', header: ['Name', 'Target', 'Sales', 'Achieved'],
      rows: [...await head(showMonth(month)), ...rows.map(r => { const got = sales.get(r.staff.id) ?? 0; return [r.staff.name, r.target, got, pct(got, r.target)]; })] }],
  };
}

/** a rep's own travel claim for a month */
export async function travelFile(month = thisMonth()): Promise<FileReply> {
  const c = await monthClaim(session().userId, month);
  return {
    text: `Travel ${showMonth(month)}: ${plural(c.days, 'day')}, ${c.km} km, total ${inr(c.total)}.`,
    file: `Travel-claim-${month}`,
    sheets: [{ name: 'Travel claim', header: ['Item', 'Value'], rows: [...await head(showMonth(month)),
      ['Days worked', c.days], ['km', c.km], ['km allowance ₹', c.kmAmount], ['DA days', c.daDays], ['Outstation days', c.outDays], ['DA ₹', c.daAmount], ['Expenses ₹', c.expenses], ['Total ₹', c.total], ...c.flags.map(f => ['Note', f])] }],
  };
}

export const sendCoFile = (f: FileReply) => downloadWorkbook(f.file, f.sheets);
