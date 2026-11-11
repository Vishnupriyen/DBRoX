// Shared premium outline icons; the same symbols across products and roles.
import { ShoppingCart, ReceiptText, Truck, Wallet, BookOpen, Layers, FileCheck2, Users, CircleCheck, MoreHorizontal, House, Sparkles } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
type P = { size?: number; style?: CSSProperties; className?: string };
export const RoxMark = (p: P) => <Sparkles {...p} strokeWidth={1.7} />;
export const IcSales = (p: P) => <ShoppingCart {...p} strokeWidth={1.7} />;
export const IcBill = (p: P) => <ReceiptText {...p} strokeWidth={1.7} />;
export const IcDelivery = (p: P) => <Truck {...p} strokeWidth={1.7} />;
export const IcCollection = (p: P) => <Wallet {...p} strokeWidth={1.7} />;
export const IcAccountant = (p: P) => <BookOpen {...p} strokeWidth={1.7} />;
export const IcInventory = (p: P) => <Layers {...p} strokeWidth={1.7} />;
export const IcGst = (p: P) => <FileCheck2 {...p} strokeWidth={1.7} />;
export const IcPayroll = (p: P) => <Users {...p} strokeWidth={1.7} />;
export const IcDayClose = (p: P) => <CircleCheck {...p} strokeWidth={1.7} />;
export const IcMore = (p: P) => <MoreHorizontal {...p} strokeWidth={1.7} />;
export const IcHome = (p: P) => <House {...p} strokeWidth={1.7} />;
export const MODULE_ICON: Record<string, (p: P) => ReactElement> = { sales: IcSales, bill: IcBill, delivery: IcDelivery, collection: IcCollection, accountant: IcAccountant, inventory: IcInventory, gst: IcGst, payroll: IcPayroll, dayclose: IcDayClose };
