// Release gate, part 1b: the company journey end to end in a real browser (demo: both sides on one phone).
// rep's day → order reaches the distributor → distributor receives the company bill with a shortage → sends the claim →
// head office approves with a credit note → the distributor sees it. Any page error or console error fails it.
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'out'); fs.mkdirSync(path.join(OUT, 'company'), { recursive: true });
const BASE = process.env.E2E_URL || 'http://localhost:4173';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 11.4066, longitude: 79.2577 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  let n = 0; const shot = async name => { await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/company/${String(++n).padStart(2, '0')}-${name}.png` }); };
  const step = (s) => console.log('  ✓ ' + s);
  const fail = (s) => { console.error('✘ ' + s); process.exitCode = 1; };
  const login = async (side, who) => {
    await p.goto(BASE); await p.evaluate(() => localStorage.removeItem('dbrox.session')); await p.goto(BASE);
    await p.waitForSelector('text=Demo logins');
    const want = side === 'company' ? 'Company demo' : 'Distributor demo';
    if (!(await p.$(`.segmented button.on:has-text("${want}")`))) { await p.click(`text=${want}`); await p.waitForSelector('text=Demo logins', { timeout: 60000 }); }
    await p.waitForSelector(`text=${who}`, { timeout: 60000 }); await p.waitForTimeout(500);
    await p.click(`text=${who}`); await p.waitForTimeout(1500);
  };
  const tile = async (t) => { await p.click('nav >> text=Home'); await p.waitForTimeout(400); await p.click(`.home > .tile:has(.tile-l:text-is("${t}"))`); await p.waitForTimeout(900); };
  const okDialog = async () => { const d = await p.$('.dialog button'); if (d) { await d.click(); await p.waitForTimeout(300); } };
  try {
    // 1. the rep's day: start, visit a shop on the beat, order
    await login('company', 'Arun (Rep)'); await shot('rep-home');
    await tile('My day'); await p.click('text=Start day'); await p.waitForSelector('text=started'); step('rep started the day');
    await tile("Today's beat"); const visited0 = (await p.textContent('.main .muted')).trim();
    await p.click('.list .item.tap >> nth=0'); await p.waitForSelector('text=Take order'); await shot('visit');
    const shopName = (await p.textContent('.card h3')).trim();
    // UX round 4: back goes one level (visit → beat), and only opening a shop is not a visit
    await p.click('header button[aria-label="Back"]'); await p.waitForTimeout(600);
    if (!(await p.$('.segmented:has-text("All my shops")'))) fail('header back from a shop visit should go to the beat, not home');
    else if ((await p.textContent('.main .muted')).trim() !== visited0) fail(`opening a shop counted as a visit (${visited0} → ${(await p.textContent('.main .muted')).trim()})`);
    else step('back from a visit goes to the beat; opening a shop is not counted as a visit');
    await p.click('.list .item.tap >> nth=0'); await p.waitForSelector('text=Take order');
    await p.click('text=Take order'); await p.click('[aria-label^="More Kaveri Coconut"]'); await p.click('[aria-label^="More Kaveri Coconut"]');
    await p.click('header button[aria-label="Back"]'); await p.waitForTimeout(400);
    if (!(await p.$('.dialog:has-text("Leave this order?")'))) fail('back from an order with lines should ask "Leave this order?"');
    else { await p.click('.dialog button:has-text("Cancel")'); await p.waitForTimeout(300); if (!(await p.$('text=Send order'))) fail('Cancel on "Leave this order?" should stay on the order'); else step('back from an order with lines asks first'); }
    await p.click('text=Send order'); await p.waitForSelector('text=Order sent'); await okDialog(); step(`rep ordered 2 cases for ${shopName}`);
    // TESRAX: an expense, typed
    await p.dblclick('.fab .tx-core'); await p.fill('.engine textarea', 'lunch 120'); await p.keyboard.press('Enter'); await p.waitForSelector('text=Approve'); await p.click('.engine button:has-text("Approve")'); await p.waitForTimeout(800);
    await p.click('.engine-x[aria-label="Close"]'); step('rep typed an expense');

    // 2. the distributor sees the order, receives the company bill with a shortage, sends the claim
    await login('distributor', 'Vishnu (Owner)');
    await p.click('.tile:has-text("Bill")'); await p.click('.tile:has-text("Orders received")'); await p.waitForTimeout(1200);
    if (!(await p.$(`.card:has-text("${shopName}"):has-text("Kaveri")`))) fail('distributor does not see the rep\'s order'); else step('distributor sees the rep\'s order');
    await shot('db-orders');
    await p.click('nav >> text=Home'); await p.click('.tile:has-text("Inventory")'); await p.click('.tile:has-text("Company bills")'); await p.waitForTimeout(800);
    await p.click('.list .item.tap:has-text("To receive")'); await p.waitForSelector('text=Anything short or damaged?');
    await p.fill('textarea', 'coconut oil 1 case short'); await p.click('text=Read it'); await p.waitForSelector('text=Short:');
    await p.click('button:has-text("Receive")'); await p.click('.dialog button:has-text("Receive")'); await p.waitForSelector('text=Company bills'); step('distributor received the bill with 1 case short');
    await shot('db-received');
    await p.click('nav >> text=Menu'); await p.click('.menu-chip:text-is("Claims")'); await p.waitForTimeout(800);
    await p.click('.item:has-text("Kaveri") button:has-text("Send")'); await p.click('.dialog button:has-text("Send")'); await p.waitForTimeout(1000);
    if (!(await p.$('text=sent, waiting for the company'))) fail('claim not sent'); else step('distributor sent the claim');

    // 3. head office checks and approves; the distributor sees the credit note
    await login('company', 'Lakshmi (Head office)');
    await tile('Distributor claims'); await p.click('.list .item.tap >> nth=0'); await p.waitForSelector('text=matches the scheme'); await shot('ho-claim');
    await p.click('button:has-text("Approve ₹")'); await p.waitForSelector('text=Credit note'); await okDialog(); step('head office approved with a credit note');
    await tile('Invoices to distributors'); await p.waitForTimeout(600);
    if (!(await p.$('text=Received with differences'))) fail('company does not see the goods receipt'); else step('company sees the goods receipt');
    await tile('Sales'); await shot('ho-sales'); await tile('Stock at distributors'); await shot('ho-stock');
    await login('distributor', 'Vishnu (Owner)');
    await p.click('nav >> text=Menu'); await p.click('.menu-chip:text-is("Claims")'); await p.waitForTimeout(800);
    if (!(await p.$('text=credit note'))) fail('distributor does not see the credit note'); else step('distributor sees the credit note');

    // 4. the manager's day view
    await login('company', 'Divya (SO)');
    // the morning card names the approvals waiting and "Start here" opens them
    const card = (await p.textContent('.morning')) || '';
    if (!/approvals? waiting/.test(card)) fail(`SO morning card should say the approvals waiting, says: ${card}`); else { await p.click('.morning .pill'); await p.waitForTimeout(700); if (!/Approvals/.test(await p.textContent('header .firm'))) fail('SO "Start here" should open Approvals'); else step('SO morning card: approvals waiting → Start here opens Approvals'); }
    await tile('Team today'); await p.waitForSelector('text=Arun'); await shot('so-team'); step('SO sees the team today');
    await tile('Approvals'); await shot('so-approvals');
  } catch (e) { fail(e.message); await shot('failed'); }
  if (errs.length) { fail(`${errs.length} page/console error(s):\n${errs.join('\n')}`); }
  await b.close();
  if (!process.exitCode) console.log('COMPANY FLOW PASSED');
})();
