import 'fake-indexeddb/auto';
import { it } from 'vitest';
import { runShard } from './million';
it('TESRAX million, shard 1 of 4', () => runShard(1, 4), 4 * 3600_000);
