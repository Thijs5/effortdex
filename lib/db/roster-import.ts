// docs/adr/0025 §3/§6 — writes the `parties` / `rosterEntries` /
// `events` / `meta` rows from the in-memory roster state.
//
//   - first launch of the IndexedDB build: `{ firstRunOnly: true }`
//     imports the blob once and stamps `meta.rosterImported`.
//   - every structural `_save` after that: an unconditional re-write
//     (fire-and-forget). Event append/delete uses the targeted
//     `roster-ops.ts` path instead.

import { writeRoster, readImportMarker, writeImportMarker } from './roster-io.ts';
import type { Db } from './index.ts';

/**
 * @returns a function that resolves true if it wrote, false if
 *   `firstRunOnly` and the import already happened.
 */
export function makeRosterMirror(
  db: Db,
): (state: any, opts?: { firstRunOnly?: boolean }) => Promise<boolean> {
  return async (state, { firstRunOnly = false } = {}) => {
    if (firstRunOnly && (await readImportMarker(db))) return false;
    await writeRoster(db, state);
    if (firstRunOnly) {
      const parties: any[] = Array.isArray(state.parties) ? state.parties : [];
      await writeImportMarker(db, {
        at: Date.now(),
        parties: parties.length,
        pokemon: parties.reduce((n: number, p: any) => n + (p.pokemon?.length ?? 0), 0),
      });
    }
    return true;
  };
}
