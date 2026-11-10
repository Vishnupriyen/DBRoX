// Claims between a distributor and a company (step 3).
// Distributor side: the month's claim lines (schemes given on bills, damage, expiry, transit, shortage at goods receipt,
// rate difference, salesman salary) are sent to a linked company in one claim.
// Company side: TESRAX checks every line against what the company itself can see (the distributor's bills of its brand,
// its own schemes and budgets, its goods-receipt notes) BEFORE a person approves. The decision goes back with a
// credit-note number. GST: every line carries its bill reference; a credit note for a past year's bill must be issued
// by 30 November of the next year to count for GST — the screen warns before that date (check with your tax advisor).
import { ChangeSet, db, session, thisMonth, today } from './db';
import { creditNoteNumbers } from './billing';
import type { Claim, ClaimDecision, ClaimEntry, DbClaim, Scheme, Secondary } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const CLAIM_KINDS: Record<string, string> = {
  scheme: 'Scheme given on bills', damage: 'Damaged stock', expiry: 'Expired stock', transit: 'Damaged in transit',
  shortage: 'Short at goods receipt', rate_diff: 'Rate difference', dsr: 'Salesman salary (DSR)',
};

// ---------------------------------------------------------------- distributor side
/** a claim line typed by the distributor (rate difference, salesman salary, or anything with a reference) */
export async function addClaimLine(input: { companyId: string; kind: ClaimEntry['kind']; amount: number; note: string; refNumber?: string; month?: string; qty?: number; productId?: string; photo?: string }) {
  if (!(input.amount > 0)) throw new Error('Amount must be more than 0.');
  if (!input.note.trim()) throw new Error('Say what the claim is for.');
  if ((input.kind === 'rate_diff' || input.kind === 'shortage') && !input.refNumber?.trim()) throw new Error('Give the company bill number this is about.');
  const cs = new ChangeSet();
  cs.put<ClaimEntry>('claimEntries', { companyId: input.companyId, month: input.month ?? thisMonth(), kind: input.kind, productId: input.productId, qty: input.qty ?? 0, amount: r2(input.amount), note: input.note.trim(), refNumber: input.refNumber?.trim(), photo: input.photo } as ClaimEntry, 'claim line');
  await cs.commit('Claim line');
}
/** lines of a month not already in a claim that was sent */
export async function openLines(companyId: string, month: string) {
  const sent = new Set((await db.claims.toArray()).filter(c => c.companyId === companyId && c.status !== 'draft' && c.status !== 'rejected').flatMap(c => c.lineIds ?? []));
  return (await db.claimEntries.toArray()).filter(e => e.companyId === companyId && e.month === month && !sent.has(e.id));
}
/** send the month's open lines to a linked company as one claim (safe to tap twice) */
export async function sendClaim(companyId: string, month: string) {
  const co = await db.companies.get(companyId);
  if (co?.link?.status !== 'linked') throw new Error('This company is not linked. Send its claim file the usual way (say "claim file").');
  const lines = await openLines(companyId, month);
  if (!lines.length) throw new Error('Nothing new to claim for this month.');
  const cs = new ChangeSet();
  const c = cs.put<Claim>('claims', { companyId, month, amount: r2(lines.reduce((a, e) => a + e.amount, 0)), status: 'submitted', lineIds: lines.map(e => e.id), note: `${lines.length} lines sent through Hanubix` } as Claim, 'claim sent');
  await cs.commit(`Claim to ${co.name}`);
  return c;
}
export async function decisionsFor(claimIds: string[]) {
  const all = await db.claimDecisions.toArray();
  return new Map(claimIds.map(id => [id, all.filter(d => d.claimId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]]));
}

// ---------------------------------------------------------------- company side: the check
export interface LineCheck { id: string; kind: string; amount: number; ok: boolean; why: string; expected?: number; schemeId?: string; productId?: string }
export interface ClaimCheck { lines: LineCheck[]; okAmount: number; flagged: number; budget: { scheme: Scheme; used: number; adding: number }[]; gstWarning?: string }

function schemeValue(s: Scheme, line: { qty: number; rate: number }) {
  if (s.type === 'pct') return r2(line.qty * line.rate * s.value / 100);
  if (s.type === 'free' && s.buyQty && s.freeQty) return r2(Math.floor(line.qty / s.buyQty) * s.freeQty * line.rate);
  return 0;
}
/** money already approved per scheme (from earlier decisions) */
async function schemeUsed() {
  const used = new Map<string, number>();
  for (const d of await db.claimDecisions.toArray()) if (d.status === 'approved') for (const l of d.lines ?? []) if (l.schemeId) used.set(l.schemeId, r2((used.get(l.schemeId) ?? 0) + l.amount));
  return used;
}

/** what earlier APPROVED claims of this distributor already paid, per bill line and per goods-receipt line */
async function alreadyPaid(dbLinkId: string, except: string) {
  const finals = new Map((await db.claimDecisions.toArray()).filter(d => d.status === 'approved' && d.claimId !== except).map(d => [d.claimId, new Set((d.lines ?? []).map(x => x.lineId))]));
  const scheme = new Map<string, number>(), short = new Map<string, number>();
  for (const c of await db.dbClaims.toArray()) {
    if (c.dbLinkId !== dbLinkId || c.id === except) continue;
    const ok = finals.get(c.id); if (!ok) continue;
    for (const l of c.lines) if (ok.has(l.id)) {
      if (l.kind === 'scheme') scheme.set(`${l.invoiceId}|${l.productId}`, (scheme.get(`${l.invoiceId}|${l.productId}`) ?? 0) + l.amount);
      if (l.kind === 'shortage') short.set(`${l.refNumber}|${l.productId}`, (short.get(`${l.refNumber}|${l.productId}`) ?? 0) + l.qty);
    }
  }
  return { scheme, short };
}

export async function checkClaim(claim: DbClaim): Promise<ClaimCheck> {
  const want = [...new Set(claim.lines.map(l => l.invoiceId).filter((x): x is string => !!x))];
  const have = new Set((await db.secondary.bulkGet(want)).filter(Boolean).map(x => x!.id));
  if (want.some(id => !have.has(id))) await (await import('./company')).fetchDocs('secondary', { ids: want.filter(id => !have.has(id)) });
  const sec = new Map((await db.secondary.toArray()).filter(s => s.dbLinkId === claim.dbLinkId).map(s => [s.id, s]));
  const schemes = await db.schemes.toArray();
  const ptr = new Map((await db.products.toArray()).map(p => [p.id, p.rate]));
  const grns = (await db.grns.toArray()).filter(g => g.dbLinkId === claim.dbLinkId);
  const prim = new Map((await db.primaryInvoices.toArray()).map(p => [p.number, p]));
  const paid = await alreadyPaid(claim.dbLinkId, claim.id); // grows as this claim's own lines are checked: a line claimed twice is caught
  const lines: LineCheck[] = [];
  for (const l of claim.lines) {
    const base = { id: l.id, kind: l.kind, amount: l.amount, productId: l.productId };
    if (l.kind === 'scheme') {
      const bill: Secondary | undefined = l.invoiceId ? sec.get(l.invoiceId) : undefined;
      if (!bill) { lines.push({ ...base, ok: false, why: 'The bill is not among this distributor\'s bills of our products' }); continue; }
      if (bill.cancelled) { lines.push({ ...base, ok: false, why: `Bill ${bill.number} was cancelled` }); continue; }
      const bl = bill.lines.find(x => x.productId === l.productId);
      if (!bl) { lines.push({ ...base, ok: false, why: `Bill ${bill.number} has no such product` }); continue; }
      const live = schemes.filter(s => (!s.productId || s.productId === l.productId) && s.from <= bill.date && s.to >= bill.date);
      if (!live.length) { lines.push({ ...base, ok: false, why: `No scheme of ours on this product on ${bill.date}` }); continue; }
      // valued at the lower of the bill's rate and our own price to shop (the distributor sets the bill rate)
      const at = { qty: bl.qty, rate: Math.min(bl.rate, ptr.get(bl.productId) ?? bl.rate) };
      const best = live.map(s => ({ s, v: schemeValue(s, at) })).sort((a, b) => b.v - a.v)[0];
      const key = `${l.invoiceId}|${l.productId}`, before = paid.scheme.get(key) ?? 0;
      if (before + l.amount > best.v + 1) { lines.push({ ...base, ok: false, why: before ? `This bill line is already claimed (₹${r2(before)} of ₹${best.v})` : `Claimed ₹${l.amount}; "${best.s.name}" gives ₹${best.v} on this bill`, expected: r2(Math.max(0, best.v - before)), schemeId: best.s.id }); continue; }
      paid.scheme.set(key, before + l.amount);
      lines.push({ ...base, ok: true, why: `Matches "${best.s.name}" on bill ${bill.number}`, schemeId: best.s.id });
      continue;
    }
    if (l.kind === 'shortage') {
      const inv = l.refNumber ? prim.get(l.refNumber) : undefined;
      const g = inv ? grns.find(x => x.primaryInvoiceId === inv.id) : undefined;
      const short = g ? [...g.short, ...g.damaged].filter(x => x.productId === l.productId).reduce((a, x) => a + x.qty, 0) : 0;
      const line = inv?.lines.find(x => x.productId === l.productId);
      if (!inv || !g) { lines.push({ ...base, ok: false, why: 'No goods-receipt record for this bill' }); continue; }
      const key = `${l.refNumber}|${l.productId}`, before = paid.short.get(key) ?? 0;
      if (before + l.qty > short) { lines.push({ ...base, ok: false, why: before ? `Already claimed ${before} of the ${short} short on this receipt` : `Goods receipt shows ${short} short, claim says ${l.qty}` }); continue; }
      paid.short.set(key, before + l.qty);
      const value = line ? r2(l.qty * line.rate * (1 + line.gst / 100)) : l.amount;
      lines.push({ ...base, ok: l.amount <= value + 1, why: l.amount <= value + 1 ? `Matches goods receipt of ${inv.number}` : `Claimed ₹${l.amount}; ${l.qty} pcs at our rate is ₹${value}`, expected: value });
      continue;
    }
    if (l.kind === 'damage' || l.kind === 'expiry' || l.kind === 'transit') {
      // a photo shows the goods, not the amount: a person always looks at these (never ticked for approval by itself)
      lines.push({ ...base, ok: false, why: l.photo ? `Photo attached — check ${l.qty} pcs for ₹${l.amount}` : 'No photo of the stock' });
      continue;
    }
    lines.push({ ...base, ok: false, why: 'Check with the papers (rate letter / salary sheet)' });
  }
  // budgets: what this claim adds to each scheme, against what is left
  const used = await schemeUsed();
  const adding = new Map<string, number>();
  for (const l of lines) if (l.ok && l.schemeId) adding.set(l.schemeId, r2((adding.get(l.schemeId) ?? 0) + l.amount));
  const budget = [...adding].map(([id, add]) => ({ scheme: schemes.find(s => s.id === id)!, used: used.get(id) ?? 0, adding: add })).filter(b => b.scheme?.budget);
  for (const b of budget) if (b.used + b.adding > b.scheme.budget!) for (const l of lines) if (l.ok && l.schemeId === b.scheme.id) { l.ok = false; l.why = `Over the "${b.scheme.name}" budget (₹${b.scheme.budget}: ₹${b.used} used)`; }
  // GST: a credit note for a bill of a past financial year counts only if issued by 30 November of the next year
  const m = Number(claim.month.slice(5, 7)), y = Number(claim.month.slice(0, 4));
  const fyEnd = m >= 4 ? y + 1 : y; const deadline = `${fyEnd}-11-30`;
  const gstWarning = today() <= deadline && today() >= `${fyEnd}-10-01` ? `Settle before ${deadline}: after that, a credit note for these bills does not reduce GST.` : today() > deadline ? `The GST date for these bills (${deadline}) has passed: a credit note now does not reduce GST.` : undefined;
  return { lines, okAmount: r2(lines.filter(l => l.ok).reduce((a, l) => a + l.amount, 0)), flagged: lines.filter(l => !l.ok).length, budget, gstWarning };
}

/** an SO recommends; head office decides. A decision is final (a second one is refused). */
export async function decideClaim(claim: DbClaim, status: 'recommended' | 'approved' | 'rejected', approvedLineIds: string[], note: string) {
  const me = await db.staff.get(session().userId);
  if (!me) throw new Error('Log in again.');
  if (status !== 'recommended' && me.role !== 'cadmin') throw new Error('Only head office approves or rejects a claim. You can recommend it.');
  if (status === 'rejected' && !note.trim()) throw new Error('Say why it is rejected — the distributor sees this.');
  // one final record per claim (the server refuses a second from any phone)
  const finalId = `final:${claim.id}`;
  if (await db.claimDecisions.get(finalId)) throw new Error('This claim is already decided.');
  const chk = await checkClaim(claim);
  const picked = chk.lines.filter(l => approvedLineIds.includes(l.id));
  const amount = status === 'rejected' ? 0 : r2(picked.reduce((a, l) => a + l.amount, 0));
  if (status === 'approved' && !(amount > 0)) throw new Error('Pick at least one line to approve, or reject the claim.');
  const cs = new ChangeSet();
  // credit-note numbers come from the server (one series, never shared by two phones); the demo keeps its own counter
  const creditNoteNo = status === 'approved' ? (await creditNoteNumbers(cs, 1))[0] : undefined;
  cs.put<ClaimDecision>('claimDecisions', { id: status === 'recommended' ? `rec:${claim.id}:${me.id}` : finalId, dbLinkId: claim.dbLinkId, claimId: claim.id, status, amount, creditNoteNo, note: note.trim(), decidedBy: me.name, lines: picked.map(l => ({ lineId: l.id, amount: l.amount, schemeId: l.schemeId })) } as ClaimDecision, `claim ${status}`);
  await cs.commit(`Claim ${status}`);
  return { amount, creditNoteNo };
}
