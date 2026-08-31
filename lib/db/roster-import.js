// @ts-check
// docs/adr/0025 P4a — keep the `parties` / `rosterEntries` / `events`
// object stores in sync with the roster Store still keeps in the
// localStorage blob. The blob stays authoritative until P4b flips the
// read; this is a verified shadow copy in the meantime.
//
//   - first launch of the P4 build:  `{ firstRunOnly: true }` writes the
//     rows once and stamps `meta.rosterImported` (docs/adr/0025 §6).
//   - every `_save` after that:       an unconditional re-write keeps the
//     rows fresh (fire-and-forget; P4c replaces it with targeted writes).

import { writeRoster, readImportMarker, writeImportMarker } from './roster-io.js';

/**
 * @param {import('./index.js').Db} db
 * @returns {(state: any, opts?: { firstRunOnly?: boolean }) => Promise<boolean>}
 *   resolves true if it wrote, false if `firstRunOnly` and the import
 *   already happened.
 */
export function makeRosterMirror(db) {
  return async (state, { firstRunOnly = false } = {}) => {
    if (firstRunOnly && (await readImportMarker(db))) return false;
    await writeRoster(db, state);
    if (firstRunOnly) {
      const parties = Array.isArray(state.parties) ? state.parties : [];
      await writeImportMarker(db, {
        at: Date.now(),
        parties: parties.length,
        pokemon: parties.reduce((/** @type {number} */ n, /** @type {any} */ p) => n + (p.pokemon?.length ?? 0), 0),
      });
    }
    return true;
  };
}
