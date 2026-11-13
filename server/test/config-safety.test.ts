// Free security scan, 13 Nov 2026: the login-signing secret had no minimum length, and a server started without NODE_ENV fell
// back to a public "dev-only" secret — anyone could then sign a login for any firm. Regression tests first.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const start = (env: Record<string, string | undefined>) => {
  const e = { ...process.env, ...env } as Record<string, string>;
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete e[k];
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/config.ts'); console.log('STARTED')"], { cwd: dir, env: e, encoding: 'utf8' });
  return (r.stdout + r.stderr);
};

describe('the login-signing secret', { timeout: 60000 }, () => {
  it('a server with no NODE_ENV and no secret refuses to start (never the public dev secret)', () => {
    expect(start({ NODE_ENV: undefined, JWT_SECRET: undefined })).not.toMatch(/STARTED/);
  });
  it('a short secret is refused in production', () => {
    expect(start({ NODE_ENV: 'production', JWT_SECRET: 'short-secret', CORS_ORIGIN: 'https://hanubix.com' })).toMatch(/at least 32/);
  });
  it('a long secret starts', () => {
    expect(start({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), CORS_ORIGIN: 'https://hanubix.com' })).toMatch(/STARTED/);
  });
  it('tests and local development still start without one', () => {
    expect(start({ NODE_ENV: 'test', JWT_SECRET: undefined })).toMatch(/STARTED/);
    expect(start({ NODE_ENV: 'development', JWT_SECRET: undefined })).toMatch(/STARTED/);
  });
});
