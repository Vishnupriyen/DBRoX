// Tamil / English text. Keep words simple: users include people who read little English.
export type Lang = 'en' | 'ta';

const T = {
  appTagline: { en: 'Send. Say. Approve.', ta: 'அனுப்புங்கள். சொல்லுங்கள். ஒப்புதல் தாருங்கள்.' },
  chat: { en: 'Chat', ta: 'அரட்டை' },
  today: { en: 'Today', ta: 'இன்று' },
  delivery: { en: 'Delivery', ta: 'டெலிவரி' },
  collect: { en: 'Collect', ta: 'வசூல்' },
  more: { en: 'More', ta: 'மேலும்' },
  typeHere: { en: 'Type or speak… e.g. "add this to inventory"', ta: 'தட்டச்சு அல்லது பேசுங்கள்… எ.கா. "இதை ஸ்டாக்கில் சேர்"' },
  send: { en: 'Send', ta: 'அனுப்பு' },
  attach: { en: 'Attach', ta: 'இணை' },
  approve: { en: 'Approve ✓', ta: 'ஒப்புதல் ✓' },
  cancel: { en: 'Cancel', ta: 'ரத்து' },
  undo: { en: 'Undo', ta: 'திரும்பப் பெறு' },
  download: { en: 'Download Excel', ta: 'Excel பதிவிறக்கு' },
  fixRed: { en: 'Fix the red cells, then approve', ta: 'சிவப்பு கட்டங்களைச் சரிசெய்து ஒப்புதல் தாருங்கள்' },
  allGood: { en: 'All checks passed', ta: 'எல்லா சோதனைகளும் சரி' },
  done: { en: 'Done', ta: 'முடிந்தது' },
  undone: { en: 'Undone', ta: 'திரும்பப் பெறப்பட்டது' },
  login: { en: 'Log in', ta: 'உள்நுழை' },
  phone: { en: 'Phone number', ta: 'கைபேசி எண்' },
  pin: { en: '4-digit PIN', ta: '4 இலக்க PIN' },
  wrongPin: { en: 'Wrong phone or PIN', ta: 'தவறான எண் அல்லது PIN' },
  logout: { en: 'Log out', ta: 'வெளியேறு' },
  sales: { en: 'Sales', ta: 'விற்பனை' },
  collected: { en: 'Collected', ta: 'வசூலானது' },
  outstanding: { en: 'Outstanding', ta: 'நிலுவை' },
  edit: { en: 'Edit', ta: 'மாற்று' },
  cashInHand: { en: 'Cash in hand', ta: 'கையிருப்பு பணம்' },
  needsOk: { en: 'Needs your OK', ta: 'உங்கள் ஒப்புதல் தேவை' },
  alerts: { en: 'Alerts', ta: 'எச்சரிக்கைகள்' },
  delivered: { en: 'Delivered ✓', ta: 'டெலிவரி ஆனது ✓' },
  short: { en: 'Short / damage', ta: 'குறைவு / சேதம்' },
  returnAll: { en: 'Return all', ta: 'முழுவதும் திரும்ப' },
  shopConfirm: { en: 'Shop taps ✓ to confirm', ta: 'கடைக்காரர் ✓ அழுத்தி உறுதிசெய்யவும்' },
  received: { en: 'received', ta: 'பெறப்பட்டது' },
  rupees: { en: 'rupees', ta: 'ரூபாய்' },
  pending: { en: 'Pending', ta: 'நிலுவையில்' },
  modules: { en: 'Modules', ta: 'தொகுதிகள்' },
  settings: { en: 'Settings', ta: 'அமைப்புகள்' },
  history: { en: 'History', ta: 'வரலாறு' },
  notInPlan: { en: 'This needs {m}. Turn it on in More → Modules.', ta: 'இதற்கு {m} தேவை. மேலும் → தொகுதிகளில் இயக்கவும்.' },
  help: { en: 'Help', ta: 'உதவி' },
  cash: { en: 'Cash', ta: 'பணம்' },
  upi: { en: 'UPI', ta: 'UPI' },
  cheque: { en: 'Cheque', ta: 'காசோலை' },
  amount: { en: 'Amount', ta: 'தொகை' },
  save: { en: 'Save', ta: 'சேமி' },
  shop: { en: 'Shop', ta: 'கடை' },
  bills: { en: 'Bills', ta: 'பில்கள்' },
  noItems: { en: 'Nothing here yet', ta: 'இங்கு இன்னும் எதுவும் இல்லை' },
  offline: { en: 'Offline — saved on phone, will sync', ta: 'இணையம் இல்லை — போனில் சேமிக்கப்பட்டது' },
  takePhoto: { en: 'Take photo', ta: 'போட்டோ எடு' },
  print: { en: 'Print', ta: 'அச்சிடு' },
  settle: { en: 'Receive cash', ta: 'பணம் பெறு' },
} as const;

export type TKey = keyof typeof T;

let lang: Lang = (localStorageGet('dbrox.lang') as Lang) || 'en';
export function getLang() { return lang; }
export function setLang(l: Lang) { lang = l; localStorageSet('dbrox.lang', l); }
export function t(k: TKey, vars?: Record<string, string>): string {
  let s: string = T[k][lang];
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
  return s;
}

function localStorageGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

export const inr = (n: number) =>
  '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Speak a short line in Tamil (or English) with the phone's free built-in voice.
const VOICE = false;
export function speak(text: string, l: Lang = 'ta') {
  // Voice prompts are off until the owner asks for them (locked spec 15.2).
  if (!VOICE) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = l === 'ta' ? 'ta-IN' : 'en-IN';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no voice on this phone */ }
}
