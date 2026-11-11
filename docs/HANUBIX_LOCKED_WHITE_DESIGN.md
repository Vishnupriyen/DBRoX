# HANUBIX — Approved white visual identity and UI migration

**Design instruction:** 2026-11-11. The founder explicitly selected the supplied white-background wordmark reference and stated "this is our locked style". The next instruction requests white-background app/web screens and premium iconography, plus implementation in GitHub.

## Identity — do not redesign without an explicit request
- **Master wordmark:** HANUBIX, very thin geometric uppercase lettering, black; **B must be complete**, not segmented into disconnected halves.
- **Descriptor:** RETAIL INTELLIGENCE, centered under wordmark in widely tracked uppercase.
- **Technology signature:** Powered by [TESRAX dot ball] TESRAX, smaller than master wordmark. TESRAX's **E and A complete**. The orb is a densely dotted, dimensional sphere/vortex, cyan → electric blue → violet. No extra company symbol.
- **Reference source:** founder-uploaded image in the 2026-11-11 ChatGPT conversation. This repository's CSS typography is a frontend approximation; to reproduce original typography *pixel-for-pixel*, the approved vector master asset still needs to be supplied/extracted. Do not pretend a generic font is the original lettering.
- Do not import an unrelated logo from a logo mockup or change the wordmark to a flashy H symbol, swooshes, orange/gold ribbons, or space/vehicle icon.

## Interface rules
- Light theme is the default and design baseline: **white** app canvas, white cards, hairline cool-gray borders, graphite type, subtle elevational shadows.
- Accent **#425BE8** is interaction-only (focus, selected state, hyperlinks), **not** a gradient hero/button background.
- Main primary CTAs use deep graphite **#20263D**. No gold/orange luxury theme, no black/gold dashboard and no whole-page violet/blue colour treatment.
- TESRAX's cyan-blue-violet dot sphere is the expressive spectral visual. The rest of the app stays restrained.
- Premium icons: coherent **lucide-react outline family, strokeWidth 1.8**, same visual dimensions and containers. No cartoon/3D icons or product-specific mismatched symbols.
- Role-specific minimalist tile grid, real operational task badges, usable mobile tap targets; retain existing feature permissions, offline status, transaction semantics and data accuracy.
- Design must be validated in bright sunlight, narrow Android displays, desktop, keyboard navigation, and contrast tests.

## Changes in design branch
- `app/src/index.css`: white visual token layer and styling for nav, module tiles, lists, forms, login, TESRAX.
- `app/src/ui/icons.tsx`: replace heavy filled module icons with cohesive outline icon set.
- `app/src/App.tsx`: uppercase master wordmark and locked tagline in login, with existing live TESRAX sphere; no changes to business logic.

## Review gates before merge
- Run TypeScript, unit tests, production build.
- Check visual regressions on owner, salesman, godown, driver, company/brand roles; check new-tenant signup, login, offline bar, alert states, dialog, invoice print preview and TESRAX overlay.
- Validate contrast of text, selected navigation and status indicators.
- Confirm all product screens inherit white surfaces, without dark inline-style overrides.
- Do not claim full enterprise UX sign-off from a generated moodboard or passing compiler.
