// Working-app test, part 3: one full working day on 10 separate phones (each its own browser profile), everything
// passing through the live server. Run stage by stage:  node e2e/live/day.cjs <dataDir> <outDir> <stage> [<stage>…]
// stages: login orders approve pick bill plan load deliver office close verify
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [DATA, OUT, ...STAGES] = process.argv.slice(2); fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.LIVE_URL || 'http://localhost:4180';
const FIX = path.join(__dirname, '..', 'fixtures');
const W = JSON.parse(fs.readFileSync(path.join(DATA, 'world.json'), 'utf8'));
const PROFILES = path.join(OUT, 'phones');
const results = fs.existsSync(path.join(OUT, 'day.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'day.json'), 'utf8')) : { times: {}, errors: [], notes: [], storageMB: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'day.json'), JSON.stringify(results, null, 1));
const who = (role, k = 0) => W.staff.filter(s => s[2] === role)[k];
let browserHandles = [];

async function phone(person, { slow = false } = {}) {
  const [name, ph, , pin] = person;
  const ctx = await chromium.launchPersistentContext(path.join(PROFILES, ph), { viewport: { width: 360, height: 780 }, geolocation: { latitude: 11.41, longitude: 79.12 }, permissions: ['geolocation'] });
  browserHandles.push(ctx);
  const p = ctx.pages()[0] || await ctx.newPage();
  if (slow) { const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); } // a ₹8–10k phone is about 4× slower
  p.on('pageerror', e => results.errors.push(`${name}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource|net::/.test(m.text())) results.errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
  p.on('dialog', d => d.accept());
  let n = 0;
  const api = {
    p, name, ctx,
    shot: async tag => { await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, `${name.split(' ')[0].toLowerCase()}-${String(++n).padStart(2, '0')}-${tag}.png`) }); },
    nav: async t => { await p.click(`nav >> text=${t}`); await p.waitForTimeout(500); },
    settle: async () => { await p.waitForFunction(() => ![...document.querySelectorAll('.card.muted')].some(e => /^Loading/.test(e.textContent || '')), null, { timeout: 180000 }); await p.waitForTimeout(200); },
    tile: async t => { const exact = p.locator('.tile', { hasText: new RegExp('^\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\d*\\s*$') }); if (await exact.count()) await exact.first().click(); else await p.click(`.tile:has-text("${t}")`); await p.waitForTimeout(700); await api.settle(); },
    home: async () => { await p.click('nav >> text=Home'); await p.waitForTimeout(500); },
    gate: async () => { if (await p.locator('.gate').count()) { await p.click('.gate .big-btn'); await p.waitForTimeout(800); } },
    sync: async () => { const t = Date.now(); await p.click('nav >> text=More'); await p.waitForTimeout(300); await p.click('text=Sync now'); await p.waitForSelector('.dialog', { timeout: 300000 }); const msg = await p.locator('.dialog').innerText(); await p.click('.dialog .btn'); await p.waitForTimeout(300); await api.home(); return { seconds: (Date.now() - t) / 1000, msg: msg.replace(/\s+/g, ' ') }; },
    login: async () => {
      await p.goto(URL); await p.waitForTimeout(1200);
      if (await p.locator('nav').count()) return 0; // still logged in on this phone
      const t = Date.now();
      await p.fill('#login-phone', ph); for (const d of pin) await p.click(`.pad button:text-is("${d}")`);
      await p.waitForSelector('nav, .gate', { timeout: 300000 });
      await p.waitForFunction(() => !document.querySelector('.loading, .spinner'), null, { timeout: 300000 }).catch(() => {});
      return (Date.now() - t) / 1000;
    },
    count: async t => p.evaluate(async t => { const r = indexedDB.open('dbrox'); const db = await new Promise(res => { r.onsuccess = () => res(r.result); }); return new Promise(res => { const q = db.transaction(t).objectStore(t).count(); q.onsuccess = () => res(q.result); }); }, t),
    all: async t => p.evaluate(async t => { const r = indexedDB.open('dbrox'); const db = await new Promise(res => { r.onsuccess = () => res(r.result); }); return new Promise(res => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => res(q.result); }); }, t),
    storage: async () => +((await p.evaluate(() => navigator.storage.estimate())).usage / 1048576).toFixed(1),
    tesrax: async (text, waitApprove = true) => {
      if (!(await p.locator('.engine-chat').count())) { await p.click('.fab'); await p.waitForTimeout(400); }
      await p.fill('.composer textarea', text); await p.click('button[aria-label="Send"]');
      await p.waitForFunction(() => !document.querySelector('.msg.bot.typing'), null, { timeout: 60000 }); await p.waitForTimeout(800);
      if (!(await p.locator('.engine-chat').count())) { await api.settle(); return { said: `opened the screen: ${(await p.locator('header').innerText()).replace(/\s+/g, ' ').slice(0, 80)}`, saved: false }; }
      const last = p.locator('.msg.bot').last(); const said = (await last.innerText()).replace(/\s+/g, ' ').slice(0, 200);
      const ok = last.locator('button.btn.primary:has-text("Approve")');
      if (waitApprove && await ok.count()) { const tv = Date.now(); while (await ok.isDisabled() && Date.now() - tv < 30000) await p.waitForTimeout(200); if (!(await ok.isDisabled())) { await ok.click(); await p.waitForTimeout(900); return { said, saved: true }; } }
      return { said, saved: false };
    },
    closeTesrax: async () => { if (await p.locator('.engine-x[aria-label="Close"]').count()) { await p.click('.engine-x[aria-label="Close"]'); await p.waitForTimeout(300); } },
  };
  return api;
}
async function endTripAs(ph) {
  if (!(await ph.p.locator('button:has-text("End trip")').count())) return false;
  await ph.p.click('button:has-text("End trip")'); await ph.p.waitForTimeout(500);
  await ph.p.click('button:has-text("Trip over — back at godown")'); await ph.p.waitForTimeout(800);
  return true;
}
const timed = async (k, f) => { const t = Date.now(); const r = await f(); results.times[k] = +((Date.now() - t) / 1000).toFixed(1); console.log(`${k}: ${results.times[k]} s`); save(); return r; };
const note = s => { console.log('NOTE', s); results.notes.push(s); save(); };

const stages = {
  // every phone logs in for the first time and downloads what its role may see
  async login() {
    for (const person of W.staff) {
      const ph = await phone(person, { slow: person[2] === 'salesman' && person === who('salesman', 0) });
      const s = await ph.login(); results.times[`first login + download: ${person[0]}`] = s;
      await ph.gate(); await ph.shot('home');
      results.storageMB[person[0]] = await ph.storage();
      console.log(person[0], `${s}s`, `${results.storageMB[person[0]]} MB`, 'invoices', await ph.count('invoices'), 'shops', await ph.count('shops'));
      await ph.ctx.close(); save();
    }
  },
  // salesmen: 6 orders each from the beat screen ("Usual" + adjust), 2 typed to TESRAX, 1 collection typed
  async orders() {
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
    for (let k = 0; k < 4; k++) {
      const person = who('salesman', k); const ph = await phone(person, { slow: k === 0 });
      await ph.login(); await ph.gate(); await ph.sync();
      await timed(`${person[0]}: open today's beat`, async () => { await ph.tile("Today's beat"); await ph.p.waitForSelector('button:has-text("at the shop"), button:has-text("Order"), .card:has-text("No shops on today")', { timeout: 120000 }); });
      await ph.shot('beat');
      let booked = 0;
      for (let i = 0; i < 6; i++) {
        const t = Date.now();
        const at = ph.p.locator('button:has-text("at the shop")'); if (!(await at.count())) { note(`${person[0]}: no shops left on the beat`); break; }
        await at.first().click(); await ph.p.waitForTimeout(500);
        await ph.p.locator('button:has-text("Order")').first().click(); await ph.p.waitForTimeout(800);
        if (await ph.p.locator('text=Usual').count()) { await ph.p.click('text=Usual'); await ph.p.waitForTimeout(400); }
        const plus = ph.p.locator('.stepper button[aria-label="more"]');
        if (!(await plus.count())) { await ph.shot('order-empty'); note(`${person[0]}: order screen had no products to add`); await ph.home(); await ph.tile("Today's beat"); await ph.p.waitForSelector('button:has-text("at the shop"), button:has-text("Order")', { timeout: 120000 }); continue; }
        await plus.nth(0).click(); if (await plus.count() > 1) await plus.nth(1).click();
        if (i === 0) await ph.shot('order');
        if (i === 0 && k === 0) { // the slow phone: how long do the big product tabs take to appear?
          for (const tab of ['All', 'HU', 'Usual']) { const t1 = Date.now(); await ph.p.click(`.cat button:text-is("${tab}")`); await ph.p.waitForTimeout(50); await ph.p.waitForFunction(() => document.querySelectorAll('.list .item').length > 0, null, { timeout: 120000 }); results.times[`slow phone: open "${tab}" product tab`] = (Date.now() - t1) / 1000; }
          await ph.shot('order-all-tab');
        }
        await ph.p.click('.sticky-foot button'); await ph.p.waitForTimeout(800);
        if (i === 0) await ph.shot('order-sent');
        results.times[`${person[0]}: one order (tap to sent)`] = (Date.now() - t) / 1000;
        if (await ph.p.locator('text=Next shop').count()) await ph.p.click('text=Next shop'); else { await ph.home(); await ph.tile("Today's beat"); }
        await ph.p.waitForSelector('button:has-text("at the shop"), button:has-text("Order"), .card:has-text("No shops on today")', { timeout: 120000 });
        await ph.p.waitForTimeout(400); booked++;
      }
      results[`${person[0]} orders from beat`] = booked;
      // typed orders: shops of his beat, by name (names repeat across areas, so TESRAX must pick his shop or ask)
      const mine = W.shops.filter(s => s.salesman === k && s.beat === day);
      const prods = ['surf excel easy wash 1kg', 'vim bar 200g', 'good day cashew 75g', 'parle-g original gluco 100g', 'colgate strong teeth 100g', 'maggi 2-minute masala 70g'];
      for (let j = 0; j < 2; j++) {
        const shop = mine[10 + j];
        const text = `${shop.name.toLowerCase()} ${2 + j} case ${prods[(k + j) % prods.length]}, 1 dozen ${prods[(k + j + 2) % prods.length]}`;
        const t = Date.now(); const r = await ph.tesrax(text);
        results.times[`${person[0]}: TESRAX order ${j + 1}`] = (Date.now() - t) / 1000;
        note(`${person[0]} typed "${text}" → ${r.saved ? 'saved' : 'NOT saved'}: ${r.said}`);
      }
      const payShop = mine[20];
      const r = await ph.tesrax(`${payShop.name.toLowerCase()} paid 1500 cash`);
      note(`${person[0]} typed "${payShop.name.toLowerCase()} paid 1500 cash" → ${r.saved ? 'saved' : 'NOT saved'}: ${r.said}`);
      await ph.shot('tesrax'); await ph.closeTesrax();
      const s = await ph.sync(); note(`${person[0]} sync after orders: ${s.msg} (${s.seconds}s)`);
      await ph.ctx.close();
    }
  },
  async approve() {
    const ph = await phone(who('owner')); await ph.login(); const s = await ph.sync(); note(`owner sync: ${s.msg} (${s.seconds}s)`);
    await ph.tile('Bill'); await timed('owner: open Orders received', () => ph.tile('Orders received')); await ph.shot('orders-received');
    const ap = ph.p.locator('button:has-text("Approve → godown")'); let n = 0;
    await timed('owner: approve all orders', async () => {
      for (let guard = 0; guard < 200 && await ap.count(); guard++) {
        const card = ph.p.locator('.card:has(button:has-text("Approve → godown"))').first();
        const how = card.locator('select'); if (await how.count() && await card.locator('button:has-text("Approve → godown")').isDisabled()) { const opts = await how.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean)); await how.selectOption(opts.includes('salesman') ? 'salesman' : opts[0]); await ph.p.waitForTimeout(300); }
        await card.locator('button:has-text("Approve → godown")').click(); await ph.p.waitForTimeout(300); n++;
      }
    });
    results['orders approved'] = n; await ph.sync(); await ph.ctx.close();
  },
  async pick() {
    const ph = await phone(who('godown')); await ph.login(); await ph.gate(); await ph.sync();
    await ph.tile('Pick orders'); await ph.shot('pick-list'); let n = 0;
    await timed('godown: pick every order', async () => {
      while (await ph.p.locator('.item.tap').count()) {
        await ph.p.locator('.item.tap').first().click(); await ph.p.waitForTimeout(500);
        const pk = ph.p.locator('button[aria-label="Packed"]'); const c = await pk.count(); for (let i = 0; i < c; i++) await pk.nth(i).click();
        await ph.p.click('button:has-text("Packed")'); await ph.p.waitForTimeout(500); n++;
        if (n > 80) break;
      }
    });
    results['orders picked'] = n; await ph.sync(); await ph.ctx.close();
  },
  async bill() {
    const ph = await phone(who('owner')); await ph.login(); await ph.sync();
    await ph.tile('Bill'); await ph.tile('to verify'); await ph.shot('verify'); let n = 0;
    const dn = ph.p.locator('button:has-text("Done → bill")');
    await timed('owner: bill every picked order', async () => { while (await dn.count()) { await dn.first().click(); await ph.p.waitForTimeout(700); n++; if (n > 80) break; } });
    results['orders billed'] = n; await ph.shot('billed'); await ph.sync(); await ph.ctx.close();
  },
  async plan() {
    const ph = await phone(who('owner')); await ph.login(); await ph.sync();
    await ph.tile('Delivery'); await ph.tile('Plan');
    await timed('owner: TESRAX delivery plan', async () => { await ph.p.click('button:has-text("TESRAX, suggest")'); await ph.p.waitForTimeout(1200); });
    await ph.shot('plan'); await ph.p.click('button:has-text("Confirm plan")'); await ph.p.waitForTimeout(800);
    await ph.sync(); await ph.ctx.close();
  },
  async load() {
    const ph = await phone(who('godown', 1)); await ph.login(); await ph.gate(); await ph.sync();
    await ph.tile('Load vans'); await ph.shot('load');
    const vanBtns = ph.p.locator('.main > .stack > .segmented').first().locator('button'); const vc = await vanBtns.count();
    for (let v = 0; v < Math.max(1, vc); v++) { if (vc) { await vanBtns.nth(v).click(); await ph.p.waitForTimeout(500); } const lines = ph.p.locator('.list .item.tap'); const lc = await lines.count(); for (let i = 0; i < lc; i++) await lines.nth(i).click(); if (await ph.p.locator('button:has-text("Van loaded")').count()) { await ph.p.click('button:has-text("Van loaded")'); await ph.p.waitForTimeout(600); } }
    await ph.sync(); await ph.ctx.close();
  },
  // drivers: start trip, every stop delivered with two photos, money collected (cash / UPI), end trip
  async deliver() {
    for (let k = 0; k < 2; k++) {
      const person = who('delivery', k); const ph = await phone(person); await ph.login(); await ph.gate(); await ph.sync();
      await ph.tile('My trip'); await ph.shot('trip');
      if (!(await ph.p.locator('button:has-text("Start trip")').count())) { note(`${person[0]}: no trip to start`); await ph.ctx.close(); continue; }
      await ph.p.click('button:has-text("Start trip")'); await ph.p.waitForTimeout(700);
      let stops = 0;
      await timed(`${person[0]}: deliver every stop`, async () => {
        for (let guard = 0; guard < 40; guard++) {
          const st = ph.p.locator('.route .stop:not(.done)'); if (!(await st.count())) break;
          await st.first().click(); await ph.p.waitForTimeout(500);
          await ph.p.click('button:has-text("Delivered")'); await ph.p.waitForTimeout(400);
          const cams = await ph.p.locator('button:has-text("photo")').elementHandles(); for (const c of cams) { const [ch] = await Promise.all([ph.p.waitForEvent('filechooser'), c.click()]); await ch.setFiles(`${FIX}/shop.jpg`); await ph.p.waitForTimeout(300); }
          await ph.p.click('button[aria-label="Shop confirms delivery"]'); await ph.p.waitForTimeout(700);
          if (stops === 0) await ph.shot('collect');
          if (await ph.p.locator('button:has-text("Full")').count()) {
            await ph.p.click('button:has-text("Full")'); await ph.p.waitForTimeout(200);
            if (stops % 3 === 1) { await ph.p.click('.segmented button:has-text("UPI")'); await ph.p.waitForTimeout(400); await ph.p.fill('input:visible >> nth=-1', String(4000 + stops)); }
            await ph.p.click('button[aria-label="Shop confirms payment"]'); await ph.p.waitForTimeout(600);
          }
          if (await ph.p.locator('text=Next shop').count()) await ph.p.click('text=Next shop');
          await ph.p.waitForTimeout(400); stops++;
          if (!(await ph.p.locator('.route').count())) { await ph.home(); await ph.tile('My trip'); }
        }
      });
      results[`${person[0]} stops delivered`] = stops; await ph.shot('trip-done');
      await endTripAs(ph);
      const r = await ph.tesrax(`diesel ${1400 + k * 150}`); note(`${person[0]} typed diesel → ${r.saved ? 'saved' : 'NOT saved'}: ${r.said}`); await ph.closeTesrax();
      const s = await ph.sync(); note(`${person[0]} sync: ${s.msg} (${s.seconds}s)`); await ph.ctx.close();
    }
  },
  // drivers end their own trips (back at the godown)
  async endtrip() {
    for (let k = 0; k < 2; k++) {
      const person = who('delivery', k); const ph = await phone(person); await ph.login(); await ph.gate(); await ph.sync();
      await ph.tile('My trip'); const ok = await endTripAs(ph); note(`${person[0]}: ${ok ? 'trip ended' : 'no trip to end'}`);
      await ph.shot('trip-ended'); await ph.sync(); await ph.ctx.close();
    }
  },
  // every phone against the server: same records, money and stock rules hold, bill numbers never repeat
  async verify() {
    const pg = require(path.join(__dirname, '..', '..', '..', 'server', 'node_modules', 'pg'));
    const pool = new pg.Pool({ connectionString: process.env.LIVE_DB || 'postgres://postgres:pw@localhost:54600/dbrox' });
    const shared = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'shared', 'tables.json'), 'utf8'));
    const tenant = (await pool.query("SELECT tenant_id FROM users WHERE phone=$1", [W.firm.phone])).rows[0].tenant_id;
    const server = {};
    for (const r of (await pool.query("SELECT tbl, id, updated_at FROM docs WHERE tenant_id=$1 AND tbl <> 'audit'", [tenant])).rows) (server[r.tbl] ??= new Map()).set(r.id, new Date(r.updated_at).toISOString());
    const check = { phones: {}, mismatches: [] };
    for (const person of W.staff) {
      const ph = await phone(person); await ph.login(); await ph.sync(); await ph.sync();
      const role = person[2]; const tables = (shared.read[role] === '*' ? shared.tables : shared.read[role]).filter(t => t !== 'audit');
      const local = await ph.p.evaluate(async tables => { const o = indexedDB.open('dbrox'); const db = await new Promise(r => { o.onsuccess = () => r(o.result); }); const out = {}; for (const t of tables) out[t] = await new Promise(r => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => r(q.result.map(x => [x.id, x.updatedAt, x.dirty])); }); return out; }, tables);
      let same = 0, diff = 0, dirty = 0;
      for (const t of tables) {
        const srv = server[t] ?? new Map(); const mine = new Map(local[t].map(([id, u]) => [id, u]));
        dirty += local[t].filter(x => x[2]).length;
        for (const [id, u] of srv) { if (mine.get(id) === u) same++; else { diff++; if (check.mismatches.length < 15) check.mismatches.push(`${person[0]} ${t} ${id}: phone ${mine.get(id) ?? 'missing'} · server ${u}`); } }
        for (const [id] of mine) if (!srv.has(id)) { diff++; if (check.mismatches.length < 15) check.mismatches.push(`${person[0]} ${t} ${id}: only on the phone`); }
      }
      let outstanding = null;
      if (role === 'owner' || role === 'office') { await ph.tile('Collection'); await ph.tile('Outstanding'); outstanding = (await ph.p.locator('.main').innerText()).match(/(₹[\d,\.]+)\s*in the market/)?.[1]; }
      check.phones[person[0]] = { records: same + diff, same, different: diff, notSent: dirty, outstanding };
      console.log(person[0], JSON.stringify(check.phones[person[0]]));
      await ph.ctx.close();
    }
    const docs = async (t) => (await pool.query('SELECT data FROM docs WHERE tenant_id=$1 AND tbl=$2', [tenant, t])).rows.map(r => r.data);
    const invs = await docs('invoices'), pays = await docs('payments'), cns = await docs('creditNotes'), batches = await docs('batches');
    const nums = invs.map(i => i.number); const dupNums = nums.filter((n, i) => nums.indexOf(n) !== i);
    const paid = new Map(); for (const p of pays.filter(p => p.status === 'ok')) for (const a of p.allocations) paid.set(a.invoiceId, (paid.get(a.invoiceId) ?? 0) + a.amount);
    const cred = new Map(); for (const c of cns) cred.set(c.invoiceId, (cred.get(c.invoiceId) ?? 0) + c.total);
    const overpaid = invs.filter(i => !i.cancelled && (paid.get(i.id) ?? 0) - i.total > 0.5);
    const badAlloc = pays.filter(p => Math.abs(p.allocations.reduce((a, x) => a + x.amount, 0) + (p.advance || 0) - p.amount) > 0.5);
    const negStock = batches.filter(b => b.qty < 0);
    const lineBatchMismatch = invs.filter(i => !i.cancelled && i.lines.some(l => Math.abs(l.batches.reduce((a, b) => a + b.qty, 0) - (l.qty + (l.freeQty || 0))) > 0.001 && !i.delivery?.shortages?.length && !i.delivery?.excess?.length));
    // the same rule the app uses, worked out here from the server's raw records: advances go to the oldest bills first
    const cancelled = new Set(invs.filter(i => i.cancelled).map(i => i.id));
    const adv = new Map(); for (const p of pays.filter(p => p.status === 'ok')) { let a = p.advance || 0; for (const x of p.allocations) if (cancelled.has(x.invoiceId)) a += x.amount; if (a) adv.set(p.shopId, (adv.get(p.shopId) ?? 0) + a); }
    const live = invs.filter(i => !i.cancelled).sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    const bal = live.map(i => ({ shop: i.shopId, b: Math.round((i.total - (paid.get(i.id) ?? 0) - (cred.get(i.id) ?? 0)) * 100) / 100 }));
    for (const r of bal) if (r.b < 0) { adv.set(r.shop, (adv.get(r.shop) ?? 0) - r.b); r.b = 0; }
    for (const r of bal) { const a = adv.get(r.shop) ?? 0; if (a > 0 && r.b > 0) { const u = Math.min(a, r.b); r.b -= u; adv.set(r.shop, a - u); } }
    const byShop = new Map(); for (const r of bal) if (r.b > 0.5) byShop.set(r.shop, (byShop.get(r.shop) ?? 0) + r.b);
    for (const [shop, a] of adv) if (a > 0 && byShop.has(shop)) byShop.set(shop, byShop.get(shop) - a);
    const due = [...byShop.values()].filter(v => v > 0.5).reduce((a, v) => a + v, 0);
    check.rules = { bills: invs.length, duplicateBillNumbers: dupNums.length, billsPaidMoreThanTotal: overpaid.length, paymentsNotAddingUp: badAlloc.length, lotsBelowZero: negStock.length, billLinesWhereLotsDontAddUp: lineBatchMismatch.length, serverOutstanding: Math.round(due * 100) / 100 };
    console.log('RULES', JSON.stringify(check.rules));
    results.verify = check; save(); await pool.end();
  },
  // office: a few things typed, reports opened
  async office() {
    const ph = await phone(who('office')); await ph.login(); await ph.gate(); await ph.sync();
    for (const t of ['tea and snacks 240', 'electricity bill 3850', 'outstanding list', 'today sales']) { const r = await ph.tesrax(t); note(`office typed "${t}" → ${r.saved ? 'saved' : 'shown'}: ${r.said.slice(0, 120)}`); }
    await ph.closeTesrax();
    for (const [m, t] of [['Collection', 'Outstanding'], ['Bill', 'Billed'], ['Accountant', 'P&L']]) { await ph.home(); await ph.tile(m); await timed(`office: open ${t}`, () => ph.tile(t)); await ph.shot(t.toLowerCase().replace(/\W/g, '')); }
    await ph.sync(); await ph.ctx.close();
  },
  async close() {
    const ph = await phone(who('owner')); await ph.login(); await ph.sync();
    const p = ph.p;
    const open = async () => { await ph.home(); await ph.tile('Day close'); await p.waitForSelector('text=Checklist', { timeout: 120000 }); };
    const item = t => p.locator(`.check:has-text("${t}")`);
    await open(); await ph.shot('dayclose');
    const cleared = [];
    for (let round = 0; round < 6; round++) {
      if (await item('Trips not ended').count() && !(await item('Trips not ended').isDisabled())) {
        await item('Trips not ended').click(); await p.waitForSelector('button:has-text("End trip"), button:has-text("Cancel trip"), .card:has-text("No van")', { timeout: 120000 });
        const end = p.locator('button:has-text("End trip"), button:has-text("Cancel trip")');
        while (await end.count()) { await end.first().click(); await p.click('.dialog button:has-text("Yes")'); await p.waitForTimeout(700); }
        cleared.push('trips ended by the owner (the drivers had not ended them)'); await open(); continue;
      }
      if (await item('Expenses to approve').count() && !(await item('Expenses to approve').isDisabled())) {
        await item('Expenses to approve').click(); await ph.settle(); await p.click('button:has-text("Approve all")'); await p.waitForTimeout(800);
        cleared.push('expenses approved'); await open(); continue;
      }
      if (await item('Possible duplicate collections').count() && !(await item('Possible duplicate collections').isDisabled())) {
        await item('Possible duplicate collections').click(); await p.waitForTimeout(600); await ph.shot('duplicates');
        // in this test the same payment was typed again in each re-run: cancel the extra entries
        for (let g = 0; g < 40 && await p.locator('button:has-text("Cancel this one")').count(); g++) { const card = p.locator('.card:has(button:has-text("Cancel this one"))').first(); await card.locator('button:has-text("Cancel this one")').last().click(); await p.click('.dialog button:has-text("Cancel it")'); await p.waitForTimeout(600); }
        cleared.push('double-entered collections cancelled'); await p.click('text=← Day close'); await p.waitForTimeout(800); continue;
      }
      if (await item('differences').count() && !(await item('differences').isDisabled())) {
        await item('differences').click(); await p.waitForTimeout(600);
        const mb = p.locator('button:has-text("Credit note")'); while (await mb.count()) { await mb.first().click(); await p.waitForTimeout(500); }
        cleared.push('delivery differences settled'); await p.click('text=← Day close').catch(() => open()); await p.waitForTimeout(800); continue;
      }
      break;
    }
    // count the cash each person hands over: exactly what the app says they hold
    const rows = p.locator('.row:has(input[aria-label^="Received from"])'); const rc = await rows.count();
    for (let k = 0; k < rc; k++) { const t = await rows.nth(k).innerText(); const amt = (t.match(/app says\s*₹([\d,\.]+)/) || [])[1]?.replace(/,/g, '') || '0'; await rows.nth(k).locator('input').fill(amt); }
    await ph.shot('dayclose-ready');
    const remaining = (await p.locator('.check.tap').allInnerTexts()).map(x => x.replace(/\s+/g, ' '));
    note('Day close: cleared → ' + (cleared.join('; ') || 'nothing needed') + (remaining.length ? ` · still open: ${remaining.join(' | ')}` : ''));
    const btn = p.locator('button:has-text("Close day"):not([disabled])');
    if (await btn.count()) { await btn.click(); await p.locator('.dialog button:has-text("Close day")').click(); await p.waitForTimeout(1200); await ph.shot('day-closed'); results['day closed'] = true; }
    else { results['day closed'] = false; note('Close day button: ' + (await p.locator('button.big').last().innerText())); }
    await ph.sync(); await ph.ctx.close();
  },
};

(async () => {
  for (const s of STAGES) { console.log(`\n=== ${s} ===`); await timed(`stage ${s}`, () => stages[s]()); }
  save();
  console.log('ERRORS', results.errors.length, results.errors.slice(0, 8).join('\n'));
})().catch(async e => { console.error('FAILED:', e.message); for (const c of browserHandles) { try { const pg = c.pages()[0]; if (pg) await pg.screenshot({ path: path.join(OUT, `zz-failed-${Date.now()}.png`) }); } catch {} } save(); process.exit(1); });
