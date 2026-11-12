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
let root = '', bin = '', log = '';

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "TAG=\${TAG:-} $*" >> "$LOG"
case "$*" in
  build*) [[ -n "\${FAIL_BUILD:-}" ]] && exit 1; [[ -d "$ROOT/server/shared/shared" ]] && { echo stale-nested >> "$LOG"; }; exit 0 ;;
  *"exec -T server"*) [[ "\${HEALTHY:-}" == *"\${TAG}"* ]] && exit 0 || exit 1 ;;
  *"pg_dump"*) [[ -n "\${FAIL_DUMP:-}" ]] && { echo partial; exit 1; }; echo dumpdata; exit 0 ;;
  *) exit 0 ;;
esac`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hanubix-deploy-'));
  bin = join(root, 'bin'); log = join(root, 'docker.log');
  mkdirSync(bin); mkdirSync(join(root, 'shared')); mkdirSync(join(root, 'server'));
  writeFileSync(join(root, 'shared', 'tables.json'), '{"tables":[]}');
  cpSync(join(repo, 'deploy'), join(root, 'deploy'), { recursive: true, filter: s => !s.includes('backups') && !s.endsWith('-tag') });
  writeFileSync(join(root, 'deploy', '.env'), 'DOMAIN=api.example.com\nDB_PASSWORD=pw\n');
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER); chmodSync(join(bin, 'docker'), 0o755);
  writeFileSync(join(bin, 'git'), '#!/usr/bin/env bash\necho "$SHA"'); chmodSync(join(bin, 'git'), 0o755);
  writeFileSync(log, '');
});
const run = (script: string, env: Record<string, string> = {}, args: string[] = []) =>
  spawnSync('bash', [join(root, 'deploy', script), ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LOG: log, ROOT: root, HEALTH_WAIT: '0', ...env } });
const tag = (f: string) => existsSync(join(root, 'deploy', f)) ? readFileSync(join(root, 'deploy', f), 'utf8').trim() : '';

describe('deploy kit', () => {
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
    expect(readdirSync(join(root, 'deploy', 'backups')).filter(f => f.endsWith('.dump')).length).toBe(1);
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
});
