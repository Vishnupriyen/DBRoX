// The salary sheet (BA TRUST18). Every working day of the month is one of: present (checked in), on approved leave, or
// absent with no explanation. Sundays are the weekly off. The owner sets how many leave days a month are paid (2 if not
// set); leave beyond that and every unexplained absence is cut at salary ÷ days in the month. The sheet shows the days
// it counted, so the person can check them.
import { db, getSettings, localDay, today } from './db';
import type { Advance, Staff } from './types';

const dayList = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};
const isSunday = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay() === 0; };

export interface SalaryRow {
  s: Staff;
  daysInMonth: number; workDays: number; // working days counted (Sundays off; days before today, from the day they joined)
  present: number; leave: number; paidLeave: number; unpaidLeave: number; absent: number; cutDays: number;
  beforeJoining: number; // calendar days of the month before the person joined (not paid)
  fixed: number; cut: number; batta: number; gross: number;
  advance: number; shortfall: number; net: number; carry: number; paid: boolean; takes: { id: string; take: number }[];
}

export async function salarySheet(month: string): Promise<SalaryRow[]> {
  const st = await getSettings();
  const paidLeaves = st.paidLeaves ?? 2;
  const staff = (await db.staff.toArray()).filter(s => s.active && s.role !== 'owner');
  const cis = (await db.checkIns.toArray()).filter(c => c.date.startsWith(month));
  const leaves = (await db.leaves.toArray()).filter(l => l.status === 'approved' && l.from <= `${month}-31` && l.to >= `${month}-01`);
  const adv: Advance[] = (await db.advances.toArray()).filter(a => a.status === 'approved' && (a.recovered ?? 0) < a.amount);
  const paidExp = (await db.expenses.toArray()).filter(e => e.category === 'salary' && e.note?.includes(`Salary ${month} `));
  const days = dayList(month);
  const t = today();
  return staff.map(s => {
    const joined = localDay(s.createdAt);
    const work = days.filter(d => !isSunday(d) && d < t && d >= joined); // today is not over yet: never an absence
    const present = new Set(cis.filter(c => c.staffId === s.id).map(c => c.date));
    const onLeave = (d: string) => leaves.some(l => l.staffId === s.id && l.from <= d && l.to >= d);
    let leave = 0, absent = 0;
    for (const d of work) { if (present.has(d)) continue; if (onLeave(d)) leave++; else absent++; }
    const p = present.size; // every day worked (a Sunday worked too) earns its batta
    const paidLeave = Math.min(leave, paidLeaves), unpaidLeave = leave - paidLeave;
    const cutDays = unpaidLeave + absent;
    const fixed = s.salary ?? 0;
    // pay only from the joining date: salary ÷ days in the month × days since joining (the days before are not paid)
    const beforeJoining = days.filter(d => d < joined).length;
    const cut = Math.round(fixed * (cutDays + beforeJoining) / days.length);
    const batta = p * (s.batta ?? 0);
    const gross = Math.max(0, Math.round(fixed - cut + batta));
    // recoveries never take more than the salary: advance instalments first, then cash shortfalls; the rest carries over
    let room = gross; let advance = 0, shortfall = 0, due = 0; const takes: { id: string; take: number }[] = [];
    const mine = adv.filter(a => a.staffId === s.id).sort((a, b) => (a.kind === 'shortfall' ? 1 : 0) - (b.kind === 'shortfall' ? 1 : 0));
    for (const a of mine) {
      const owe = a.kind === 'shortfall' ? a.amount - (a.recovered ?? 0) : Math.min(a.amount - (a.recovered ?? 0), Math.ceil(a.amount / (a.instalments || 1)));
      const take = Math.max(0, Math.min(owe, room)); room -= take; due += owe;
      if (a.kind === 'shortfall') shortfall += take; else advance += take;
      if (take > 0) takes.push({ id: a.id, take });
    }
    const net = gross - advance - shortfall;
    return {
      s, beforeJoining, daysInMonth: days.length, workDays: work.length, present: p, leave, paidLeave, unpaidLeave, absent, cutDays,
      fixed, cut, batta, gross, advance, shortfall, net, carry: due - advance - shortfall, takes,
      paid: paidExp.some(e => e.note === `Salary ${month} ${s.name}`),
    };
  });
}
