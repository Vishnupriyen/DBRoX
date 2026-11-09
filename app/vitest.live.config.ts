// The working-app test's history step (not part of the everyday gate): see tests/live/history.live.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/live/*.live.ts'], testTimeout: 4 * 3600_000 } });
