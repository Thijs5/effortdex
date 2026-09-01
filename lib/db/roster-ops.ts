// docs/adr/0025 P4c — targeted roster writes. The event append/delete
// path (every battle / vitamin / level / stat-reading — the great
// majority of writes) persists as a single `events.add` / `events.delete`
// instead of `writeRoster` clearing and rewriting all three stores.
//
// Structural mutations (create/delete/reorder a party or entry, edit an
// entry field) are rare and still go through the whole-roster mirror —
// so this applier only needs `events` + `meta`. Widen the store list
// here if more op types are added.

import type { Db } from './index.ts';

export type RosterOp =
  | { type: 'putEvent'; entryUid: string; event: any }
  | { type: 'deleteEvent'; id: string };

export function makeRosterOpsApplier(
  db: Db,
): (ops: RosterOp[], meta: { rev: number; activePartyId: string | null }) => Promise<unknown> {
  return (ops, meta) =>
    db.transaction(['events', 'meta'], 'readwrite', (tx) => {
      const events = tx.objectStore('events');
      for (const op of ops) {
        if (op.type === 'putEvent') events.put({ ...op.event, entryUid: op.entryUid });
        else if (op.type === 'deleteEvent') events.delete(op.id);
      }
      const m = tx.objectStore('meta');
      m.put({ key: 'rosterRev', value: meta.rev });
      m.put({ key: 'activePartyId', value: meta.activePartyId ?? null });
    });
}
