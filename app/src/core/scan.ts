// TESRAX Scan: photo / scanned PDF → structured data, via the Hanubix server (which holds the AI key).
// The phone never holds the AI key. The AI only reads; code validates; a person approves.
import { server } from './sync';

export type ScanKind = 'purchase' | 'expense' | 'order';

export interface ScanResult {
  supplier?: string; supplierGstin?: string; billNo?: string; date?: string; total?: number;
  shop?: string; category?: string; amount?: number;
  lines?: { item: string; code?: string; hsn?: string; batch?: string; expiry?: string; mrp?: number; qty: number; free?: number; rate?: number; discount?: number; gst?: number; amount?: number }[];
}

export class NoServerError extends Error {}

export async function fileToDataUrl(file: File, maxSide = 1600, quality = 0.8): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  }
  // Compress photos before upload/storage (scale plan: ~100–300 KB per photo)
  const img = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Quick blur check on the phone, before spending an AI call (variance of a simple edge filter).
export async function looksBlurry(file: File): Promise<boolean> {
  if (!file.type.startsWith('image/')) return false;
  const img = await createImageBitmap(file);
  const w = 320, h = Math.round(320 * img.height / img.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = (x: number, y: number) => { const i = (y * w + x) * 4; return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; };
  let sum = 0, sq = 0, cnt = 0;
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const lap = 4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1);
    sum += lap; sq += lap * lap; cnt++;
  }
  const variance = sq / cnt - (sum / cnt) ** 2;
  return variance < 60;
}

export async function scanFile(file: File, kind: ScanKind): Promise<ScanResult> {
  const url = await server();
  if (!url) throw new NoServerError('not connected');
  const dataUrl = await fileToDataUrl(file);
  const token = localStorage.getItem('dbrox.token') ?? '';
  const res = await fetch(`${url}/v1/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind, file: dataUrl, name: file.name }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `Scan failed (${res.status})`); }
  return await res.json();
}
