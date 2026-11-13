# Hanubix "Security standard" round — build list

Prepared 13 Nov 2026 by Security & Operations. Nothing in the code was changed. Targets: ISO 27001 / SOC 2 (certificates later) and India's DPDP Act 2023 (law).
Line numbers are from the repo at commit 95d06f7 (branch apk).

## 1. Top risks, most dangerous first (fix before real distributor data goes on the Hostinger server)

1. **Backups are not encrypted.** `deploy/backup.sh:13` copies the plain database dump to the cloud and keeps plain copies on the server disk. Anyone who gets the bucket gets every distributor's bills and shops.
2. **No real activity log.** `access_log` is written in only 3 places (`server/src/app.ts:449, 456, 622`). Logins, failed logins, staff changes, admin-console actions, exports and cron runs leave no trace. The table is not locked against edits or deletes.
3. **Staff PINs sit in plain text on the phone.** `app/src/core/types.ts:63` (`pin: string; // local only`) and the offline login at `app/src/core/sync.ts:49` (`s.pin !== pin`) compare plain PINs held in the phone database. A lost or rooted phone gives up the PINs. The phone data itself is also unencrypted, and the login token sits in `localStorage` (`sync.ts:27, 41, 229`).
4. **No DPDP machinery at all.** No consent notice, no access/correct/delete request path, no breach procedure, no retention rules. Today "nothing is ever deleted" (`server/db/010_archive.sql`) conflicts with the right to erasure unless the legal-retention exception is written down.
5. **The scheduled jobs are not set up on Hostinger.** `/v1/cron/relay`, `/cover`, `/archive`, `/daily` (`app.ts:569-615`) are written for Cloud Scheduler. `deploy/README.md` sets up only the backup cron. The company relay, archive and plan-lock would silently never run. `.github/workflows/deploy.yml` still deploys to Cloud Run (stale against the locked plan).
6. **Admin console and cron are protected by a single static key** (`app.ts:526-535`) and are open to the whole internet through Caddy. There is no IP limit, no failed-key counter and no log.
7. **No security headers, no request rate limit beyond login/sign-up, CORS accepts `*` outside production** (`config.ts:13`), 4-digit PIN only (10,000 combinations), the token is valid 30 days with no server-side revoke list except the epoch bump.
8. **No alerting, no monitoring, no dependency scanning** in `.github/workflows/*` (no `npm audit`, Dependabot, CodeQL or secret scan). Docker images are not pinned (`postgres:16`, `caddy:2`, `node:22-slim`).
9. **Written rules do not exist** (no ISMS policy set).

Good things already in place (keep): scrypt-hashed PINs with salt (`auth.ts:6-18`); constant-time key compare; signed tokens with epoch logout (`auth.ts:23-30`, `app.ts:66-68`); login lockouts kept in Postgres (`limits.ts`); `data.pin=''` before storing (`app.ts:275`); production refuses to start without `JWT_SECRET` and `CORS_ORIGIN` (`config.ts:25-27`); Postgres not exposed outside Docker (`docker-compose.yml:16`); server logs only error codes (`app.ts:628`); `allowBackup="false"` on Android; `.env` ignored by git; no private keys found in the repo; AI key stays on the server (`scan.ts:1`).

---

## 2. Item 1 — Server activity log (who / what / when, append-only, tamper-evident, kept N months)

**What exists today**
- `access_log(at, tenant_id, actor, action)` in `server/db/001_init.sql:70-76`. Written at `app.ts:449` (link accepted), `456` (link left), `622` (support access granted).
- `support_access` table (001_init.sql:63) records the grant, but nothing reads it: support access is neither enforced nor logged when used.
- In-app `audit` table is a business history log synced from phones (`app.ts:214`, add-only for phones). It is not a security log and is trimmed on phones to 3 days (`app.ts:367`).
- Fastify logger is on in production (`app.ts:43`) but goes to Docker's default log file, with no rotation or retention stated.

**What is missing**
- Nothing is logged for: login success/failure/lockout, signup, token logout (epoch bump), staff add/remove/role/PIN change (`app.ts:636-664`), admin-console actions (`app.ts:536-566`), cron runs, archive downloads, scan calls, billing webhooks, support reading data.
- Rows can be updated or deleted by the app's database user. No chain, no signature, no retention job. No `ip` or `request id`.

**Concrete work**
1. New migration `013_security_log.sql` (add-only, as the rollback rule demands): `security_log(id bigserial, at timestamptz, tenant_id, actor, actor_role, event, target, ip, ok boolean, detail jsonb, prev_hash bytea, hash bytea)`. Keep `access_log` as is; copy its three call sites into the new one.
2. Tamper-evidence: `hash = sha256(prev_hash || canonical row)`. Insert through one database function using an advisory lock so the chain is serial. Revoke `UPDATE, DELETE, TRUNCATE` on the table from the application role; create a second role `hanubix_app` (the app today connects as the owner role `hanubix`, `docker-compose.yml:25`). Add triggers that raise on update/delete as a second wall.
3. One helper `logEvent(...)` in a new `server/src/seclog.ts`. Call it from: login (ok/fail/lock), signup, `staffLogin` changes, admin routes, cron routes, support-access grant and every use, archive month fetch, link accept/leave, razorpay webhook, scan, owner export. Never put PINs, tokens, phone numbers in full, or document bodies in `detail`.
4. Nightly script `deploy/verify-log.sh` (or a `/v1/cron/seclog-verify` job) walks the chain and fails loudly if a hash breaks; every night it also writes the day's last hash to the off-site bucket (so even a database owner cannot rewrite history unseen).
5. Retention: keep 12 months online, then export a monthly gzip to the encrypted off-site bucket and keep 5 years in total (the owner decides N; propose 12 online and 5 archived, which also satisfies the GST/audit horizon). A monthly job drops partitions only after the export is checked. Make the table partitioned by month from day one.
6. Docker logs: set `logging: { driver: json-file, options: { max-size: 20m, max-file: 10 } }` in `docker-compose.yml`, and ship Caddy access logs to a file with rotation.
7. Owner-visible slice: expose "who logged in / who changed staff" for their own tenant in the app (the same rows filtered by `tenant_id`) — helps the DPDP and customer-trust story.

**Done when**
- A test logs in wrongly, then correctly, adds staff, uses the admin key, and finds one row each with the right actor, time and IP.
- A test that tries `UPDATE`/`DELETE` on `security_log` as the app role is refused.
- Editing one row as the database owner makes `verify-log.sh` print "chain broken at id N" and exit non-zero.
- A grep test proves no PIN, token or full document ever appears in `detail`.
- Retention job exports and verifies a month before dropping it.

---

## 3. Item 2 — Phone data at rest (lost phone)

**What exists today**
- Dexie (IndexedDB) holds everything in plain text: `app/src/core/db.ts:11-129`. Staff records include `pin` (`types.ts:63`); the offline login compares it (`sync.ts:49`).
- Session in `localStorage`: `dbrox.token`, `dbrox.session` (`sync.ts:27,41,229`; `App.tsx:160`).
- Android: `allowBackup="false"` (good) — cloud/adb backup is off. Capacitor config has no secure-storage or lock plugin (`app/capacitor.config.json`).
- A removed or logged-out phone is wiped on the next sync (`wipeLocal`, `sync.ts:93-94, 223`) — but only when the phone is online; a lost phone is never online again.
- Server side already limits what a staff phone holds (owner-only fields, other staff's data removed), which keeps the damage small.

**Options in a Capacitor Android app**
- A. Android's own device encryption only (on by default since Android 10) — covers a locked phone, nothing if the phone is unlocked or rooted. Cheap, but weak alone.
- B. Encrypt the IndexedDB with a key kept in the Android Keystore (an app-lock key released only after phone unlock/biometric) — strongest; but Dexie queries need decrypted data, so field-level encryption of every row breaks indexes and costs a large rewrite.
- C. Switch the store to SQLCipher via `@capacitor-community/sqlite` — encrypted file, key in the Keystore. Real fix, but replaces Dexie: a big change, risky near launch.
- D. **Chosen: A + short app lock + remote wipe + shrink what is stored.** Practical, small, and what auditors accept for a business app with a defined risk.

**Chosen plan (D) — small steps**
1. **Remove plain PINs from the phone.** On the phone store only a salted scrypt/PBKDF2 (WebCrypto) hash of each staff PIN for the offline login, never `pin`. Clear any old `pin` field in a Dexie upgrade (version 12). Stop reading `s.pin` in `sync.ts:49` and `App.tsx:382` demo buttons (demo only when no server URL).
2. **Move the token out of `localStorage`** into the Android Keystore through `@capacitor/preferences` is not secure; use `capacitor-secure-storage-plugin` (Keystore backed). Keep a web fallback for the PWA.
3. **App lock:** after N minutes in the background, require the 4-digit PIN again; after 5 wrong offline PINs, lock for 15 minutes locally (today only the server limits PIN tries; the offline path has no limit at all). Add `FLAG_SECURE` so screenshots/recents don't show bills (a Capacitor privacy-screen plugin).
4. **Remote wipe on next contact** is already there; add the **offline kill**: the licence (already signed, `server/src/licence.ts`) carries an expiry; if the phone has not reached the server for 14 days it asks for the online PIN login and wipes after a further stated window, so a lost phone cannot be used offline for ever. Owner decides the days (propose 14 + warning).
5. Owner can press "Lock this phone" on a staff record: bumps `token_epoch` (already exists) and writes to the security log.
6. Reduce stored data: what a phone holds is already role-limited; keep archive downloads out of Dexie after viewing (or purge on logout).
7. Write the risk acceptance in the Asset policy (item 4): "A rooted, unlocked phone can read its own role's data; this is accepted; mitigations are the above."

**Done when**
- A test dumps the whole IndexedDB and `localStorage` after login and finds no 4-digit PIN in any form, no raw token in `localStorage`.
- 5 wrong offline PINs lock the screen for 15 minutes.
- A phone offline longer than the set days refuses to open without online login.
- Android emulator run (the APK workflow) shows screenshots blocked in recents and 0 issues at both text sizes.

---

## 4. Item 3 — Backup encryption (`deploy/backup.sh`)

**What exists today**
- `backup.sh:12-13`: `pg_dump -Fc` straight to `backups/hanubix-*.dump` — **plain text, unencrypted**. Read-back check is good (`pg_restore --list`, line 14).
- Line 16: `gsutil cp "$F" "$BACKUP_BUCKET/"` — uploads the plain file. The locked plan (`docs/HANUBIX_PLAN_LOCKED.md:7-8`) says "nightly **encrypted** copy". **It is not.**
- Failure of the copy only prints a warning (line 17) — no alert. Retention is 14 days local (line 19); no bucket retention rule stated.
- `gsutil` is not installed or authorised by anything in the repo; the bucket credential method is not specified. The restore path is never tested (only `--list`).
- `.env` (holding DB password, JWT secret, admin key, cron key, Razorpay secrets) is not part of the backup, and is plain on disk.
- `deploy.sh` runs `backup.sh` before every update; it will inherit the fix.

**Concrete work**
1. Use `age` (single small binary). Create a keypair once on the owner's laptop. Put only the **public** key in `deploy/.env` as `BACKUP_AGE_RECIPIENT`; the **private** key lives offline with the founder (printed copy in a safe + a password manager), never on the server. Result: a stolen server or bucket cannot decrypt old backups.
2. `backup.sh`: `pg_dump … | age -r "$BACKUP_AGE_RECIPIENT" > "$F.age.part"`; verify by decrypting is impossible on the server (no private key) — so verify with a **checksum + size** and run a **monthly restore drill on the founder's laptop** (documented script `deploy/restore-drill.sh`: decrypt, `pg_restore` into a scratch Postgres, count rows per table, compare with the manifest the backup wrote).
3. Keep the plain dump only in memory/pipe; never write a plain file to disk. Local copies are the encrypted `.age` files, 14 days.
4. Upload with a **write-only** service account (create objects, cannot delete or read) so a hacked server cannot erase the off-site history; bucket: Mumbai region (asia-south1) for DPDP data residency comfort, versioning on, object retention lock 35 days, lifecycle delete after 12 months.
5. Failure of the upload must alert (item 5), not just print. Write `deploy/.last-backup-ok` with a timestamp; the monitor script checks it is under 26 hours old.
6. Add a `.env` backup: encrypt `.env` with the same age key into the same bucket weekly.
7. Add a manifest file per backup (tables, row counts, sha256) so the restore drill can prove completeness.
8. Also cover the volumes not in `pg_dump`: Caddy's data volume (certificates, auto-renewed, low value) — skip, but document it.
9. State the numbers: RPO 24 hours (the nightly dump; consider a second dump at midday once there are paying distributors), RTO 4 hours; test once before go-live and then monthly.

**Done when**
- `file deploy/backups/*` shows age-encrypted data; `strings` on a backup finds no shop name.
- The restore drill on a clean machine rebuilds the database and its row counts match the manifest.
- The bucket's service account cannot delete (tested); the monitor alerts when the last good backup is older than 26 hours.
- A failed upload exits non-zero and sends the alert.

---

## 5. Item 4 — Written rules (ISMS policy set)

Agents can draft these; the founder signs and dates each. Each one page where possible, plain English. Needed for ISO 27001:2022 and SOC 2 (Security, Availability, Confidentiality; Privacy with DPDP).

1. **Information Security Policy** — the top rule: the founder's commitment, scope (Hanubix server, apps, control panel, staff), roles.
2. **ISMS scope & context statement** — what is inside the boundary (Hostinger VPS, Postgres, GCS bucket, GitHub, Play Store, Razorpay, Anthropic API).
3. **Risk assessment method & risk register** — how risks are scored and the first register (this document seeds it); **Statement of Applicability** (ISO Annex A controls: in/out and why).
4. **Access Control Policy** — least privilege, roles from `shared/tables.json`, PIN rules, staff joiner/mover/leaver steps, admin-key handling.
5. **Asset & Data Classification Policy** — public / internal / confidential / owner-only fields; asset list (servers, repos, keys, devices); accepted phone-risk statement.
6. **Cryptography & Key Management Policy** — TLS only, scrypt PINs, what is encrypted, who holds which key, rotation yearly, backup private key custody.
7. **Backup, Recovery & Business Continuity Policy** — RPO/RTO, nightly encrypted off-site, monthly restore drill, disaster plan for losing the Hostinger machine.
8. **Logging & Monitoring Policy** — what is logged, retention (12 months online), who reviews and how often.
9. **Incident Response & Breach Notification Procedure** — steps, severity levels, who decides, DPDP Board and user notice, evidence keeping, post-incident review.
10. **Secure Development & Change Management Policy** — the existing gate/chaos/AI-team flow written down; branch → main; code review by the independent tester; secrets never in the repo; dependency scanning.
11. **Vulnerability & Patch Management Policy** — weekly dependency scan, automatic OS security updates, critical fix within 7 days.
12. **Network & Server Hardening Standard** — firewall (22 key-only from known IPs, 80/443 open, nothing else), SSH key-only, fail2ban, Docker rules.
13. **Supplier / Third-party Policy** — Hostinger, Google Cloud, Razorpay, Anthropic, GitHub, Play: what they see, data-processing terms, annual review.
14. **Acceptable Use & Mobile Device Policy** — for Hanubix's own staff and for the distributor staff app (lock screen, lost phone reporting).
15. **Human Resources Security** — confidentiality agreements, onboarding/offboarding checklist, security awareness once a year.
16. **Physical & Remote Work Security** — laptop encryption, screen lock, no data on personal USB.
17. **Data Retention & Disposal Policy** — which data is kept how long (GST bills 8 years, logs, trial leftovers, deleted accounts).
18. **Privacy Policy (public) + Internal Data Protection Policy (DPDP)** — see item 6.
19. **Support Access Policy** — the 24-hour owner-granted window, every access logged.
20. **Internal Audit Plan + Management Review minutes template** — twice-yearly audit and one review per year (an ISO requirement).
21. **Corrective Action Log & Document Control rule** — version, owner, review date for every policy.
22. **Evidence folder index** — the list of proofs an auditor will ask for (access reviews, restore drills, log checks, training records).

---

## 6. Item 5 — Alerts and monthly access reviews (plain scripts on the server)

**What exists today**
- Nothing. `GET /health` exists (`app.ts:73`) and the deploy script uses it. No cron for alerts, no uptime check, no disk check, no failed-login report. The plan mentions "health" in the control panel only as a future item (`HANUBIX_PLAN_LOCKED.md:17`).

**What to watch (and who is told)**
- Told by **WhatsApp message to the founder** (primary — it is what the plan already uses) and **email to the security mailbox** (record). Send via a plain `curl` to a WhatsApp Cloud API template or Telegram bot as a free fallback; the alert script must not depend on Hanubix itself being up.
- Server and uptime: `/health` failing 3 times a minute apart; disk over 80 %; memory over 90 %; Postgres connection errors; container restart count.
- Backups: no good backup within 26 hours; upload failed; bucket unreachable.
- Jobs: `/v1/cron/*` not run within its window (relay every minute, cover every few minutes, archive daily, daily job) — write `last_run` rows.
- Security events from the new log: more than 20 failed logins in 10 minutes (one IP or all); any account lockout burst; any admin-key use outside office hours; admin-key wrong tries; a new staff owner-role created; a log-chain break; a cross-tenant request refused (the 403s in `/v1/archive/month`, link wall); sudden bulk downloads from one phone.
- Certificates: Caddy certificate expiring in under 14 days.
- Cost: Anthropic daily scan cap reached (`scan_daily` already counts); relay failures (`relay_failed` table has rows).

**Concrete work**
1. `deploy/monitor.sh` run every 5 minutes by cron: checks health, disk, backup age, `last_run` of jobs, count of `relay_failed`; sends an alert only on a change (state file) so it never spams.
2. `deploy/security-watch.sh` every 10 minutes: reads `security_log` counts and applies the thresholds above.
3. Add the cron lines for the jobs the app already needs (`/v1/cron/relay` every minute, `/cover` every 5, `/archive` 02:00 IST, `/daily` 00:05 IST, using `CRON_KEY` from `.env` over `http://localhost` through the Docker network, not the public URL). Put them in `deploy/README.md` and a `deploy/install-cron.sh`.
4. Add an external uptime ping (free tier, from outside the machine) because a script on the machine cannot tell you the machine is dead.
5. **Monthly access review** — `deploy/access-review.sh` produces a report on the 1st: all users per distributor with role and last login (needs `last_login` column from item 1), staff not logged in for 90 days, owner/cadmin accounts, every admin-key use that month, GitHub collaborators, Hostinger/GCS/Razorpay/Play console users, SSH keys in `authorized_keys`. The founder reads, ticks and signs; the signed copy goes into the evidence folder. Quarterly: rotate `ADMIN_KEY`, `CRON_KEY`; yearly: `JWT_SECRET` (planned logout) and backup key check.
6. Leaver checklist is run the same day: server `token_epoch` bump, GitHub, Hostinger, GCS, Play access.

**Done when**
- Stopping the server container triggers a WhatsApp/email alert within 10 minutes; restarting clears it.
- Faking an old `.last-backup-ok` triggers the backup alert.
- 25 wrong logins in a test trigger the security alert once, not 25 times.
- The first monthly review report is generated, signed and filed.

---

## 7. Item 6 — DPDP Act 2023

**What exists today**
- Nothing for DPDP in code or docs (search for consent / erasure / privacy finds only the Play-store privacy policy mention at `HANUBIX_PLAN_LOCKED.md:15` and a relay "privacy wall" about business data).
- Personal data held: staff names and phones, owner details, GSTIN and address, shop names/phones (the distributor's customers), photos of bills (scan). Distributor is the main "data fiduciary" of their shop owners' data; **Hanubix is a processor for that data and a fiduciary for the staff/owner login data and billing data** — the policy must state both roles.
- Server data stays on Hostinger (India region must be chosen) and Google bucket in Mumbai; AI scan sends bill photos to Anthropic (a transfer outside India to check and disclose).

**What the app, server and control panel must do**

*A. Consent notice (app + website)*
1. Signup screen (`app/src/App.tsx:344`, `/v1/signup` at `app.ts:79`): a plain-language notice in English first, before data is taken: what is collected, why, who sees it, how long, how to ask for deletion, the contact for the grievance officer. Tick box (not pre-ticked) stored as `consents(tenant_id, user_id, version, at, ip)` and logged.
2. Separate, optional, un-bundled consents: AI photo reading (data goes to a third-party AI processor), live van/GPS tracking of staff, TESRAX usage analytics, WhatsApp support. Each can be withdrawn as easily as it was given (settings screen).
3. Staff members are added by the owner without their own signup: the first login shows the notice to that staff member and records their consent. Location capture needs explicit staff consent.
4. Privacy policy page on the website and in the app, versioned; changes re-ask.
5. Children's data: do not collect (no minors expected); state it.

*B. Data-principal requests (access, correct, delete, nominate, grievance)*
1. Owner-side "Privacy" menu item and a public web form/email for staff and shop owners; the request is saved in a new `privacy_requests` table (type, requester, tenant, status, due date) — replies within 30 days (set internal 15).
2. **Access:** `POST /v1/privacy/export` returns the person's own data as JSON/CSV (the owner already has full export; add the staff-level export: profile, attendance, advances, expenses).
3. **Correct:** staff and owner edit their own name/phone in the app (already syncs); shop owners ask the distributor, who edits.
4. **Delete / erasure:** build a server job `eraseSubject(tenant, subject)`: remove names and phones, replace with "Erased" in documents and archive bundles (`docs_archive` is gzip JSON, so a rewrite of that month is needed, `server/src/archive.ts`), delete login row, scrub the security log's `actor` details (but keep the hash chain: log only an opaque id from the start, so no personal data is in the log and the chain never has to be rewritten). **Exception to write in the policy:** bills, credit notes, payments and GST records are kept for the legal retention period (GST law, 8 years); erasure for those means removing contact details but keeping the tax-relevant lines. The owner's account deletion ends the contract: export offered, 30-day grace, then data erased, backups age out in 35 days (state it).
5. Nominee and grievance contact: fields in the privacy settings; a grievance mailbox in the policy.
6. Control panel (our admin console): a "Privacy requests" list with due dates and a "run erasure" button that needs a second confirmation and writes to the security log.

*C. Breach reporting*
1. Written procedure (policy 9): detect (alerts item 5) → contain → assess within 24 hours → **notify the Data Protection Board of India and each affected person** in the form and time the Rules set (confirm the final notified timelines with a lawyer; assume 72 hours for the Board's detailed report) → tell the distributor owners (they are fiduciaries for their customers' data) the same day.
2. Server pieces: breach register table, an "affected tenants" query over `security_log`, a ready message template in English and Tamil (the owner decides about Tamil), the contact list.
3. Keep evidence: freeze logs and copy them off-site.

*D. Retention*
1. Table of data type → period: bills/payments/credit notes 8 years (archive keeps them, `010_archive.sql`); security log 12 months online + archive per item 1; relay queues/`rate_hits`/`scan_daily` purge after 30 days (nothing purges `rate_hits` today); `payment_events` 8 years; trial tenants never paid: delete after 90 days after expiry with notice; locked/left tenants: 90 days of export window, then erase non-legal data; backups 35 days.
2. Add a monthly `/v1/cron/retention` job that does these purges and logs counts. **Unlimited growth flag:** `rate_hits`, `access_log`, `relay_failed`, `payment_events.body` and `receipt_claims` have no purge today.

*E. Other DPDP duties*
- Reasonable security safeguards (everything in this document); processor contracts with Hostinger, Google, Razorpay, Anthropic; record of processing; data-protection impact check on location tracking; consent manager hooks later; check "significant data fiduciary" status as the base grows (annual audit duty).
- Data localisation: keep the primary database in India; document the Anthropic transfer and keep the opt-in.

**Done when**
- New signup cannot proceed without the consent box; consent version and time are stored and visible.
- A test request "export my data" returns the person's data only (never another tenant's).
- A test erasure removes the name and phone from live documents, the archive bundle and the login row, keeps the bill numbers and amounts, and the log chain still verifies.
- Retention job removes old `rate_hits` etc. and logs counts; a dry run proves bills were not touched.
- Breach drill (table-top) run once, with the clock timed and filed.

---

## 8. Other things an ISO / SOC auditor would fail

Each: file, issue, fix.

1. **CORS** — `config.ts:13` default `'*'` and `app.ts:44` returns `origin: true` when `*`. Production refuses `*` (`config.ts:27`), which is good, but the native Capacitor app's origin is `https://localhost` and must be on the list; test that the exact list is in `deploy/.env` instructions (README example lacks it).
2. **TLS / headers** — Caddy handles HTTPS (`docker-compose.yml:31`), but there are no security headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP for the web app). Add a `Caddyfile` instead of the one-line `reverse-proxy` command: HSTS, limits on request size and rate per IP, hide `Server`, JSON access log. Android: `allowMixedContent: false` already (good); add certificate pinning only if the team can manage rotation (optional).
3. **Rate limits** — only login/sign-up are limited (`limits.ts`, `app.ts:84, 114`). Add per-IP and per-token request limits on `/v1/sync`, `/v1/scan`, `/v1/number`, admin and cron routes, plus a wrong-key counter on `x-admin-key`/`x-cron-key`. Body limit is 12 MB (`app.ts:43`) for every route; set small limits on login/signup.
4. **PIN / password policy** — 4-digit PIN only (`app.ts:85`; `rules.ts:8-13` blocks just a few weak ones — it allows 0000? it blocks repeated digits; allows 1357, 2580 etc.). 5 wrong tries → 15 minute lock is reasonable. For the **owner and the company admin** (they hold the money and can export everything) require a 6-digit PIN or a PIN plus phone OTP on a new device; keep 4 digits for field staff. Blocklist: sequences (1357, 2468, 0852), birthdays patterns. Existing weak PINs keep working (`app.ts:657`) — add a forced change at next login after a date.
5. **Tokens** — 30-day HMAC token, renewed within 7 days of expiry (`auth.ts:23`, `app.ts:35`); stays valid until expiry unless the epoch bumps; one shared `JWT_SECRET` for all (no key id, no rotation path). Add a `kid` and accept two secrets during rotation; shorten to 14 days for owners; add a "log out everywhere" button.
6. **Secrets** — repo scan found no private keys or tokens committed; `.env` is git-ignored (`.gitignore`). But: the live secrets sit in a plain `deploy/.env` file on the VPS (permissions not set in `deploy.sh`); `ADMIN_KEY` and `CRON_KEY` are static and may be empty → admin/cron then reject (OK, they fail closed). Work: `chmod 600 .env`, root-owned; add `gitleaks` to CI; add a pre-commit hook; keep the licence **private** key (`server/src/licence-keys.ts:2`) only on the server and in the founder's offline copy. `deploy.yml` and `config.ts` comments still say Cloud Run / Secret Manager — update the docs or delete the stale workflow so no one deploys the wrong way and no `GCP_SA_KEY` stays in GitHub for nothing.
7. **Admin console on the public internet** — `/v1/admin/*` reachable by anyone who can guess the key. Put it behind Caddy with an IP allow-list or basic auth, require a per-person admin login with a PIN + second factor when the control panel is built, and log every call (item 1). The `plan` and `paid` routes change billing without any record.
8. **Support access is not enforced** — `support_access` (24 h) is recorded but no code checks it. The control panel's "support view" must check the grant and log each read; until then no support staff may read tenant data.
9. **Database privilege** — the app connects as the database owner (`docker-compose.yml:25`), so one SQL injection or a bug could drop tables. Use a migration role and a limited runtime role. All queries seen use parameters (good); keep a test that forbids string-built SQL.
10. **Tenant isolation** — isolation rests on `tenant_id` in every query. Add Postgres row-level security as a second wall (`SET app.tenant`) before real data; add the cross-tenant test to the chaos run for every new route.
11. **Dependency scanning and supply chain** — no `npm audit`, Dependabot, CodeQL, or image scan in `.github/workflows` (ci.yml, quality.yml, apk.yml, deploy.yml). Add all of them; pin Docker image digests (`postgres:16`, `caddy:2`, `node:22-slim`); `typescript ^7`, `vitest ^5` and other ranges should use the lockfile with `npm ci` (Dockerfile does); generate an SBOM at each release.
12. **Server hardening not in code** — firewall, key-only SSH, fail2ban, unattended-upgrades are promised in the plan (`HANUBIX_PLAN_LOCKED.md:7`) but no script. Write `deploy/harden.sh` (ufw, sshd config, fail2ban, unattended-upgrades, docker log limits, `chmod`) and check it with a verify script; Postgres port stays closed (already true).
13. **Docker** — containers run as root except the server (`USER node` is set, good); db and caddy default. Add `read_only`, `no-new-privileges`, resource limits and health checks for caddy and server in compose.
14. **Deploy script** — `deploy.sh` has no signature check of what it deploys: `git pull` from GitHub of any commit. Require a signed tag or the gate-passed tag; record every deploy (who, version, time) into the security log.
15. **Caddy trust proxy** — `app.ts:43` trusts one hop, which is correct for Caddy directly in front; if a CDN is added later, change it, or rate limits can be bypassed by header spoofing. Note it in the hardening standard.
16. **Logs** — good that only the error code is logged (`app.ts:628`), but Caddy's access log will contain URLs and IPs (personal data under DPDP); set retention of 90 days.
17. **Growth without limit (cost / availability)** — unbounded tables: `rate_hits`, `access_log`, `relay_failed`, `payment_events`, `receipt_claims`, `doc_numbers` (needed for ever but tiny). The `docs` table plus archive grows by design; with 100k distributors the 100 GB disk of the KVM 2 is not enough — the capacity plan and disk alert (item 5) must come first. A single machine is also a single point of failure: the written continuity plan must say so honestly.
18. **Testing the controls** — add to `npm run test:chaos` / server tests: security log written on each event, admin routes refuse missing key and log it, token epoch logout, erasure job, retention job, backup decrypt drill (separate script).

---

## 9. Order of work (suggested)

1. Backup encryption + cron jobs + hardening script + monitor (item 3, 5, section 8 items 6, 7, 12) — small, blocks go-live.
2. Security log + restricted database role (item 1, section 8 item 9).
3. Phone PIN/token fix and app lock (item 2).
4. Policy set drafts (item 4) in parallel, by the agents.
5. DPDP consent and requests (item 6) — consent notice and privacy policy before any real distributor signs up; erasure and retention jobs before the first month ends.
6. CI scanning, headers, rate limits (section 8).

## 10. Owner decisions needed

- Log retention N (proposed 12 months online, 5 years archived).
- Offline phone expiry days (proposed 14) and 6-digit PIN for owners.
- Backup private-key custody (who holds the paper copy) and the alert channel (WhatsApp number, security mailbox).
- Name of the grievance officer and the privacy contact email for DPDP.
- Whether a lawyer reviews the privacy policy and breach timelines (recommended, one-time).
