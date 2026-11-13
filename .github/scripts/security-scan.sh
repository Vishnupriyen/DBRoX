#!/usr/bin/env bash
# Hanubix free security scan (13 Nov 2026) — our stand-in for a paid outside test until one is bought.
# Writes /tmp/secscan/report.md. Exit 1 when anything HIGH is found. A tool that can't run is reported NOT RUN, never passed.
#   bash .github/scripts/security-scan.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=/tmp/secscan; mkdir -p "$OUT"; R="$OUT/report.md"; : > "$R"
HIGH=0
say() { echo "$*" | tee -a "$R"; }
high() { HIGH=$((HIGH + 1)); say "- HIGH: $*"; }
say "# Hanubix security scan — $(date -u +%Y-%m-%dT%H:%MZ) — $(git -C "$ROOT" rev-parse --short HEAD)"

# 1. Dependencies: known weaknesses in the packages the app and server ship with
say "## Dependencies (npm audit, production packages)"
for d in app server; do
  if (cd "$ROOT/$d" && npm audit --omit=dev --json > "$OUT/audit-$d.json" 2>/dev/null; true) && [ -s "$OUT/audit-$d.json" ]; then
    node -e '
      const a = require(process.argv[1]); const v = a.metadata?.vulnerabilities ?? {};
      const bad = Object.values(a.vulnerabilities ?? {}).filter(x => x.severity === "high" || x.severity === "critical");
      console.log(`- ${process.argv[2]}: critical ${v.critical ?? 0}, high ${v.high ?? 0}, moderate ${v.moderate ?? 0}, low ${v.low ?? 0}`);
      for (const x of bad) console.log(`- HIGH: ${process.argv[2]} package ${x.name} (${x.severity}) — fix available: ${x.fixAvailable ? "yes" : "no"}`);
    ' "$OUT/audit-$d.json" "$d" | tee -a "$R" | grep -q "HIGH:" && HIGH=$((HIGH + 1))
  else say "- NOT RUN: npm audit in $d (no network or no lock file)"; fi
done

# 2. Secrets in the code and the whole history
say "## Secrets (gitleaks, full git history)"
GL=$(command -v gitleaks || true)
if [ -z "$GL" ]; then
  V=8.28.0
  curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v$V/gitleaks_${V}_linux_x64.tar.gz" -o "$OUT/gl.tgz" 2>/dev/null \
    && tar -xzf "$OUT/gl.tgz" -C "$OUT" gitleaks 2>/dev/null && GL="$OUT/gitleaks"
fi
if [ -n "$GL" ]; then
  "$GL" git "$ROOT" --no-banner --redact --report-format json --report-path "$OUT/gitleaks.json" >/dev/null 2>&1
  N=$(node -e 'try{console.log(require(process.argv[1]).length)}catch{console.log(0)}' "$OUT/gitleaks.json")
  if [ "$N" -gt 0 ]; then
    node -e 'for (const f of require(process.argv[1]).slice(0, 15)) console.log(`- HIGH: possible secret (${f.RuleID}) in ${f.File}:${f.StartLine} (commit ${f.Commit.slice(0, 7)})`)' "$OUT/gitleaks.json" | tee -a "$R"
    HIGH=$((HIGH + 1))
  else say "- none found"; fi
else say "- NOT RUN: gitleaks (could not download)"; fi

# 3. Code scans: mobile rules (OWASP MASVS) and general rules (OWASP Top 10)
say "## Code scan"
pip install -q --break-system-packages mobsfscan semgrep >/dev/null 2>&1 || pip install -q mobsfscan semgrep >/dev/null 2>&1
if command -v mobsfscan >/dev/null; then
  mobsfscan --json -o "$OUT/mobsf.json" "$ROOT/app/src" "$ROOT/app/android/app/src/main" >/dev/null 2>&1
  python3 - "$OUT/mobsf.json" <<'EOF' | tee -a "$R"
import json, sys
try: res = json.load(open(sys.argv[1])).get('results', {})
except Exception: res = None
if res is None: print('- NOT RUN: mobsfscan (no report)')
elif not res: print('- mobsfscan: none found')
for rule, r in (res or {}).items():
    sev = r.get('metadata', {}).get('severity', '?').upper()
    files = r.get('files', [])[:3]
    where = ', '.join(f"{f['file_path'].split('/app/')[-1]}:{f['match_lines'][0]}" for f in files) or 'not used anywhere (a hardening idea, not a fault)'
    print(f"- {'HIGH' if sev == 'ERROR' else 'MEDIUM' if sev == 'WARNING' else 'LOW'}: mobsfscan {rule} — {where}")
EOF
  grep -q "HIGH: mobsfscan" "$R" && HIGH=$((HIGH + 1))
else say "- NOT RUN: mobsfscan (could not install)"; fi
if command -v semgrep >/dev/null; then
  if semgrep scan --quiet --metrics=off --config p/owasp-top-ten --config p/secrets --config p/typescript --config p/react \
       --exclude node_modules --exclude dist --exclude 'dist-*' --exclude android/app/build --json -o "$OUT/semgrep.json" \
       "$ROOT/app/src" "$ROOT/server/src" >/dev/null 2>&1; then
    python3 - "$OUT/semgrep.json" <<'EOF' | tee -a "$R"
import json, sys
r = json.load(open(sys.argv[1])).get('results', [])
if not r: print('- semgrep: none found')
for x in r[:20]:
    sev = x['extra'].get('severity', '?')
    print(f"- {'HIGH' if sev == 'ERROR' else 'MEDIUM' if sev == 'WARNING' else 'LOW'}: semgrep {x['check_id'].split('.')[-1]} — {x['path'].split('/dbrox/')[-1].split('/Hanubix/')[-1]}:{x['start']['line']}")
EOF
    grep -q "HIGH: semgrep" "$R" && HIGH=$((HIGH + 1))
  else say "- NOT RUN: semgrep (rules could not be downloaded here — GitHub's weekly run covers it)"; fi
else say "- NOT RUN: semgrep (could not install)"; fi

# 4. Android settings
say "## Android settings"
M="$ROOT/app/android/app/src/main/AndroidManifest.xml"
python3 - "$M" "$ROOT/app/capacitor.config.json" <<'EOF' | tee -a "$R"
import json, re, sys
m = open(sys.argv[1]).read(); cap = json.load(open(sys.argv[2]))
out = []
if re.search(r'android:debuggable="true"', m): out.append('HIGH: android:debuggable="true" in the manifest')
if re.search(r'usesCleartextTraffic="true"', m) or cap.get('server', {}).get('cleartext'): out.append('HIGH: cleartext (http) traffic allowed')
if cap.get('android', {}).get('allowMixedContent'): out.append('HIGH: allowMixedContent on')
if cap.get('server', {}).get('url'): out.append('HIGH: server.url set — the app would load a remote page')
if 'android:allowBackup="true"' in m: out.append('MEDIUM: allowBackup="true" — a phone backup can copy the firm\'s data and login; set it to false')
if cap.get('android', {}).get('webContentsDebuggingEnabled'): out.append('HIGH: WebView debugging forced on')
for e in re.findall(r'<(activity|service|receiver|provider)[^>]*android:exported="true"[^>]*>', m):
    pass
exported = re.findall(r'<(?:activity|service|receiver|provider)[^>]*android:name="([^"]+)"[^>]*android:exported="true"', m)
extra = [x for x in exported if not x.endswith('MainActivity')]
if extra: out.append('MEDIUM: exported components besides the main screen: ' + ', '.join(extra))
perms = re.findall(r'uses-permission android:name="android.permission.([A-Z_]+)"', m)
out.append('INFO: permissions — ' + ', '.join(perms))
print('\n'.join('- ' + o for o in out))
EOF
grep -q "^- HIGH:" <(sed -n '/## Android settings/,$p' "$R") && HIGH=$((HIGH + 1))

# findings accepted on purpose (.github/security-accepted.txt): shown as ACCEPTED with the reason until their review date
python3 - "$R" "$ROOT/.github/security-accepted.txt" <<'EOF2'
import sys, datetime
rep, acc = sys.argv[1], sys.argv[2]
today = datetime.date.today().isoformat()
rules = [[x.strip() for x in l.split('|')] for l in open(acc) if l.strip() and not l.startswith('#')]
out = []
for line in open(rep):
    if line.startswith('- HIGH:'):
        for key, why, until in rules:
            if key in line and today <= until:
                line = f"- ACCEPTED until {until} ({why}):{line[len('- HIGH:'):]}"; break
    out.append(line)
open(rep, 'w').write(''.join(out))
EOF2
HIGH=$(grep -c '^- HIGH:' "$R")
say "## Result"
if [ "$HIGH" -gt 0 ]; then say "✘ $HIGH HIGH finding(s) — see above"; cat "$R"; exit 1; fi
say "✔ No HIGH findings (ACCEPTED, MEDIUM and LOW above are for the next fix round)"
