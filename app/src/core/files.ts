// Saving and printing that work both in a browser and inside the Android app. In the app a web "download" does
// nothing, so the file is written to the phone and the share sheet opens (save to Files or Drive, send on WhatsApp,
// e-mail to the accountant); printing opens Android's print screen (a printer, or "Save as PDF").
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isApp = () => Capacitor.isNativePlatform();

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** save a file: a download in a browser, the share sheet in the app */
export async function saveFile(filename: string, data: string | Uint8Array, type: string) {
  if (!isApp()) {
    const blob = new Blob([typeof data === 'string' ? data : data.slice().buffer], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const w = await Filesystem.writeFile({ path: filename, data: b64(bytes), directory: Directory.Cache });
  await Share.share({ title: filename, files: [w.uri], dialogTitle: `Save or send ${filename}` }).catch(() => { /* closed without choosing */ });
}

const NativePrint = registerPlugin<{ print(o: { name: string }): Promise<void> }>('HanubixPrint');
/** print what is on screen (bills and reports have print layouts): the browser's print, or Android's print screen */
export async function printPage(name = 'Hanubix') {
  if (isApp()) await NativePrint.print({ name }); else window.print();
}

/** send a short text (a receipt) — the share sheet in the app (WhatsApp, SMS app…), WhatsApp on the web.
 *  phone: the shop's 10-digit mobile, so WhatsApp opens that chat */
export async function shareText(text: string, phone?: string) {
  if (isApp()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ text, dialogTitle: 'Send receipt' }).catch(() => { /* closed without choosing */ });
    return;
  }
  const to = (phone ?? '').replace(/\D/g, '').slice(-10);
  window.open(`https://wa.me/${to ? `91${to}` : ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
