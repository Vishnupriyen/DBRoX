import { migrate, pool } from './db.js';

await migrate();
console.log('Migrations done');
await pool.end();
