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


export const inr = (n: number) =>
  '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

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
