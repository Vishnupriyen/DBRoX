// A live Hanubix server on this machine for the working-app test: real Postgres (kept on disk), production settings.
// Usage: LIVE_DIR=/path PORT=8790 npx tsx test/live.ts   (prints the licence PUBLIC key the app must be built with)
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const dir = process.env.LIVE_DIR ?? '/tmp/hanubix-live';
mkdirSync(dir, { recursive: true, mode: 0o777 }); chmodSync(dir, 0o777); // Postgres runs as its own user
const keyFile = join(dir, 'keys.json');
if (!existsSync(keyFile)) {
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(keyFile, JSON.stringify({ priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), jwt: randomBytes(48).toString('hex') }));
}
const keys = JSON.parse(readFileSync(keyFile, 'utf8'));
const pgPort = 54600;
const fresh = !existsSync(join(dir, 'pg', 'PG_VERSION'));
const pgServer = new EmbeddedPostgres({ databaseDir: join(dir, 'pg'), user: 'postgres', password: 'pw', port: pgPort, persistent: true, onLog: () => {} });
if (fresh) await pgServer.initialise();
await pgServer.start();
if (fresh) await pgServer.createDatabase('dbrox');

Object.assign(process.env, { NODE_ENV: 'production', DATABASE_URL: `postgres://postgres:pw@localhost:${pgPort}/dbrox`, JWT_SECRET: keys.jwt, LICENCE_PRIVATE_KEY: keys.priv, DB_POOL: '20' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
const { migrate } = await import('../src/db.js');
await migrate(pool);
const { buildApp } = await import('../src/app.js');
const app = await buildApp(pool);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8790) });
writeFileSync(join(dir, 'public-key.txt'), keys.pub);
console.log(`LIVE server on :${process.env.PORT ?? 8790} · database ${dir}/pg · public key in ${dir}/public-key.txt`);
const stop = async () => { await app.close(); await pool.end(); await pgServer.stop(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
