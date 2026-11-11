# HANUBIX — Product and platform requirements

**Source:** founder conversations exported as *Hanubix_Full_Chat.pdf* (154 pp.) and *Hanu-Tech-full-conversation.pdf* (146 pp., earliest distributor discussion to Nov 11 2026), plus ongoing Hanubix project conversation. For reconciled historical changes see `HANUBIX_HANU_TECH_RECOVERED_DECISIONS.md`. This document describes the **desired system**, not a certification that every feature is working.

## Mission and product identity
Hanubix™: **"The autonomous operating system for B2B distribution."** This is an ambition, not an already proven autonomy claim. The platform must solve the **whole working day**, not just bill generation: order taking, picking, invoicing, delivery, collections, payroll, reconciliations and closing the day. The chosen founder-story positioning includes: "Billing software solved one hour of their day. We're solving the other sixteen. Hanubix: the day runs itself." These are marketing lines, not verified measured time savings.

**One platform, three core commercial products**:
1. **Hanubix Brand — full DMS + SFA**: for manufacturers/brands: distributor onboarding/network; sales hierarchy; territory and beat planning; visits, attendance and GPS; primary/secondary sales; returns, claims, schemes, targets, incentives and reports; partner integration and properly authorized secondary-sales visibility.
2. **Hanubix Distributor — full DMS**: company/purchase invoices, receipt/GRN and invoice-to-stock; product/rate/scheme/credit masters; batch/expiry stock; shops and orders; owner approval; warehouse pick/pack and verification; company-split GST billing with a single running invoice-number series; dispatch, delivery and cash/UPI/cheque collections; full accounts, credit notes, claims, bank reconciliation, reports, GST, audit and day close.
3. **Hanubix LMD + Collection + Payroll**: separate distributor subscription for delivery/fleet/route planning, driver app, attendance, loading, trips, proof of delivery, payment collection, cash handover, salary, leave, advances, incentives, reporting and settlement. This can be deployed independently and upgraded to full DMS without losing records.

One common codebase/engine with **server-enforced module entitlements** and role permissions. Avoid inventing separate standalone products out of accounting, WMS, document extraction, routing, retail ordering or AI until a distinct offering has been decided.

## TESRAX — shared execution engine
**Latest name: "Type-Less Execution, Smart Routing & Automated X-engine."** Supersedes older "Touchless Execution". TESRAX works contextually inside all three products (not merely a decorative floating chatbot).

**Input:** spoken/typed natural language, minimal taps, document/photo/PDF/Excel/CSV uploads, structured suggestions and contextual actions. **Output:** verifiable proposals, previews and approvals, then execution via the same guarded business operations as manual UI.

**Cheapest-safe-first gateway:** validate tenant/role and current data → deterministic cache only where safe → local intents/database queries/templates → low-cost model for ambiguity → stronger model for validated exceptions. Track every model/provider request and cost by tenant. Cost optimization must not reduce correctness, timeliness or convenience.

**Document intelligence:** parse embedded text and structured files first; supplier GSTIN/layout recognition and product-code alias memory; verify qty × rate, totals, GST and invoice duplicates; expose editable approval table; never post stock/money silently. Reuse only safely shareable *layout templates*, never customers' transaction data. **Route engine:** configurable routing provider, potentially OSM/OSRM + OR-Tools with fallback; GPS and offline behaviour must be proven in pilot.

**Language:** latest user decision is English at initial launch, other Indian languages later. Architect for localization.

## Distributor critical workflow and invariants
**Canonical cycle:** book order → approve → pick/pack → verify → GST bill → assign/load vans and driver → start assigned trip → delivery evidence → collect → reconcile → day close.

- **One running bill series** across company-split invoices; avoid duplicate numbers under concurrency.
- Preserve **historic supplier landing cost, rate and promotion/scheme tags by lot**, including different purchase costs under the same MRP.
- **Expiry month mandatory; batch number optional** in the existing founder product definition; verify category/legal requirements before rollout. Support FEFO/FIFO and inspect shortages, expiry and damage.
- Stock must be conserved. Guard against negatives, duplicate billing, double-taps, concurrent devices and stale sync retries.
- Delivery staff cannot pick unrelated trips or change another driver's assignment. Invoice money fields and settlement state must not become editable through offline sync.
- **No unsafe generic Undo after server sync.** Approved correcting documents/operations and auditable reversals are required instead of replaying stale snapshots.
- **Day close is a primary product pillar:** trips completed, undelivered items/returns/shortages settled, collections reconciled, cash with staff counted, expenses approved, duplicates/exceptions resolved. Lock and override behaviour must be explicitly defined/tested.
- Tenant isolation, server-side ACL, authorization of every mutation, end-to-end auditing, idempotency and disaster recovery are compulsory.

## UX and branding requirements

**Superseding founder approval:** see [HANUBIX_LOCKED_SIGNATURE.md](HANUBIX_LOCKED_SIGNATURE.md). White surfaces, Arial, jade headings/quantities and selective dark jade–gold gradients replace the historical directions below.
**Latest working look (Hanu Tech p.146):** return to the **original black UI**, with **solid teal accents and no gradients**. Earlier Gostamo-inspired teal → pale → amber gradient, bright white, plum, gold and dark-blue variants were explored, then revised or rejected. Use existing approved layout patterns; do not claim a finalized brand system. Actual new logo remains **unapproved**. User rejected generic SaaS dashboard collages and gradient letter marks. Finalize **a distinctive Hanubix symbol/wordmark, one-colour version and app icon** before a wide UI redesign.

TESRAX visual identity is a **spherical animated field of many small dots** (not a hexagon), with depth and teal/pale/amber colours. Prioritize sunlight-readable, inexpensive Android devices, staff-specific workflows, offline status, fast actions, minimal typing and precise error recovery over abstract dashboards.

**Roles:** brand managers, field reps, distributor owner/office, godown/picker, delivery/driver, payroll/staff. Every role sees only relevant permitted work and licensed modules. Mobile and desktop share semantics.

## Commercial and engineering constraints
Founder's lean pilot should be built without a salaried engineering team; target **₹20,000/month initial operating budget**. Do not assert this covers every cloud/security/partner obligation without measured cost. Original planned distribution was through cold calling/digital marketing. Separate hypothetical investor scale costs from actual budget.

The latest stated monthly list prices are **Brand SFA ₹999 per user, Brand DMS ₹999 (contract unit remains to confirm), Distributor DMS ₹999, Distributor LMD+Collection+Payroll ₹399, plus applicable GST**. These supersede the earlier tier/pack grid; staff limits, billing units, promotions, trial and enterprise terms remain unconfirmed.

## Proving readiness
A screen/API/unit test is not production proof. Every critical feature must reach: implemented → integration-tested → cross-role/tenant/offline/concurrency-tested → pilot-validated → production release. Financial correctness, GST, refunds, inventory, payroll, backups, live synchronization and reconciliation each need real samples and repeatable test cases.

Do not claim superiority to Tally, FieldAssist/Botree/Bizom or LMD specialists before representative head-to-head workflows. Do not substitute speculative AI or market forecasts for pilot evidence.
