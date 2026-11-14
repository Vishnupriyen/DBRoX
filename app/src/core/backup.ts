// The owner's "Download full backup" (More → App). The phone's own security records (login token, PIN hashes, wrong-PIN
// counts) and each person's private TESRAX chats and My files never go into the file (security, 14 Nov 2026).
import { db } from './db';

/** every meta key name on this phone is either backed up or kept out of the file — tests/backup.test.ts holds the list */
export const META_EXCLUDED = ['auth', 'pinv', 'pinFails', 'chat', 'myfiles'] as const;
export const META_BACKED_UP = ['accessRemoved', 'archive', 'archiveDone', 'catchUpCursor', 'consent', 'cursor', 'held', 'knownTables', 'lastServer', 'licence', 'mustPin', 'purgedOn'] as const;
const OUT = /^(auth\.|pinv:|pinFails|chat:|myfiles:)/;
export const keepInBackup = (key: string) => !OUT.test(key);

export async function backupDump(): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const tb of db.tables) dump[tb.name] = tb.name === 'meta' ? (await tb.toArray()).filter(r => keepInBackup(String((r as { key: string }).key))) : await tb.toArray();
  return dump;
}
