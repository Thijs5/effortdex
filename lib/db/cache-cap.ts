// A ceiling on the `apiCache` object store (docs/adr/0025 P2). ADR 0001
// says PokéAPI data is cached "forever" — that means "never goes stale",
// not "unbounded". IndexedDB's quota is large, but an ever-growing cache
// still slows every full scan and wastes disk. `sw.js` already caps the
// sprite Cache Storage the same way (4000 entries).
//
// Not enforced per write — that would make every `set` do a count. A
// single idle-time sweep per session keeps it within a session's growth
// of the cap, which is plenty.

import type { Db } from './index.ts';
import type { ApiCacheRow } from './schema.ts';

const STORE = 'apiCache';

// Per `kind` (the token before the first ':' in the key). Sized to a
// heavy user: every species looked up in battle-logging + adding, a few
// evolution families, all nine generation lists. Kinds not listed
// (`species-list`, `smogon`) are tiny and fixed — left alone.
const CAPS: Record<string, number> = {
  mon: 2000,
  species: 1500,
  evochain: 1500,
  evolutions: 1500,
  generation: 30,
};

/**
 * Trims each capped `kind` down to its limit, evicting the entries with
 * the oldest `fetchedAt` first. One `readwrite` transaction. Best-effort
 * — resolves quietly on any failure.
 * @returns entries removed
 */
export async function trimApiCache(db: Db): Promise<number> {
  let removed = 0;
  try {
    for (const [kind, cap] of Object.entries(CAPS)) {
      const rows = await db.getAllByIndex<ApiCacheRow>(STORE, 'kind', kind).catch(() => []);
      if (rows.length <= cap) continue;
      const doomed = rows
        .sort((a, b) => (a.fetchedAt ?? 0) - (b.fetchedAt ?? 0))
        .slice(0, rows.length - cap)
        .map((r) => r.key);
      await db
        .transaction([STORE], 'readwrite', (tx) => {
          const os = tx.objectStore(STORE);
          for (const k of doomed) os.delete(k);
        })
        .catch(() => {});
      removed += doomed.length;
    }
  } catch {
    /* best-effort */
  }
  return removed;
}
