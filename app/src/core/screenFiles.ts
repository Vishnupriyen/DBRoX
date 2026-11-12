// Files for screens that had none (12 Nov 2026, owner: "every report it should send"): P&L, GST summary, day close,
// attendance and trip reports. Each uses the SAME figures as its screen; TESRAX sends them ("send p&l", "day close report").
import { db, getSettings, monthEnd, today } from './db';
import { inr, plural, showDate, showMonth } from './i18n';
import { r2 } from './ledger';
import { profitAndLoss, pnlTotals } from './pnl';
import { salesSummary } from './reports';
import { gstr1Due } from './gst';
import { daySummary } from './pipeline';
import { salarySheet } from './payroll';
import { downloadWorkbook } from './readers';
import type { Trip } from './types';

type Sheet = { name: string; header: string[]; rows: (string | number)[][] };
/** the lines an accountant needs at the top of any file: firm, GSTIN, period, the day it was made */
async function headBlock(period: string, note = 'Amounts in ₹') {
  const st = await getSettings();
  return [[`${st.firmName}${st.gstin ? ` · GSTIN ${st.gstin}` : ' · GSTIN not set'}`, ''], [`Period: ${period}`, ''], [`Made on ${showDate(today())} · ${note}`, ''], ['', '']] as (string | number)[][];
}
export interface FileReply { text: string; file: string; sheets: Sheet[] }

/** P&L for today or this month (the P&L screen's periods) */
export async function pnlFile(period: 'today' | 'month'): Promise<FileReply> {
  const d = await profitAndLoss(period), t = pnlTotals(d);
  const label = period === 'today' ? `Today ${showDate(today())}` : showMonth(today().slice(0, 7));
  const heads: (string | number)[][] = [
    ...await headBlock(label, 'Amounts in ₹, before GST'),
    ['INCOME', ''], ...d.income.map(h => [h.label, h.amount]), ['Total income (before GST)', t.income], ['', ''],
    ['EXPENSES', ''], ...d.expense.map(h => [h.label, h.amount]), ['Total expenses', t.expense], ['', ''],
    [t.profit >= 0 ? 'PROFIT' : 'LOSS', Math.abs(t.profit)], ['Profit % of income', `${t.pct}%`], ['', ''],
    ['Note: GST is not income — sales and credit notes are before GST; GST collected is paid to the government.', ''],
  ];
  const items = [...d.income.map(h => ({ h, side: 'Income' })), ...d.expense.map(h => ({ h, side: 'Expense' }))]
    .flatMap(({ h, side }) => h.items.map(i => [side, h.label, i.d ? showDate(i.d) : '', i.t, i.v]));
  return {
    text: `P&L ${label}: income ${inr(t.income)}, expenses ${inr(t.expense)}, ${t.profit >= 0 ? 'profit' : 'loss'} ${inr(Math.abs(t.profit))}.`,
    file: `PnL-${period === 'today' ? today() : today().slice(0, 7)}`,
    sheets: [{ name: 'P&L', header: [`Profit & loss — ${label}`, '₹ (before GST)'], rows: heads }, { name: 'Details', header: ['Side', 'Head', 'Date', 'Item', '₹'], rows: items }],
  };
}

/** GST summary of a month: net sales, tax by type, bills, credit notes, GSTR-1 due date (as the GST screen) */
export async function gstSummaryFile(month: string): Promise<FileReply> {
  const s = await salesSummary({ from: `${month}-01`, to: monthEnd(month) });
  const st = await getSettings();
  const due = gstr1Due(`${month}-01`);
  const tax = (x: { cgst: number; sgst: number; igst: number }) => r2(x.cgst + x.sgst + x.igst);
  const rows: (string | number)[][] = [
    ...await headBlock(showMonth(month)),
    ['Bills', s.bills], ['Credit notes', s.notes], ['', ''],
    ['Billed — taxable', s.billed.taxable], ['Billed — tax', tax(s.billed)],
    ['Less: credit notes — taxable', s.credited.taxable], ['Less: credit notes — tax', tax(s.credited)], ['', ''],
    ['Net sales before GST', s.net.taxable],
    ['CGST (net of credit notes)', s.net.cgst], ['SGST (net of credit notes)', s.net.sgst], ['IGST (net of credit notes)', s.net.igst],
    ['Tax payable (net of credit notes)', s.tax], ['Net sales with GST', s.net.total], ['', ''],
    ['GSTR-1 due (monthly filer)', showDate(due)],
    ['Quarterly (QRMP) filers: GSTR-1 by the 13th after the quarter ends.', ''],
  ];
  return {
    text: `GST ${showMonth(month)}: net sales ${inr(s.net.taxable)} before GST on ${plural(s.bills, 'bill')}, tax ${inr(s.tax)} after credit notes; GSTR-1 due ${showDate(due)} (monthly).`,
    file: `GST-summary-${month}`,
    sheets: [{ name: 'GST summary', header: [`GST summary — ${showMonth(month)}${st.gstin ? ` · GSTIN ${st.gstin}` : ''}`, '₹'], rows }],
  };
}

/** the day close summary of a date (as the Day close screen) */
export async function dayCloseFile(date: string): Promise<FileReply> {
  const d = await daySummary(date);
  const summary: (string | number)[][] = [
    ...await headBlock(showDate(date), 'Amounts in ₹, with GST'),
    ['Bills', d.billsToday], ['Sales with GST (after returns)', d.sales], ['Collected', d.collected], ['Cheques still to clear', d.chequesToClear],
    ['Credit notes (with GST)', d.creditNotes], ['Cash held from earlier days', d.olderCash], ['Waiting for shop to confirm', d.waiting], ['Day closed', d.closed ? 'yes' : 'no'],
  ];
  const vans = d.trips.map(t => [t.van, t.bills, t.value, t.delivered, t.partial, t.returned]);
  const cash = d.cash.map(c => [c.name, c.n, c.collected, c.handed, c.pending]);
  const other = d.nonCash.map(p => [p.mode.toUpperCase(), p.ref, p.amount, p.by]);
  return {
    text: `Day close ${showDate(date)}: ${plural(d.billsToday, 'bill')}, sales ${inr(d.sales)}, collected ${inr(d.collected)}` + (d.cash.some(c => c.pending > 0) ? `, cash not handed over ${inr(r2(d.cash.reduce((a, c) => a + Math.max(0, c.pending), 0)))}` : '') + `${d.closed ? '' : ' — not closed yet'}.`,
    file: `Day-close-${date}`,
    sheets: [
      { name: 'Summary', header: [`Day close — ${showDate(date)}`, '₹'], rows: summary },
      { name: 'Vans', header: ['Van', 'Bills', 'Value ₹ (with GST)', 'Delivered', 'Part', 'Returned'], rows: vans },
      { name: 'Cash by staff', header: ['Staff', 'Payments', 'Collected ₹', 'Handed ₹', 'Still with them ₹'], rows: cash },
      { name: 'UPI & cheques', header: ['Mode', 'Ref', '₹', 'By'], rows: other },
    ],
  };
}

/** attendance: one day (check-in / out times, leave, absent) or a month (present / leave / absent days, as the salary sheet) */
export async function attendanceFile(day: string | null, month: string): Promise<FileReply> {
  if (!day) {
    const rows = await salarySheet(month);
    return {
      text: `Attendance ${showMonth(month)}: ${plural(rows.length, 'person', 'people')}.`,
      file: `Attendance-${month}`,
      sheets: [{ name: 'Attendance', header: ['Name', 'Role', 'Working days', 'Present', 'Paid leave', 'Unpaid leave', 'Absent'], rows: rows.map(r => [r.s.name, r.s.role, r.workDays, r.present, r.paidLeave, r.unpaidLeave, r.absent]) }],
    };
  }
  const staff = (await db.staff.toArray()).filter(s => s.active && s.role !== 'owner');
  const cis = await db.checkIns.where('date').equals(day).toArray();
  const leave = (await db.leaves.toArray()).filter(l => l.status === 'approved' && l.from <= day && l.to >= day);
  const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  const rows = staff.map(s => {
    const c = cis.find(x => x.staffId === s.id), l = leave.find(x => x.staffId === s.id);
    return [s.name, s.role, c ? (c.late ? 'present (late)' : 'present') : l ? 'leave' : 'absent', time(c?.at), time(c?.out), l?.reason ?? ''];
  });
  const present = rows.filter(r => String(r[2]).startsWith('present')).length;
  return {
    text: `Attendance ${showDate(day)}: ${present} of ${staff.length} present` + (leave.length ? `, ${leave.length} on leave` : '') + '.',
    file: `Attendance-${day}`,
    sheets: [{ name: 'Attendance', header: ['Name', 'Role', 'Status', 'In', 'Out', 'Leave reason'], rows }],
  };
}

/** trip reports: km from the GPS track, stops done, idle minutes, diesel — the Trip reports screen's rows */
export async function tripRows(limit = 20) {
  const vans = new Map((await db.vans.toArray()).map(v => [v.id, v.name]));
  const invs = await db.invoices.toArray();
  const exp = await db.expenses.toArray();
  const ts = (await db.trips.toArray()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  return ts.map((t: Trip) => {
    let km = 0, idle = 0;
    for (let i = 1; i < t.track.length; i++) { const a = t.track[i - 1], b = t.track[i]; const d = Math.hypot((b.lat - a.lat) * 111, (b.lng - a.lng) * 111 * Math.cos(a.lat * Math.PI / 180)); km += d; if (d < 0.1) idle += (new Date(b.at).getTime() - new Date(a.at).getTime()) / 60000; }
    const ti = invs.filter(i => i.tripId === t.id);
    return { t, van: vans.get(t.vanId) ?? '', stops: t.stops.length, done: ti.filter(i => ['delivered', 'partial'].includes(i.deliveryStatus)).length, km: r2(km), idleMin: Math.round(idle), fuel: exp.filter(e => e.vanId === t.vanId && e.date === t.date && e.category === 'diesel').reduce((a, e) => a + e.amount, 0) };
  });
}
export async function tripFile(): Promise<FileReply> {
  const rows = await tripRows(200);
  return {
    text: `Trip reports: ${plural(rows.length, 'trip')}, ${r2(rows.reduce((a, r) => a + r.km, 0))} km, diesel ${inr(rows.reduce((a, r) => a + r.fuel, 0))}.`,
    file: `Trips-${today()}`,
    sheets: [{ name: 'Trips', header: ['Date', 'Van', 'Stops', 'Done', 'km', 'Idle min', 'Diesel ₹'], rows: rows.map(r => [showDate(r.t.date), r.van, r.stops, r.done, r.km, r.idleMin, r.fuel]) }],
  };
}

export const sendFile = (f: FileReply) => downloadWorkbook(f.file, f.sheets);
