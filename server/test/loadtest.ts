// Load test: simulates many distributors syncing at once against a running DBRoX server.
// Usage: SERVER=http://localhost:8787 TENANTS=200 PHONES=5 ROUNDS=3 npm run loadtest
// Before each growth stage run it at that stage's size (target: p95 sync under 1 s).
const SERVER = process.env.SERVER ?? 'http://localhost:8787';
const TENANTS = Number(process.env.TENANTS ?? 50);
const PHONES = Number(process.env.PHONES ?? 5);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const BILLS = Number(process.env.BILLS ?? 20); // new bills per phone per round

const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(SERVER + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
};

const times: number[] = [];
let failures = 0;
const base = 7000000000 + Math.floor(Math.random() * 900000000);

async function tenant(i: number) {
  const phone = String(base + i * 100);
  const s = await post('/v1/signup', { consent: CONSENT, firmName: `Load ${i}`, ownerName: 'Owner', phone, pin: '391742' });
  const cursors = new Array(PHONES).fill(0);
  for (let round = 0; round < ROUNDS; round++) {
    await Promise.all(cursors.map(async (cur, ph) => {
      const now = new Date().toISOString();
      const changes = Array.from({ length: BILLS }, (_, k) => ({
        table: 'invoices', id: `t${i}p${ph}r${round}b${k}`, updatedAt: now,
        data: { number: `X/${k}`, date: now.slice(0, 10), total: 1000 + k, lines: Array.from({ length: 15 }, (_, l) => ({ productId: `p${l}`, qty: 12, rate: 30, total: 378 })) },
      }));
      const t0 = performance.now();
      try {
        const r = await post('/v1/sync', { cursor: cur, changes }, s.token);
        cursors[ph] = r.cursor;
      } catch { failures++; }
      times.push(performance.now() - t0);
    }));
  }
}

const t0 = performance.now();
const batch = 25;
for (let i = 0; i < TENANTS; i += batch) await Promise.all(Array.from({ length: Math.min(batch, TENANTS - i) }, (_, k) => tenant(i + k)));
times.sort((a, b) => a - b);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(0);
console.log(`distributors ${TENANTS} · phones ${TENANTS * PHONES} · syncs ${times.length} · bills ${TENANTS * PHONES * ROUNDS * BILLS}`);
console.log(`sync time ms: p50 ${pct(0.5)} · p95 ${pct(0.95)} · p99 ${pct(0.99)} · failures ${failures} · total ${((performance.now() - t0) / 1000).toFixed(1)} s`);
