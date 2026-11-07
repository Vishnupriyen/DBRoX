import { publicKeySpki } from './licence.js';
import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';

// refuse to start without the licence key in production: never hand out licences nobody can check
if (process.env.NODE_ENV === 'production') publicKeySpki();

await migrate();
const app = await buildApp(pool);
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`DBRoX server on :${config.port}`);

const stop = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', stop); // Cloud Run sends SIGTERM before stopping an instance
process.on('SIGINT', stop);
