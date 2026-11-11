# HANUBIX — Decision log and open questions

**Compiled 2026-11-11.** User-confirmed decisions take precedence over assistant-suggested alternatives; a historical proposal is not a locked instruction.

## Latest founder decisions (confirmed direction)
| Topic | Latest position | Notes |
|---|---|---|
| Product portfolio | Three products: Brand DMS+SFA; DB full DMS; DB LMD+Payroll (with collection) | TESRAX is common engine. The three groups may have four subscription lines. |
| TESRAX expansion | **Type-Less Execution, Smart Routing & Automated X-engine** | Older "Touchless" phrase superseded. |
| Company SFA price | ₹999 / user / month | List price, plus GST where applicable; later discounts not fixed. |
| Company DMS price | ₹999 / month (charge unit needs verification) | Assumption in prior reply was per connected distributor; not final contract definition. |
| DB full DMS | ₹999 / month / distributor | Newer decision replaces old Small tier ₹999 grid. |
| DB LMD + Collection + Payroll | ₹399 / month / distributor | Staff quantity, cost-to-serve and licence terms still to be decided. |
| GST | Prices **plus applicable GST** | Invoice/legal implementation to verify. |
| English vs Indian languages | English at launch; regional languages later | Keep i18n-ready. |
| Target identity | "The autonomous operating system for B2B distribution." | Promise requires proof, not production-status assertion. |
| Visual identity | Pure black, Geist, teal–pale–amber gradient, TESRAX point-sphere | No final approved Hanubix logo. |
| Software vs ancillary services | Software sold/operated directly; other opportunities primarily via partners | Payment/credit/e-commerce/insurance/etc not automatic core product expansions. |
| Budget / team | User + AI for pilot, ₹20k/month operating constraint | Founder partner joins later; cold calling/digital acquisition. |
| Design process | Decide logo first, review screens and workflows rather than generic UI collages | Any image concepts produced so far are exploratory, not official assets. |
| Quality | "Foolproof" operational safeguards and disclose constraints before implementation | No absolute zero-bug claims. |
| Source of truth | User wants prior entire chats retained without repeated questions | Full Nov PDF and consolidated master in ChatGPT Library /Hanubix; this GitHub log records distilled decisions. |

## Superseded / no longer automatically operative
- Older Distributor pricing: 5 tiers (Starter/Small/Medium/Big/Enterprise) × Last Mile/Office/Complete; 60-day trial; ₹49 per extra staff; 40% early promotion; 10 months annual price. These terms were proposed before the four-line product pricing and are **not carried forward without new approval**.
- Earlier "Touchless" TESRAX name and Tamil+English immediate launch preference.
- Early broad diversification into many branded applications: accounting/WMS/retailer ordering etc remain modules/adjacent ideas.
- Pitch claims 87% *net* margin, huge TAM or precise time/keyboard savings are not verified and cannot be stated as established performance.
- AI-generated logo images and generic dashboard layouts are not approved final design.

## Outstanding decisions and evidence
- Missing **30–31 October product-definition transcript (87 founder answers)**. The November PDF only refers to it; retrieve if later available.
- Distinct second Claude share export not proven included in the current PDF.
- App logo, icon, layout grid, navigation and screen-by-screen sign-off.
- Brand integration data rights, APIs vs CSV/file bridges, exact hierarchy and licensing unit.
- Free trial, onboarding/setup cost, customer staff limits, feature flags, pricing discounts and renewal policy under revised prices.
- GST/e-invoicing and Tally accounting parity across representative cases; legal/payroll compliance.
- PostgreSQL multi-device stock/invoice conflict/atomicity, idempotent sync, owner-authorized overrides and server-sent restoration.
- Real AI invoice accuracy, learned supplier templates, model routing cost and regional language quality.
- Pilot customer consent, actual unit economics, failure/recovery drills, support budgets and quantitative baseline.
- Investors: 13 lakh distributor central model, 8–21 lakh range, credit/commercial TAM and global comparison all need independently validated sources and careful assumptions.

## Technical change discipline
Document corrections with **date, user wording, exact affected feature, status and any contract migration**. Make source and migration decisions before changing payments or stock logic. Do not merge failed CI. Existing PRs may contain safety fixes that remain unmerged; check repository HEAD and PR status.
