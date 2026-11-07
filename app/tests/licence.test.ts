// The phone obeys only a licence sealed by our server. These prove a distributor can't unlock modules or billing by
// editing their phone, and that the lock day comes even when the phone stays offline.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ChangeSet, db, setSession, today, daysFrom } from '../src/core/db';
import { seedDemo } from '../src/core/seed';
import { licenceState, openLicence, refreshLicence, saveLicence, setLicencePublicKey, type Licence } from '../src/core/licence';

// a key pair made exactly the way the server makes it (ECDSA P-256, raw signature) — proves the two sides agree
const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUB = k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const seal = (l: Licence) => { const body = Buffer.from(JSON.stringify(l)); return `${body.toString('base64url')}.${sign('sha256', body, { key: k.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`; };
const ALL = { sales: true, bill: true, inventory: true, delivery: true, collection: true, accountant: true, gst: true, payroll: true };
const lic = (over: Partial<Licence> = {}): Licence => ({ v: 1, t: 'demo', tier: 'medium', pack: 'complete', mods: { ...ALL }, status: 'active', paidThrough: daysFrom(20), lockOn: daysFrom(28), validUntil: daysFrom(14), iat: new Date().toISOString(), ...over });

beforeAll(async () => {
  await seedDemo();
  setSession('demo', (await db.staff.where('role').equals('owner').first())!.id);
  setLicencePublicKey(PUB);
});

describe('licence on the phone', () => {
  it('a licence sealed by the server opens; an edited one does not', async () => {
    const tok = seal(lic({ pack: 'last_mile', mods: { ...ALL, bill: false, sales: false } }));
    expect((await openLicence(tok))?.pack).toBe('last_mile');
    const [body, sig] = tok.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString()); forged.mods.bill = true;
    expect(await openLicence(`${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`)).toBeNull();
  });

  it('modules come from the licence — switching them on in phone settings does nothing', async () => {
    const s = (await db.settings.toCollection().first())!;
    await db.settings.put({ ...s, modules: { ...ALL } }); // a clever owner edits the phone
    await saveLicence(seal(lic({ pack: 'last_mile', mods: { ...ALL, bill: false, sales: false, inventory: false, accountant: false, gst: false, payroll: false } })));
    const st = await licenceState(true);
    expect(st.mods.bill).toBe(false);
    expect(st.mods.delivery).toBe(true);
  });

  it('a tampered stored licence counts as no licence: billing pauses until it is renewed', async () => {
    await db.meta.put({ key: 'licence', value: 'eyJmYWtlIjp0cnVlfQ.AAAA' });
    expect((await licenceState(true)).status).toBe('expired');
  });

  it('the lock day comes even if the phone never goes online; so does the 14-day renewal', async () => {
    await saveLicence(seal(lic({ status: 'grace', lockOn: today() })));
    expect((await licenceState(true)).status).toBe('locked');
    await saveLicence(seal(lic({ validUntil: daysFrom(-1) })));
    expect((await licenceState(true)).status).toBe('expired');
  });

  it('locked: no new orders or bills on this phone; money and existing bills still save', async () => {
    await saveLicence(seal(lic({ status: 'locked', lockOn: daysFrom(-1) })));
    await refreshLicence(true);
    const shop = (await db.shops.toArray())[0];
    const order = new ChangeSet(); order.put('orders', { shopId: shop.id, lines: [], status: 'new', date: today(), source: 'office' });
    await expect(order.commit('new order')).rejects.toThrow(/locked/);
    const inv = (await db.invoices.toArray())[0];
    const ok = new ChangeSet();
    ok.put('invoices', { ...inv, deliveryStatus: 'delivered' });
    ok.put('payments', { shopId: inv.shopId, amount: 100, mode: 'cash', date: today(), collectedBy: 't', shopConfirmed: true, allocations: [], advance: 100, settled: false, status: 'ok' });
    await expect(ok.commit('collect')).resolves.toBeTruthy();
    // renewed → unlocked at once
    await saveLicence(seal(lic()));
    await refreshLicence(true);
    const again = new ChangeSet(); again.put('orders', { shopId: shop.id, lines: [], status: 'new', date: today(), source: 'office' });
    await expect(again.commit('new order')).resolves.toBeTruthy();
  });
});
