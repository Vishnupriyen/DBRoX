// DBRoX icon set — bold solid glyphs with one accent detail, drawn for us. Ink = currentColor, accent = --accent.
import type React from 'react';
// Used for the module tiles, the header mark and RoX. Sub-screens use the same style via <Glyph/> wrappers.
import type { CSSProperties } from 'react';

type P = { size?: number; style?: CSSProperties; className?: string };
const S = ({ size = 28, children, style, className }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 48 48" width={size} height={size} style={style} className={className} aria-hidden="true">{children}</svg>
);
const A = 'var(--accent)';

export const RoxMark = ({ size = 28, style, className }: P) => (
  <S size={size} style={style} className={className}>
    {/* R built from a kolam-like block, accent dot in the counter */}
    <path fill="currentColor" d="M12 6h16a12 12 0 0 1 4.6 23.1L40 42h-9l-6.2-11H19v11h-7zM19 13v11h9a5.5 5.5 0 0 0 0-11z" />
    <circle cx="25" cy="18.5" r="3" fill={A} />
  </S>
);
export const IcSales = (p: P) => (
  <S {...p}><path fill="currentColor" d="M11 6h18l9 9v9a2 2 0 0 1-2 2h-8v-5H14v-3h14v-4H14v-3h10V9H14v30h8v3H11a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z" /><path fill="currentColor" d="M14 21h14v3H14zM14 29h10v3H14z" /><path fill={A} d="M27 33h8l-3.5-3.5 2.3-2.3L41 34.5l-7.2 7.3-2.3-2.3L35 36h-8z" /></S>
);
export const IcBill = (p: P) => (
  <S {...p}><path fill="currentColor" d="M11 5h26a3 3 0 0 1 3 3v22l-3.2-2.6L33 30l-3.5-2.6-3.5 2.6-3.5-2.6L19 30l-3.5-2.6L12 30l-4 3V8a3 3 0 0 1 3-3zm5 9h16v3H16zm0 7h16v3H16zm0 7h9v3h-9z" /><path fill={A} d="M30 38l3.5 3.5L41 34l2.5 2.5L33.5 46.5 27.5 40.5z" /></S>
);
export const IcDelivery = (p: P) => (
  <S {...p}><path fill="currentColor" d="M4 11h24a2 2 0 0 1 2 2v17H4zM30 18h7l6 7v5h-13zM10 33a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm24 0a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" /><path fill={A} d="M39 24l5 5-5 5-2.4-2.4L39.2 29l-2.6-2.6z" /></S>
);
export const IcCollection = (p: P) => (
  <S {...p}><path fill="currentColor" d="M8 10h25l4 6H8zM6 17h32a4 4 0 0 1 4 4v3h-9a5 5 0 0 0 0 10h9v4a4 4 0 0 1-4 4H6a3 3 0 0 1-3-3V20a3 3 0 0 1 3-3z" /><circle cx="33" cy="29" r="3" fill={A} /><path fill="currentColor" d="M42 26v6h-9a3 3 0 0 1 0-6z" opacity=".35" /></S>
);
export const IcAccountant = (p: P) => (
  <S {...p}><path fill="currentColor" d="M5 10c6-2 11-2 17 1v29c-6-3-11-3-17-1zM43 10c-6-2-11-2-17 1v29c6-3 11-3 17-1z" /><path fill="var(--card)" d="M9 18h9v3H9zm0 6h9v3H9z" /><path fill={A} d="M30 18h9v3h-9zm0 6h9v3h-9z" /></S>
);
export const IcInventory = (p: P) => (
  <S {...p}><path fill="currentColor" d="M24 4l18 9v22l-18 9L6 35V13zm0 5.5L11.5 15.5 24 21.5l12.5-6zM10 19v14l12 6V25zm28 0l-12 6v14l12-6z" /><path fill={A} d="M30 11l-13 6.5v8l4-2V19.5L34 13z" /></S>
);
export const IcGst = (p: P) => (
  <S {...p}><path fill="currentColor" d="M10 5h19l10 10v25a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zm8 14a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm12 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-2.4-10.5l2.6 2L19.4 37l-2.6-2z" /><path fill={A} d="M29 5l10 10H29z" /></S>
);
export const IcPayroll = (p: P) => (
  <S {...p}><path fill="currentColor" d="M8 10h32a3 3 0 0 1 3 3v27a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3zm9-5h4v8h-4zm10 0h4v8h-4zM18 22h12v2.5h-3.2c.3.6.5 1.2.6 1.9H30V29h-2.7c-.6 2.6-2.8 4.1-5.8 4.4L28 40h-3.6l-6.8-7v-2.2h2.5c2 0 3.2-.6 3.7-1.8H18v-2.6h5.8c-.5-1-1.7-1.5-3.3-1.5H18z" /><path fill={A} d="M20 15h8v3h-8z" /></S>
);
export const IcDayClose = (p: P) => (
  <S {...p}><path fill="currentColor" d="M24 5a19 19 0 1 1-13.4 32.4l3.5-3.5A14 14 0 1 0 38 24h5A19 19 0 0 1 24 43 19 19 0 0 1 24 5z" /><path fill="currentColor" d="M15 24l3.2-3.2 4.3 4.3 9.3-9.3L35 19 22.5 31.5z" /><path fill={A} d="M37 8l3 3-6 6-3-3z" /></S>
);
export const IcMore = (p: P) => (
  <S {...p}><circle cx="12" cy="24" r="4.5" fill="currentColor" /><circle cx="24" cy="24" r="4.5" fill="currentColor" /><circle cx="36" cy="24" r="4.5" fill={A} /></S>
);
export const IcHome = (p: P) => (
  <S {...p}><path fill="currentColor" d="M24 6l19 16h-5v19a2 2 0 0 1-2 2H28V30h-8v13H12a2 2 0 0 1-2-2V22H5z" /><path fill={A} d="M20 30h8v4h-8z" /></S>
);

export const MODULE_ICON: Record<string, (p: P) => React.ReactElement> = {
  sales: IcSales, bill: IcBill, delivery: IcDelivery, collection: IcCollection, accountant: IcAccountant,
  inventory: IcInventory, gst: IcGst, payroll: IcPayroll, dayclose: IcDayClose,
};
