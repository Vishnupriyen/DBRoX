import { publicKeySpki } from './licence.js';
import { buildApp } from './app.js';
import { config } from './config.js';
import { appPool, migrate, pool } from './db.js';

// refuse to start without the licence key in production: never hand out licences nobody can check
if (process.env.NODE_ENV === 'production') publicKeySpki();
// production answers requests as the limited database role only (never as the owner that can drop tables)
if (process.env.NODE_ENV === 'production' && !process.env.DB_APP_PASSWORD) throw new Error('DB_APP_PASSWORD must be set in production');

await migrate();
const requests = await appPool(pool);
const app = await buildApp(requests, { owner: pool });
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`DBRoX server on :${config.port}`);

const stop = async () => { await app.close(); if (requests !== pool) await requests.end(); await pool.end(); process.exit(0); };
process.on('SIGTERM', stop); // docker compose sends SIGTERM before stopping the container
process.on('SIGINT', stop);
