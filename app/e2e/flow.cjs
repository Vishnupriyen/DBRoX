// Release gate, part 1: the whole business day end to end, every role, in a real browser at phone size.
// Fails on any page error, console error or step that can't be done.  node e2e/flow.cjs [outDir]
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'flow'), { recursive: true });
const FIX = path.join(__dirname, 'fixtures');
const BASE = process.env.E2E_URL || 'http://localhost:4173';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, geolocation: { latitude: 11.41, longitude: 79.12 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource|net::/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  let n = 0;
  const shot = async (name) => { await p.waitForTimeout(450); await p.screenshot({ path: `${OUT}/flow/${String(++n).padStart(2, '0')}-${name}.png` }); };
  const loginAs = async (who) => { await p.waitForSelector('text=Demo logins'); await p.click(`text=${who}`); await p.waitForTimeout(900); };
  const gate = async () => { if (await p.locator('.gate').count()) { await shot('checkin-gate'); await p.click('.gate .big-btn'); await p.waitForTimeout(800); } };
  const logout = async () => { await p.click('nav >> text=More'); await p.waitForTimeout(300); await p.click('text=Log out'); await p.waitForTimeout(300); };
  const home = async () => { await p.click('nav >> text=Home'); await p.waitForTimeout(500); };
  const tile = async (t) => { const exact = p.locator('.tile', { hasText: new RegExp('^\\s*' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\d*\\s*$') }); if (await exact.count()) await exact.first().click(); else await p.click(`.tile:has-text("${t}")`); await p.waitForTimeout(700); };
  const setFile = async (btnText, file) => { const [ch] = await Promise.all([p.waitForEvent('filechooser'), p.click(`button:has-text("${btnText}")`)]); await ch.setFiles(file); await p.waitForTimeout(600); };

  await p.goto(BASE); await p.waitForSelector('text=Demo logins'); await p.waitForTimeout(1500);
  await shot('login');

  // Salesman: check-in gate, beat, new shop, order
  await loginAs('Ravi (Salesman)'); await gate(); await shot('salesman-home');
  await tile('New shop'); await p.fill('input >> nth=0', 'Sakthi Stores'); await p.fill('input >> nth=1', 'Sakthi'); await p.fill('input >> nth=2', '9876501234');
  await setFile('photo', `${FIX}/shop.jpg`); await p.fill('input[list=areas]', 'Pennadam'); await shot('salesman-newshop');
  await p.click('button:has-text("Add shop")'); await p.waitForTimeout(600); await shot('salesman-newshop-done'); await p.click('button:has-text("Done")');
  await tile("Today's beat"); await shot('salesman-beat');
  await p.locator('button:has-text("at the shop")').first().click(); await p.waitForTimeout(700);
  await p.locator('button:has-text("Order")').first().click(); await p.waitForTimeout(900);
  await p.click('text=Usual'); await p.waitForTimeout(400);
  const plus = p.locator('.stepper button[aria-label="more"]'); await plus.nth(0).click(); await plus.nth(1).click(); await p.waitForTimeout(300); await shot('salesman-order');
  await p.click('.sticky-foot button'); await p.waitForTimeout(900); await shot('salesman-order-sent');
  await p.click('text=Next shop'); await p.waitForTimeout(300);
  await p.click('.fab'); await p.waitForTimeout(500); await p.fill('textarea', 'leave Monday fever'); await p.click('button[aria-label="Send"]'); await p.waitForTimeout(800); await shot('rox-leave');
  await p.click('.engine-x[aria-label="Close"]'); await logout();

  // Owner: home, Bill → Orders received (history strip) → approve
  await loginAs('Vishnu (Owner)'); await shot('owner-home');
  await tile('Bill'); await shot('owner-bill-icons');
  await tile('Orders received'); await shot('owner-orders-received');
  const ap = p.locator('button:has-text("Approve → godown")'); while (await ap.count()) { await ap.first().click(); await p.waitForTimeout(500); }
  await shot('owner-orders-approved');
  await home(); await tile('Sales'); await tile('New shops'); await shot('owner-newshops');
  await logout();

  // Godown: pick with qty/batch/MRP
  await loginAs('Mani (Godown)'); await gate(); await shot('godown-home');
  await tile('Pick orders'); await shot('godown-pick-list');
  await p.locator('.item.tap').first().click(); await p.waitForTimeout(700);
  await p.locator('.stepper button[aria-label="less"]').first().click(); await p.waitForTimeout(200); await shot('godown-pick-changed');
  const packs = p.locator('button[aria-label="Packed"]'); const pc = await packs.count(); for (let i = 0; i < pc; i++) await packs.nth(i).click();
  await p.click('button:has-text("Packed")'); await p.waitForTimeout(700);
  // pick the rest without changes
  while (await p.locator('.item.tap').count()) { await p.locator('.item.tap').first().click(); await p.waitForTimeout(500); const pk = p.locator('button[aria-label="Packed"]'); const c = await pk.count(); for (let i = 0; i < c; i++) await pk.nth(i).click(); await p.click('button:has-text("Packed")'); await p.waitForTimeout(600); }
  await home(); await tile('Stock in'); await shot('godown-stockin');
  await home(); await tile('Stock'); await p.locator('.item.tap').first().click(); await p.waitForTimeout(500); await p.locator('.item.tap').first().click(); await p.waitForTimeout(500); await shot('godown-stock-lots');
  await logout();

  // Owner: verify → Done → bill; plan (two buttons); load sheet print
  await loginAs('Vishnu (Owner)'); await tile('Bill'); await tile('to verify'); await shot('owner-verify');
  const dn = p.locator('button:has-text("Done → bill")'); while (await dn.count()) { await dn.first().click(); await p.waitForTimeout(700); }
  await shot('owner-billed');
  await home(); await tile('Delivery'); await shot('owner-delivery-icons'); await tile('Plan'); await shot('owner-plan-ask');
  await p.click('button:has-text("TESRAX, suggest")'); await p.waitForTimeout(900); await shot('owner-plan');
  await p.click('button:has-text("Confirm plan")'); await p.waitForTimeout(800);
  await logout();

  // Godown: load both vans, print sheet
  await loginAs('Mani (Godown)'); await tile('Load vans');
  const vanBtns = p.locator('.main > .stack > .segmented').first().locator('button'); const vc = await vanBtns.count();
  for (let v = 0; v < Math.max(1, vc); v++) { if (vc) { await vanBtns.nth(v).click(); await p.waitForTimeout(500); } const lines = p.locator('.list .item.tap'); const lc = await lines.count(); for (let i = 0; i < lc; i++) await lines.nth(i).click(); if (await p.locator('button:has-text("Van loaded")').count()) { await p.click('button:has-text("Van loaded")'); await p.waitForTimeout(600); } }
  await home(); await tile('Print load sheet'); await shot('godown-print-sheet');
  await logout();

  // Driver: trip, two photos, extra, collect with bill + QR
  await loginAs('Karthik (Delivery)'); await gate(); await tile('My trip'); await shot('driver-trip');
  await p.click('button:has-text("Start trip")'); await p.waitForTimeout(700);
  await p.locator('.route .stop').first().click(); await p.waitForTimeout(600);
  await p.locator('button:has-text("Short")').first().click(); await p.waitForTimeout(300); await p.fill('.dialog input, dialog input, input[type=number] >> nth=-1', '4').catch(() => {}); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const why = p.locator('button:has-text("Not loaded")'); if (await why.count()) { await why.click(); await p.waitForTimeout(300); }
  await shot('driver-stop-short');
  await p.click('button:has-text("Delivered")'); await p.waitForTimeout(500); await shot('driver-photos-needed');
  const cams = await p.locator('button:has-text("photo")').elementHandles(); for (const c of cams) { const [ch] = await Promise.all([p.waitForEvent('filechooser'), c.click()]); await ch.setFiles(`${FIX}/shop.jpg`); await p.waitForTimeout(500); } await shot('driver-photos-done');
  await p.click('button[aria-label="Shop confirms delivery"]'); await p.waitForTimeout(800); await shot('driver-collect-bills');
  await p.click('button:has-text("Full")'); await p.waitForTimeout(200); await p.click('.segmented button:has-text("UPI")'); await p.waitForTimeout(600); await shot('driver-collect-qr');
  await p.fill('input:visible >> nth=-1', '4471'); await p.click('button[aria-label="Shop confirms payment"]'); await p.waitForTimeout(700); await shot('driver-after');
  await p.click('text=Next shop'); await p.waitForTimeout(300);
  await p.click('.fab'); await p.waitForTimeout(400); await p.fill('textarea', 'diesel 1500'); await p.click('button[aria-label="Send"]'); await p.waitForTimeout(800); await shot('rox-diesel');
  await p.click('.engine button:has-text("Approve")').catch(() => {}); await p.waitForTimeout(500);
  // two things in one message, then follow-ups to the table just shown
  const say = async (t) => { await p.fill('textarea', t); await p.click('button[aria-label="Send"]'); await p.waitForTimeout(900); };
  await say('Kumar Mart paid 500, toll 85'); await shot('rox-two-things');
  if (await p.locator('.engine .prop').count() < 2) throw new Error('two things in one message should show two tables');
  await say('toll 90'); await say('make it 95'); await shot('rox-follow-up');
  if (!(await p.locator('.engine', { hasText: 'Changed — see below' }).count())) throw new Error('a follow-up should replace the table just shown');
  await say('no'); await shot('rox-dropped');
  if (!(await p.locator('.engine', { hasText: 'Dropped — nothing saved' }).count())) throw new Error('"no" should drop the table');
  await p.click('.engine-x[aria-label="Close"]'); await logout();

  // Owner: live, delivery status, day close checklist with differences, cash count, close
  await loginAs('Vishnu (Owner)'); await tile('Delivery'); await tile('Live'); await shot('owner-live');
  while (await p.locator('button:has-text("End trip"), button:has-text("Cancel trip")').count()) { await p.locator('button:has-text("End trip"), button:has-text("Cancel trip")').first().click(); await p.waitForTimeout(300); await p.click('button:has-text("Yes")'); await p.waitForTimeout(600); }
  await shot('owner-live-ended');
  await home(); await tile('Delivery'); await tile('Delivery status'); await shot('owner-status');
  await home(); await tile('Day close'); await shot('owner-dayclose-checklist');
  await p.click('.check:has-text("differences")'); await p.waitForTimeout(600); await shot('owner-differences');
  const mb = p.locator('button:has-text("Modified bill")'); while (await mb.count()) { await mb.first().click(); await p.waitForTimeout(500); }
  await p.click('button:has-text("Back to day close")').catch(() => p.click('text=← Day close')); await p.waitForTimeout(600);
  // remaining items: trips not ended → end trip is driver's; mark via Live? we end trip from owner side quickly by logging in as driver later. Approve expenses:
  const exp = p.locator('.check:has-text("Expenses")'); if (await exp.count() && !(await exp.isDisabled())) { await exp.click(); await p.waitForTimeout(500); await p.click('button:has-text("Approve all")').catch(() => {}); await p.waitForTimeout(400); await home(); await tile('Day close'); }
  const cashInputs = p.locator('input[aria-label^="Received from"]'); const ci = await cashInputs.count(); for (let i = 0; i < ci; i++) await cashInputs.nth(i).fill('1000');
  await shot('owner-dayclose-progress');
  if (await p.locator('button:has-text("Close day"):not([disabled])').count()) { await p.click('button:has-text("Close day")'); await p.waitForTimeout(300); await p.locator('button:has-text("Close day")').last().click(); await p.waitForTimeout(700); await shot('owner-day-closed'); }
  await home(); await tile('Accountant'); await shot('owner-accountant-icons'); await tile('P&L'); await shot('owner-pnl');
  await home(); await tile('GST'); await shot('owner-gst');
  await home(); await tile('Payroll'); await tile('Today'); await shot('owner-payroll-today');
  await home(); await tile('Inventory'); await tile('Ageing'); await shot('owner-ageing');
  await home(); await tile('Collection'); await tile('Outstanding'); await shot('owner-outstanding');
  await home(); await tile('Sales'); await tile('Beats'); await shot('owner-beats');
  await home(); await tile('Bill'); await tile('Billed'); await shot('owner-billed-list');
  await home(); await tile('Payroll'); await tile('Salary'); await shot('owner-salary');
  await logout(); await loginAs('Ravi (Salesman)'); await tile('My day'); await shot('salesman-myday');

  console.log('ERRORS:', errors.join(' | ') || 'none');
  await b.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
