# Secure Development and Change Management Policy

| Version | Owner | Approved (sign and date) | Next review |
|---|---|---|---|
| 1.0 draft, 13 Nov 2026 | R. Vishnupriyen, founder | ______________________ | Nov 2027 |

## How every change is made
1. Work on a branch (`apk`), never straight on `main`.
2. The AI team order (CLAUDE.md): business analyst → systems engineer → UX → developer → **independent tester** →
   end-user panel (releases) → UI designer → **security & operations sign-off**.
3. Any bug: a regression test first, then the fix.
4. `cd app && npm run gate` must print ✔ GATE PASSED; server tests must pass; chaos tests before a release.
5. GitHub runs the gate, the server tests and the security checks (npm audit, gitleaks, Trivy) on every push.
6. Only a commit tagged `gate-<commit>` by the Deploy workflow can go live; `deploy/deploy.sh` refuses others and logs
   every deploy in the activity log. Updates go out 11 pm–5 am IST unless the founder approves `--now`.
7. Database migrations only add (a test enforces it), so a rollback always works.

## Secrets
Never in the repository, chats, screenshots or documents. gitleaks scans the whole history on every push.

## Code rules that protect data
Every database query uses parameters (no SQL built from text). Every route checks the login and the role. Tenant
isolation is tested for every new route (cross-firm tests in the server tests and chaos run).
