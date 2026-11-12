// TESRAX: every owner report by name and period ("fast movers last month", "send day book october", "all reports").
// The same figures as the Reports screen (buildReports); the answer is the report's table, and its Excel button sends it.
import { daysFrom, monthEnd, thisMonth, today, ymd } from './db';
import { showDate, showMonth } from './i18n';
import { buildReports, prevMonth, type Period } from './reports';
import { downloadWorkbook } from './readers';
import type { Reply } from './engine';
import type { Role } from './types';

/** the report a message names, longest phrases first inside each report */
export const REPORT_WORDS: { key: string; words: string[] }[] = [
  { key: 'all', words: ['all reports', 'all report', 'every report', 'full report', 'full reports', 'reports excel', 'reports in excel', 'all reports excel'] },
  { key: 'daybook', words: ['day book', 'daybook', 'bill wise', 'billwise', 'bill register', 'sales register', 'invoice register', 'bills register'] },
  { key: 'collections', words: ['collections by person', 'collection by person', 'collection report', 'collections report', 'collection register', 'who collected', 'collected by'] },
  { key: 'fast', words: ['fast movers', 'fast mover', 'fast moving', 'fast selling', 'top selling', 'best selling', 'best sellers', 'top products', 'top items'] },
  { key: 'slow', words: ['slow movers', 'slow mover', 'slow moving', 'slow selling'] },
  { key: 'dead', words: ['dead stock', 'not moving', 'non moving', 'nonmoving', 'no movement'] },
  { key: 'himargin', words: ['high margin', 'best margin', 'top margin', 'most margin', 'highest margin'] },
  { key: 'lomargin', words: ['low margin', 'least margin', 'lowest margin', 'poor margin'] },
  { key: 'shop', words: ['shop wise', 'shopwise', 'shop-wise', 'sales by shop', 'shop sales', 'top shops', 'best shops', 'shop report', 'shops report'] },
  { key: 'company', words: ['company wise', 'companywise', 'company-wise', 'brand wise', 'brandwise', 'sales by company', 'company sales report'] },
  { key: 'salesman', words: ['salesman wise', 'salesmanwise', 'salesman-wise', 'staff wise', 'sales by salesman', 'salesman sales', 'salesman report', 'salesman performance'] },
  { key: 'area', words: ['area wise', 'areawise', 'area-wise', 'route wise', 'sales by area', 'area sales', 'area report'] },
  { key: 'returns', words: ['returns report', 'return report', 'returns list', 'credit notes report', 'credit note report', 'credit notes list'] },
  { key: 'scheme', words: ['scheme cost', 'schemes cost', 'scheme report', 'schemes report', 'scheme wise', 'scheme spend'] },
  { key: 'sales', words: ['sales report', 'sales reports', 'net sales report', 'sales excel', 'sales file'] },
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const inText = (t: string, w: string) => ` ${t} `.includes(` ${w} `);

/** the period a message names; this month when it names none */
export function periodIn(text: string): Period {
  const t = today();
  if (/\byesterday\b/.test(text)) { const d = daysFrom(-1); return { from: d, to: d, label: `Yesterday (${showDate(d)})` }; }
  if (/\btoday\b/.test(text)) return { from: t, to: t, label: `Today (${showDate(t)})` };
  const [y, m, d] = t.split('-').map(Number), dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  if (/\blast week\b/.test(text)) { const from = ymd(new Date(y, m - 1, d - dow - 7)), to = ymd(new Date(y, m - 1, d - dow - 1)); return { from, to, label: `Last week (${showDate(from)} – ${showDate(to)})` }; }
  if (/\b(this week|week)\b/.test(text)) { const from = ymd(new Date(y, m - 1, d - dow)); return { from, to: t, label: `This week (${showDate(from)} – ${showDate(t)})` }; }
  if (/\b(90 days|3 months|three months|quarter)\b/.test(text)) { const from = daysFrom(-90); return { from, to: t, label: 'Last 90 days' }; }
  if (/\blast month\b|\bprevious month\b/.test(text)) { const mm = prevMonth(thisMonth()); return { from: `${mm}-01`, to: monthEnd(mm), label: showMonth(mm), month: mm }; }
  const word = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/)?.[1];
  const named = word ? MONTHS.indexOf(word.slice(0, 3)) : -1;
  if (named >= 0) {
    const yr = Number(text.match(/\b(20\d\d)\b/)?.[1] ?? (named + 1 > m ? y - 1 : y));
    const mm = `${yr}-${String(named + 1).padStart(2, '0')}`;
    return { from: `${mm}-01`, to: monthEnd(mm), label: showMonth(mm), month: mm };
  }
  const mm = thisMonth();
  return { from: `${mm}-01`, to: t, label: `This month (${showMonth(mm)})`, month: mm };
}

/** which report the message asks for, or null */
export function reportKey(text: string): string | null {
  text = text.replace(/\b(top|best|bottom) \d+\b/g, '$1'); // "top 5 shops"
  for (const r of REPORT_WORDS) if (r.words.some(w => inText(text, w))) return r.key;
  return null;
}

/** "fast movers last month" → the Fast movers table for last month (owner and office) */
export async function reportByVoice(text: string, role: Role): Promise<Reply | null> {
  const key = reportKey(text);
  if (!key) return null;
  if (role !== 'owner' && role !== 'office') return { text: 'Reports are for the owner or office. Ask them, or log in as one of them.', tone: 'warn', refused: true };
  const per = periodIn(text);
  const all = await buildReports(per);
  const fileTag = per.month ?? (per.from === per.to ? per.from : `${per.from}_to_${per.to}`);
  if (key === 'all') {
    const sheets = all.map(r => ({ name: r.en, header: r.cols.map(c => c.h), rows: r.rows }));
    return {
      text: `All ${all.length} reports for ${per.label} in one Excel file: ${all.map(r => r.en).join(', ')}.`,
      actions: [{ label: 'Send all reports (Excel)', run: () => downloadWorkbook(`Hanubix-reports-${fileTag}`, sheets) }],
      link: { label: 'Open Reports', page: 'reports' },
    };
  }
  const r = all.find(x => x.key === key);
  if (!r) return null;
  return {
    text: r.rows.length ? `${r.en} — ${per.label}: ${r.rows.length} ${r.rows.length === 1 ? 'row' : 'rows'}.` : `${r.en} — ${per.label}: nothing in this period.`,
    table: r.rows.length ? { name: `Hanubix-${r.key}-${fileTag}`, columns: r.cols.map(c => c.h || r.en.split(' ')[0]), rows: r.rows } : undefined,
    actions: r.rows.length ? [{ label: 'Send as Excel', run: () => downloadWorkbook(`Hanubix-${r.key}-${fileTag}`, [{ name: r.en, header: r.cols.map(c => c.h), rows: r.rows }]) }] : undefined,
    link: { label: 'Open Reports', page: 'reports' },
  };
}
