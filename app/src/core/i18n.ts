// Screen words in one place. English only for launch; keep words simple: some users read little English.

const T = {
  appTagline: 'Send. Say. Approve.',
  chat: 'Chat',
  today: 'Today',
  delivery: 'Delivery',
  collect: 'Collect',
  more: 'More',
  typeHere: 'Type or speak… e.g. "add this to inventory"',
  send: 'Send',
  attach: 'Attach',
  approve: 'Approve ✓',
  cancel: 'Cancel',
  undo: 'Undo',
  download: 'Download Excel',
  fixRed: 'Fix the red cells, then approve',
  allGood: 'All checks passed',
  done: 'Done',
  undone: 'Undone',
  login: 'Log in',
  phone: 'Phone number',
  pin: '4-digit PIN',
  wrongPin: 'Wrong phone or PIN',
  logout: 'Log out',
  sales: 'Sales',
  collected: 'Collected',
  outstanding: 'Outstanding',
  edit: 'Edit',
  cashInHand: 'Cash in hand',
  needsOk: 'Needs your OK',
  alerts: 'Alerts',
  delivered: 'Delivered ✓',
  short: 'Short / damage',
  returnAll: 'Return all',
  shopConfirm: 'Shop taps ✓ to confirm',
  received: 'received',
  rupees: 'rupees',
  pending: 'Pending',
  modules: 'Modules',
  settings: 'Settings',
  history: 'History',
  notInPlan: 'This needs {m}. Turn it on in More → Modules.',
  help: 'Help',
  cash: 'Cash',
  upi: 'UPI',
  cheque: 'Cheque',
  amount: 'Amount',
  save: 'Save',
  shop: 'Shop',
  bills: 'Bills',
  noItems: 'Nothing here yet',
  offline: 'Offline — saved on phone, will sync',
  listening: 'Listening…',
  thinking: 'Working on it…',
  askMe: 'Type or send a photo',
  takePhoto: 'Take photo',
  print: 'Print',
  settle: 'Receive cash',
} as const;

export type TKey = keyof typeof T;

export function t(k: TKey, vars?: Record<string, string>): string {
  let s: string = T[k];
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
  return s;
}


// Money the Indian way: ₹1,23,456 for whole rupees, ₹1,23,456.50 when there are paise (never ₹1,23,456.5).
export const inr = (n: unknown) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const paise = Math.abs(v % 1) > 0.004;
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: paise ? 2 : 0 });
};
/** whole rupees, for targets, averages and "needed per day" (paise there is noise) */
export const inrR = (n: unknown) => inr(Math.round(Number(n) || 0));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** a date as people say it: "11 Nov" this year, "11 Nov 2025" otherwise (input YYYY-MM-DD or a full timestamp) */
export function showDate(iso?: string | null) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso ?? '';
  const y = iso.slice(0, 4), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const thisYear = String(new Date().getFullYear());
  return `${d} ${MON[m - 1]}${y === thisYear ? '' : ` ${y}`}`;
}
/** a month as people say it: "Nov 2026" (input YYYY-MM) */
export function showMonth(ym?: string | null) {
  if (!ym || !/^\d{4}-\d{2}/.test(ym)) return ym ?? '';
  return `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}
/** "1 bill", "3 bills"; irregular plurals passed in ("1 company", "2 companies") */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Speak a short line with the phone's free built-in voice.
const VOICE = false;
export function speak(text: string) {
  // Voice prompts are off until the owner asks for them (locked spec 15.2).
  if (!VOICE) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-IN';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no voice on this phone */ }
}
