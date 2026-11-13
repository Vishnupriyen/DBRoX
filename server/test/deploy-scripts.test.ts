// The Hostinger deploy kit (deploy/*.sh) run against a fake docker: found by the independent tester, 12 Nov 2026 — every backup
// and deploy failed (compose needed TAG), a failed build left a stale table list for the next image, a failed first version
// was left running, rollback never checked anything, and a failed dump left a half file. Regression tests first.
import { describe, it, expect, beforeEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let root = '', bin = '', log = '', alerts = '';

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "TAG=\${TAG:-} $*" >> "$LOG"
case "$*" in
  build*) [[ -n "\${FAIL_BUILD:-}" ]] && exit 1; [[ -d "$ROOT/server/shared/shared" ]] && { echo stale-nested >> "$LOG"; }; exit 0 ;;
  *"exec -T server"*) [[ "\${HEALTHY:-}" == *"\${TAG}"* ]] && exit 0 || exit 1 ;;
  *"pg_dump"*) [[ -n "\${FAIL_DUMP:-}" ]] && { echo partial; exit 1; }; echo "dumpdata Murugan Stores 9876543210"; exit 0 ;;
  *"pg_restore -f - -a"*) cat > /dev/null; printf 'COPY public.docs_p0 (tenant_id, data) FROM stdin;\\nrow1\\nrow2\\n\\\\.\\nCOPY public.users (id) FROM stdin;\\nu1\\n\\\\.\\n'; exit 0 ;;
  *"seclog_verify"*) echo "\${CHAIN_BROKEN:-}"; exit 0 ;;
  *"security_log ORDER BY id DESC"*) echo "42 abcd"; exit 0 ;;
  *"WITH w AS"*) printf 'fail_total|%s\\nfail_one_ip|%s\\nlockouts|0\\nadmin_denied|0\\nadmin_night|0\\nnew_owner|0\\ncross_tenant|0\\nbulk_download|0\\n' "\${FAILS:-0}" "\${FAILS:-0}"; exit 0 ;;
  *"job_runs"*) echo ""; exit 0 ;;
  *"psql"*) echo 0; exit 0 ;;
  *) exit 0 ;;
esac`;
// git: the gate-passed tag is there unless NO_GATE is set; anything else answers the commit
const FAKE_GIT = `#!/usr/bin/env bash
case "$*" in
  *"tag --points-at"*) [[ -z "\${NO_GATE:-}" ]] && echo "gate-$SHA"; exit 0 ;;
  *fetch*) exit 0 ;;
  *) echo "$SHA" ;;
esac`;
// gsutil and curl: every call is written down; FAIL_UPLOAD makes the upload fail
const FAKE_GSUTIL = '#!/usr/bin/env bash\necho "gsutil $*" >> "$LOG"\n[[ -n "${FAIL_UPLOAD:-}" ]] && exit 1\nexit 0';
const FAKE_CURL = '#!/usr/bin/env bash\necho "curl $*" >> "$ALERTS"\nexit 0';
const hasAge = (() => { try { execSync('age --version', { stdio: 'ignore' }); return true; } catch { return false; } })();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hanubix-deploy-'));
  bin = join(root, 'bin'); log = join(root, 'docker.log'); alerts = join(root, 'alerts.txt');
  mkdirSync(bin); mkdirSync(join(root, 'shared')); mkdirSync(join(root, 'server'));
  writeFileSync(join(root, 'shared', 'tables.json'), '{"tables":[]}');
  cpSync(join(repo, 'deploy'), join(root, 'deploy'), { recursive: true, filter: s => !s.includes('backups') && !s.endsWith('-tag') });
  // a real age key pair (the founder's): only the public half goes in .env
  const key = join(root, 'founder.key');
  if (hasAge) execSync(`age-keygen -o ${key}`, { stdio: 'ignore' });
  const pub = hasAge ? readFileSync(key, 'utf8').match(/public key: (age1\w+)/)![1] : 'age1missing';
  writeFileSync(join(root, 'deploy', '.env'), `DOMAIN=api.example.com\nDB_PASSWORD=pw\nBACKUP_AGE_RECIPIENT=${pub}\nBACKUP_BUCKET=gs://hanubix-test\nALERT_TELEGRAM_BOT_TOKEN=t\nALERT_TELEGRAM_CHAT_ID=1\n`);
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER); chmodSync(join(bin, 'docker'), 0o755);
  writeFileSync(join(bin, 'git'), FAKE_GIT); chmodSync(join(bin, 'git'), 0o755);
  writeFileSync(join(bin, 'gsutil'), FAKE_GSUTIL); chmodSync(join(bin, 'gsutil'), 0o755);
  writeFileSync(join(bin, 'curl'), FAKE_CURL); chmodSync(join(bin, 'curl'), 0o755);
  writeFileSync(log, ''); writeFileSync(alerts, '');
});
const run = (script: string, env: Record<string, string> = {}, args: string[] = []) =>
  spawnSync('bash', [join(root, 'deploy', script), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOG: log, ALERTS: alerts, ROOT: root, HEALTH_WAIT: '0', HEALTH_GAP: '0', ...env } });
const sent = () => readFileSync(alerts, 'utf8').split('\n').filter(l => l.includes('telegram'));
const tag = (f: string) => existsSync(join(root, 'deploy', f)) ? readFileSync(join(root, 'deploy', f), 'utf8').trim() : '';

// each case starts many small shell programs; GitHub's machines are slower than ours (a 5 s limit timed out there, 13 Nov)
describe('deploy kit', { timeout: 60000 }, () => {
  it('the compose file works with no TAG set (backup, first start)', () => {
    let ok = true;
    try { execSync('docker compose version', { stdio: 'ignore' }); } catch { ok = false; }
    if (!ok) return; // no docker on this machine: the fake-docker tests below still run
    const r = spawnSync('docker', ['compose', '-f', join(root, 'deploy', 'docker-compose.yml'), 'config', '-q'], { encoding: 'utf8', env: { ...process.env, TAG: '', DOMAIN: 'api.example.com', DB_PASSWORD: 'pw' } });
    expect(r.status, r.stderr).toBe(0);
  });

  it('first deploy goes live and backs up first', () => {
    const r = run('deploy.sh', { SHA: 'aaa111', HEALTHY: 'aaa111' }, ['--now']);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(tag('.live-tag')).toBe('aaa111');
    const calls = readFileSync(log, 'utf8');
    expect(calls.indexOf('pg_dump')).toBeLessThan(calls.indexOf('build'));
    expect(readdirSync(join(root, 'deploy', 'backups')).filter(f => f.endsWith('.dump.age')).length).toBe(1);
  });

  it('a failed first version is stopped, not left running', () => {
    const r = run('deploy.sh', { SHA: 'bad000', HEALTHY: 'none' }, ['--now']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/no earlier version/);
    expect(readFileSync(log, 'utf8')).toMatch(/stop server/);
    expect(tag('.live-tag')).toBe('');
  });

  it('a failed build never leaves an old table list for the next image', () => {
    expect(run('deploy.sh', { SHA: 'ccc333', FAIL_BUILD: '1' }, ['--now']).status).not.toBe(0);
    expect(existsSync(join(root, 'server', 'shared'))).toBe(false);
    expect(run('deploy.sh', { SHA: 'ccc333', HEALTHY: 'ccc333' }, ['--now']).status).toBe(0);
    expect(readFileSync(log, 'utf8')).not.toMatch(/stale-nested/);
  });

  it('a new version that fails its check goes straight back; rollback checks and swaps', () => {
    expect(run('deploy.sh', { SHA: 'v1', HEALTHY: 'v1' }, ['--now']).status).toBe(0);
    const bad = run('deploy.sh', { SHA: 'v2', HEALTHY: 'v1' }, ['--now']);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/Back on v1/);
    expect(tag('.live-tag')).toBe('v1');
    expect(run('deploy.sh', { SHA: 'v3', HEALTHY: 'v1 v3' }, ['--now']).status).toBe(0);
    expect([tag('.live-tag'), tag('.previous-tag')]).toEqual(['v3', 'v1']);
    const rb = run('rollback.sh', { HEALTHY: 'v1 v3' });
    expect(rb.status, rb.stdout).toBe(0);
    expect([tag('.live-tag'), tag('.previous-tag')]).toEqual(['v1', 'v3']);
    const rbBad = run('rollback.sh', { HEALTHY: 'v1' }); // v3 won't start: v1 stays recorded as live
    expect(rbBad.status).toBe(1);
    expect(tag('.live-tag')).toBe('v1');
  });

  it('daytime deploys need --now', () => {
    const hour = Number(new Date(Date.now() + 330 * 60000).toISOString().slice(11, 13));
    const r = run('deploy.sh', { SHA: 'd1', HEALTHY: 'd1' });
    expect(r.status).toBe(hour >= 5 && hour < 23 ? 1 : 0);
  });

  it('a failed dump leaves no half file that looks like a backup', () => {
    expect(run('backup.sh', { FAIL_DUMP: '1' }).status).not.toBe(0);
    const dir = join(root, 'deploy', 'backups');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  // ---------------------------------------------------------------- security standard (13 Nov 2026)
  it('only a commit the gate passed (gate-<commit> tag) goes live', () => {
    const r = run('deploy.sh', { SHA: 'nog111', HEALTHY: 'nog111', NO_GATE: '1' }, ['--now']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/no gate-passed tag/);
    expect(readFileSync(log, 'utf8')).not.toMatch(/build/);
    expect(tag('.live-tag')).toBe('');
  });

  it('every deploy is written to the activity log', () => {
    expect(run('deploy.sh', { SHA: 'lg1', HEALTHY: 'lg1' }, ['--now']).status).toBe(0);
    expect(readFileSync(log, 'utf8')).toMatch(/seclog_add\(NULL, '[^']+', 'founder', 'deploy', 'lg1'/);
  });

  it.runIf(hasAge)('the backup is age-encrypted: no plain dump on disk, no shop name inside; a manifest with rows and sha256', () => {
    const r = run('backup.sh');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const dir = join(root, 'deploy', 'backups');
    const files = readdirSync(dir);
    expect(files.filter(f => f.endsWith('.dump'))).toEqual([]);
    const enc = files.find(f => f.endsWith('.dump.age'))!;
    const bytes = readFileSync(join(dir, enc));
    expect(bytes.subarray(0, 21).toString()).toBe('age-encryption.org/v1');
    expect(bytes.includes(Buffer.from('Murugan'))).toBe(false);
    expect(bytes.includes(Buffer.from('9876543210'))).toBe(false);
    const man = readFileSync(join(dir, files.find(f => f.endsWith('.manifest'))!), 'utf8');
    expect(man).toMatch(/^rows public\.docs_p0\|2$/m);
    expect(man).toMatch(/^rows public\.users\|1$/m);
    expect(man).toMatch(new RegExp(`^sha256 ${execSync(`sha256sum ${join(dir, enc)}`).toString().split(' ')[0]}$`, 'm'));
    // the founder's private key opens it again (the restore drill's first step)
    expect(execSync(`age -d -i ${join(root, 'founder.key')} ${join(dir, enc)}`).toString()).toMatch(/Murugan Stores/);
    expect(readFileSync(log, 'utf8')).toMatch(/gsutil -q cp .*\.dump\.age .*\.manifest gs:\/\/hanubix-test\/db\//);
    expect(existsSync(join(root, 'deploy', '.last-backup-ok'))).toBe(true);
  });

  it.runIf(hasAge)('a failed upload exits non-zero and sends the alert; before an update it alerts and goes on', () => {
    const r = run('backup.sh', { FAIL_UPLOAD: '1' });
    expect(r.status).not.toBe(0);
    expect(sent().length).toBe(1);
    expect(existsSync(join(root, 'deploy', '.last-backup-ok'))).toBe(false);
    const before = run('backup.sh', { FAIL_UPLOAD: '1' }, ['--before-deploy']);
    expect(before.status).toBe(0);
    expect(sent().length).toBe(2);
  });

  it('a backup without the founder\'s public key is refused (never a plain backup)', () => {
    writeFileSync(join(root, 'deploy', '.env'), 'DOMAIN=api.example.com\nDB_PASSWORD=pw\n');
    const r = run('backup.sh');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/BACKUP_AGE_RECIPIENT/);
    expect(existsSync(join(root, 'deploy', 'backups')) ? readdirSync(join(root, 'deploy', 'backups')) : []).toEqual([]);
  });

  it('monitor: a stopped server alerts once, not every 5 minutes, and clears when it is back', () => {
    writeFileSync(join(root, 'deploy', '.last-backup-ok'), new Date().toISOString());
    writeFileSync(join(root, 'deploy', '.last-verify-ok'), new Date().toISOString());
    const env = { DOMAIN: '', DISK_MAX: '101', MEM_MAX: '101' };
    for (let i = 0; i < 3; i++) run('monitor.sh', { ...env, HEALTHY: 'down' }); // the server container answers nothing
    expect(sent().filter(l => /health/.test(l)).length).toBe(1);
    run('monitor.sh', { ...env, HEALTHY: 'none' }); // back (no version tag on this test machine: "none")
    expect(sent().filter(l => /health/.test(l)).length).toBe(2); // the "cleared" message
    expect(sent().some(l => /cleared/.test(l))).toBe(true);
  });

  it('monitor: a backup older than 26 hours alerts', () => {
    writeFileSync(join(root, 'deploy', '.last-backup-ok'), new Date(Date.now() - 30 * 3600e3).toISOString());
    writeFileSync(join(root, 'deploy', '.last-verify-ok'), new Date().toISOString());
    run('monitor.sh', { HEALTHY: 'none', DOMAIN: '', DISK_MAX: '101', MEM_MAX: '101' });
    expect(sent().some(l => /backup/.test(l) && /30 hours/.test(l))).toBe(true);
  });

  it('security watch: 25 wrong logins alert once, not 25 times', () => {
    for (let i = 0; i < 3; i++) run('security-watch.sh', { FAILS: '25' });
    expect(sent().filter(l => /failed-logins/.test(l)).length).toBe(1);
    run('security-watch.sh', { FAILS: '0' });
    expect(sent().filter(l => /failed-logins/.test(l) && /cleared/.test(l)).length).toBe(1);
  });

  it('verify-log: a broken chain prints the row and exits non-zero; a whole chain writes the anchor off the machine', () => {
    const bad = run('verify-log.sh', { CHAIN_BROKEN: '17' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/chain broken at id 17/);
    expect(sent().length).toBe(1);
    const good = run('verify-log.sh');
    expect(good.status, good.stdout).toBe(0);
    expect(readFileSync(log, 'utf8')).toMatch(/gsutil -q cp anchors\/.*\.txt gs:\/\/hanubix-test\/seclog-anchors\//);
    expect(existsSync(join(root, 'deploy', '.last-verify-ok'))).toBe(true);
  });

  it('every script is valid bash', () => {
    for (const f of readdirSync(join(repo, 'deploy')).filter(f => f.endsWith('.sh'))) {
      const r = spawnSync('bash', ['-n', join(repo, 'deploy', f)], { encoding: 'utf8' });
      expect(r.status, `${f}: ${r.stderr}`).toBe(0);
    }
  });

  // security review, 13 Nov 2026: an empty authorized_keys passed the check (passwords off → locked out), and the firewall
  // was reset before SSH was allowed again (a moment with SSH blocked)
  it('harden.sh needs a real SSH key line, and allows SSH before it tightens the firewall', () => {
    const h = readFileSync(join(repo, 'deploy', 'harden.sh'), 'utf8');
    expect(h).toMatch(/grep -Eqs? '\^\(ssh-\|ecdsa-\|sk-\)'/);
    const sshFirst = h.indexOf('to any port 22'), deny = h.indexOf('ufw default deny incoming'), enable = h.indexOf('ufw --force enable');
    expect(sshFirst).toBeGreaterThan(0);
    expect(sshFirst).toBeLessThan(deny); expect(deny).toBeLessThan(enable);
    expect(h).toMatch(/SSH_CLIENT/); // the session running the script stays allowed
    // a reset only while the firewall is off (nothing is being blocked then)
    for (const line of h.split('\n').filter(l => l.includes('ufw --force reset'))) expect(line).toMatch(/Status: active/);
  });
});
