// The relay has one source, shared/relay.ts (the phone uses it for the demo). Copy it in before build/test/dev.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
const from = ['../shared/relay.ts', 'shared/relay.ts'].find(p => existsSync(p));
if (!from) { console.error('shared/relay.ts not found'); process.exit(1); }
mkdirSync('src/gen', { recursive: true });
copyFileSync(from, 'src/gen/relay.ts');
