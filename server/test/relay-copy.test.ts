// The server runs a copy of shared/relay.ts (the privacy wall). A stale copy would mean the server and the phones
// apply different rules: fail loudly. (`npm test` refreshes it; running vitest directly does not.)
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
describe('relay copy', () => {
  it('is the same as shared/relay.ts', () => {
    const src = new URL('../../shared/relay.ts', import.meta.url);
    if (!existsSync(src)) return; // inside the server image only the copy exists
    expect(readFileSync(new URL('../src/gen/relay.ts', import.meta.url), 'utf8'), 'run `npm test` (it copies shared/relay.ts)').toBe(readFileSync(src, 'utf8'));
  });
});
