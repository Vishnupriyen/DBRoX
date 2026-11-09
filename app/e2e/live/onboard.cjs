// Working-app test, part 1: a brand-new distributor sets up Hanubix on the owner's phone, through the screens only.
// Sign up → 9 staff → 2 vans → 2,000 products → 1,200 shops → opening stock (15 bills) → 24 beats → sync.
//   node e2e/live/onboard.cjs <dataDir> <outDir>     (app at LIVE_URL, default http://localhost:4180)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const DATA = process.argv[2]; const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.LIVE_URL || 'http://localhost:4180';
const W = JSON.parse(fs.readFileSync(path.join(DATA, 'world.json'), 'utf8'));
const times = {}; const errors = []; let page;
const timed = async (k, f) => { const t = Date.now(); const r = await f(); times[k] = (Date.now() - t) / 1000; console.log(`${k}: ${times[k].toFixed(1)} s`); return r; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 11.41, longitude: 79.12 }, permissions: ['geolocation'] });
  const p = await ctx.newPage(); page = p;
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource|net::/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  p.on('dialog', d => d.accept());
  let n = 0; const shot = async name => { await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` }); };
  const nav = async t => { await p.click(`nav >> text=${t}`); await p.waitForTimeout(500); };
  const tile = async t => { await p.click(`.tile:has-text("${t}")`); await p.waitForTimeout(600); };
  const answer = async v => { await p.waitForSelector('#dialog-input', { timeout: 5000 }); await p.fill('#dialog-input', String(v)); await p.press('#dialog-input', 'Enter'); await p.waitForTimeout(300); };

  await p.goto(URL); await p.waitForTimeout(1500); await shot('login');
  // 1. sign up
  await timed('signup', async () => {
    await p.click('text=New distributor? Start free trial');
    const f = p.locator('.field input');
    await f.nth(0).fill(W.firm.firmName); await f.nth(1).fill(W.firm.ownerName); await f.nth(2).fill(W.firm.gstin); await f.nth(3).fill(W.firm.phone); await f.nth(4).fill(W.firm.pin);
    await shot('signup-form');
    await p.click('text=Start free trial'); await p.waitForSelector('nav', { timeout: 20000 }); await p.waitForTimeout(1500);
  });
  await shot('owner-first-home');

  // 2. staff
  await timed('staff', async () => {
    await nav('More'); await p.click('text=Staff & access'); await p.waitForTimeout(600);
    for (const [name, phone, role, pin] of W.staff.slice(1)) {
      const card = p.locator('.card:has(h3:text("Add staff"))');
      const inp = card.locator('input');
      await inp.nth(0).fill(name); await inp.nth(1).fill(phone); await card.locator('select').selectOption(role); await inp.nth(2).fill(pin);
      await card.locator('button.primary').click(); await p.waitForTimeout(400);
    }
  });
  await shot('staff-added');
  // 3. vans + drivers
  await timed('vans', async () => {
    await nav('Home'); await tile('Delivery'); await tile('Vans & drivers');
    for (const [name, num, kind] of [['Van 1', 'TN 31 AB 4821', 'Own'], ['Van 2', 'TN 31 CD 5732', 'Hired']]) {
      await p.click('text=+ Add van'); await answer(name); await answer(num); await p.click(`.dialog button:has-text("${kind}")`); await p.waitForTimeout(500);
    }
    const sels = p.locator('select.full'); const c = await sels.count();
    const drivers = W.staff.filter(s => s[2] === 'delivery').map(s => s[0]);
    for (let i = 0; i < Math.min(c, drivers.length); i++) { await sels.nth(i).selectOption({ label: drivers[i] }); await p.waitForTimeout(400); }
  });
  await shot('vans');

  // 4–6. TESRAX: send a file with a message, approve the table
  const tesrax = async (msg, file, key, expectRows) => timed(key, async () => {
    await p.click('.fab'); await p.waitForTimeout(500);
    const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click('button[aria-label="Attach"], .composer .icon-btn >> nth=0')]);
    await ch.setFiles(path.join(DATA, file));
    await p.fill('.composer textarea', msg); await p.click('button[aria-label="Send"]');
    const ok = p.locator('.msg.bot button.btn.primary:has-text("Approve")').last();
    await ok.waitFor({ timeout: 180000 });
    const t0 = Date.now();
    // validation of a big table takes a moment: wait for the button to come alive (or give up after 2 minutes)
    const tv = Date.now(); while (await ok.isDisabled() && Date.now() - tv < 120000) await p.waitForTimeout(250);
    times[`${key} (check)`] = (Date.now() - tv) / 1000;
    if (await ok.isDisabled()) { await shot(`${key}-blocked`); throw new Error(`${key}: the table has red cells, approve is blocked`); }
    await ok.click();
    await p.waitForSelector('.msg.bot .muted:has-text("✓")', { timeout: 600000 });
    times[`${key} (save)`] = (Date.now() - t0) / 1000;
    await shot(key);
    await p.click('.engine-x[aria-label="Close"]'); await p.waitForTimeout(400);
  });
  await tesrax('import products', 'products.xlsx', 'products');
  await tesrax('import shops', 'shops.xlsx', 'shops');
  for (const s of W.stockFiles) await tesrax('add this to inventory', s.file, `stock ${s.company}`);

  // 7. beats: each salesman gets his 6 areas, one per day
  await timed('beats', async () => {
    await nav('Home'); await tile('Sales'); await tile('Beats'); await p.waitForTimeout(800);
    const salesmen = W.staff.filter(s => s[2] === 'salesman').map(s => s[0]);
    for (let a = 0; a < W.areas.length; a++) {
      const day = W.days[a % 6]; const who = salesmen[Math.floor(a / 6)];
      await p.click(`button.chip:text-is("${day.slice(0, 3)}")`);
      await p.locator('.main select').first().selectOption({ label: who });
      await p.waitForTimeout(200);
      await p.locator(`.eyebrow:has-text("${W.areas[a]}") button.link`).first().click(); await p.waitForTimeout(500);
    }
  });
  await shot('beats');
  await timed('sync', async () => { await nav('More'); await p.click('text=Sync now'); await p.waitForSelector('.dialog:has-text("Sync")', { timeout: 300000 }); await shot('sync-result'); await p.click('.dialog .btn'); await p.waitForTimeout(500); });
  await shot('synced');
  const counts = await p.evaluate(async () => { const r = indexedDB.open('dbrox'); const db = await new Promise(res => { r.onsuccess = () => res(r.result); }); const c = {}; for (const t of ['companies', 'products', 'shops', 'batches', 'staff', 'vans']) c[t] = await new Promise(res => { const q = db.transaction(t).objectStore(t).count(); q.onsuccess = () => res(q.result); }); return c; });
  const est = await p.evaluate(() => navigator.storage.estimate());
  fs.writeFileSync(path.join(OUT, 'onboard.json'), JSON.stringify({ times, counts, storageMB: +(est.usage / 1048576).toFixed(1), errors }, null, 1));
  console.log(JSON.stringify({ counts, storageMB: +(est.usage / 1048576).toFixed(1), errors: errors.slice(0, 10) }, null, 1));
  await b.close();
})().catch(async e => { console.error('FAILED:', e.message); try { await page.screenshot({ path: `${OUT}/zz-failed.png` }); } catch {} console.error(errors.slice(0, 10).join('\n')); process.exit(1); });
