// The million-message TESRAX run (not part of the everyday gate): npm run train:million
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/million/*.million.ts'], testTimeout: 4 * 3600_000, hookTimeout: 600_000 } });
