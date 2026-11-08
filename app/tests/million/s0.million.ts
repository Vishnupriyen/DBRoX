import 'fake-indexeddb/auto';
import { it } from 'vitest';
import { runShard } from './million';
it('TESRAX million, shard 0 of 4', () => runShard(0, 4), 4 * 3600_000);
