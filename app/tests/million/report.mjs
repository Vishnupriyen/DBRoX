// Combines the shard results: accuracy per kind of request and the misreadings grouped by pattern.
import { readFileSync, readdirSync } from 'node:fs';
const dir = new URL('./out/', import.meta.url);
const shards = readdirSync(dir).filter(f => f.startsWith('shard-')).map(f => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
const per = {}; let ran = 0, total = 0, secs = 0; const misses = [];
for (const s of shards) { ran += s.ran; total = s.total; secs = Math.max(secs, s.seconds); misses.push(...s.misses); for (const [k, v] of Object.entries(s.per)) { per[k] ??= { n: 0, ok: 0 }; per[k].n += v.n; per[k].ok += v.ok; } }
const ok = ran - misses.length;
console.log(`TESRAX MILLION: ${ok.toLocaleString('en-IN')}/${ran.toLocaleString('en-IN')} understood (${(ok / ran * 100).toFixed(3)}%) · generated ${total.toLocaleString('en-IN')} · ${secs}s`);
for (const [k, v] of Object.entries(per).sort()) console.log(`  ${k.padEnd(12)} ${String(v.ok).padStart(7)}/${String(v.n).padEnd(7)} ${(v.ok / v.n * 100).toFixed(2)}%`);
const groups = {};
for (const m of misses) { const key = `${m.intent} | want ${m.want.split(':')[0]} | got ${m.got.split(':')[0]}`; (groups[key] ??= []).push(m); }
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, Number(process.argv[2] ?? 40))) {
  console.log(`\n${v.length}× ${k}`);
  for (const m of v.slice(0, Number(process.argv[3] ?? 4))) console.log(`   [${m.role}] ${m.said}  →  want ${m.want}  got ${m.got}`);
}
