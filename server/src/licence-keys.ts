// One-time: make the licence key pair.   cd server && npx tsx src/licence-keys.ts
// Put the PRIVATE key in Google Secret Manager as "hanubix-licence-key" (server only, never in the app or GitHub).
// Put the PUBLIC key in GitHub → Settings → Secrets → Actions as LICENCE_PUBLIC_KEY (built into the app).
import { generateKeyPairSync } from 'node:crypto';
const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log('--- PRIVATE key (Secret Manager: hanubix-licence-key) ---');
console.log(k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
console.log('--- PUBLIC key (GitHub secret: LICENCE_PUBLIC_KEY) ---');
console.log(k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
