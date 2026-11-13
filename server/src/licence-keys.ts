// One-time: make the licence key pair.   cd server && npx tsx src/licence-keys.ts
// Put the PRIVATE key in deploy/.env on the server as LICENCE_PRIVATE_KEY (root-only file) and in the founder's offline
// copy — never in the app, the repo or GitHub (docs/security/06-cryptography.md).
// Put the PUBLIC key in GitHub → Settings → Secrets → Actions as LICENCE_PUBLIC_KEY (built into the app).
import { generateKeyPairSync } from 'node:crypto';
const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log('--- PRIVATE key (deploy/.env LICENCE_PRIVATE_KEY + the founder offline copy) ---');
console.log(k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log('--- PUBLIC key (GitHub secret: LICENCE_PUBLIC_KEY) ---');
console.log(k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
