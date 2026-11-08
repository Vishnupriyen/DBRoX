// RoX Scan on the server: the AI key never leaves the server.
// The AI only READS the photo into JSON. The phone's code validates every number and a person approves.
import { config } from './config.js';

export type ScanKind = 'purchase' | 'expense' | 'order';

const PROMPTS: Record<ScanKind, string> = {
  purchase: `This is an Indian FMCG purchase invoice (company to distributor). Read it exactly as printed.
Return ONLY JSON: {"supplier":string,"supplierGstin":string,"billNo":string,"date":"YYYY-MM-DD","total":number,
"lines":[{"item":string,"code":string,"hsn":string,"batch":string,"expiry":"YYYY-MM-DD","mrp":number,"qty":number,
"free":number,"rate":number,"discount":number,"gst":number,"amount":number}]}
Rules: qty in pieces as printed; rate per piece before tax; discount in rupees for the line; gst = total GST % (CGST+SGST or IGST);
amount = the line's taxable value if printed, else the line total. Use "" or 0 for anything not printed. Never guess numbers.`,
  expense: `This is a bill or receipt for a business expense (fuel, toll, repair, etc.) in India.
Return ONLY JSON: {"supplier":string,"date":"YYYY-MM-DD","amount":number,"category":string}
amount = the final amount paid. Use "" or 0 for anything not printed.`,
  order: `This is a handwritten or printed order (diary page / note) from a shop to an FMCG distributor in Tamil Nadu.
Return ONLY JSON: {"shop":string,"lines":[{"item":string,"qty":number}]}
qty is the number written; keep the unit word inside item if written (e.g. "Surf 1kg case"). Do not invent items.`,
};

export async function scanWithAI(kind: ScanKind, dataUrl: string): Promise<unknown> {
  if (!config.anthropicKey) throw Object.assign(new Error('AI reading is not configured on this server'), { statusCode: 503 });
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw Object.assign(new Error('Bad file'), { statusCode: 400 });
  const [, mediaType, data] = m;
  if (data.length > 7_000_000) throw Object.assign(new Error('File too large'), { statusCode: 413 });
  const fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) { // retry on overload / network errors
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: config.aiModel, max_tokens: 4096, temperature: 0,
          system: 'You read business documents into JSON. Output only valid JSON, no explanation.',
          messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: PROMPTS[kind] }] }],
        }),
      });
      if (r.status === 429 || r.status >= 500) { lastErr = new Error(`AI busy (${r.status})`); await new Promise(res => setTimeout(res, 800 * (attempt + 1))); continue; }
      if (!r.ok) throw Object.assign(new Error(`AI error ${r.status}: ${(await r.text()).slice(0, 200)}`), { statusCode: 502 });
      const j = await r.json() as { content: { type: string; text?: string }[] };
      const text = j.content.filter(c => c.type === 'text').map(c => c.text).join('');
      return parseJson(text);
    } catch (e) { lastErr = e; if ((e as { statusCode?: number }).statusCode) throw e; }
  }
  throw Object.assign(lastErr instanceof Error ? lastErr : new Error('AI failed'), { statusCode: 503 });
}

export function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw Object.assign(new Error('AI did not return a table'), { statusCode: 502 });
  return JSON.parse(cleaned.slice(start, end + 1));
}
