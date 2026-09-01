// The one module in lib/db/ that knows the roster's shape: it maps the
// `{ rev, statExpBackfillApplied, activePartyId, parties: [...] }` state
// Store keeps in memory to and from the relational `parties` /
// `rosterEntries` / `events` / `meta` object stores (docs/adr/0025 §3,
// §6). Everything else about the roster stays in lib/store.js.
//
// `writeRoster` populates the rows from an already-normalised in-memory
// state; `readRoster` reconstructs that state from the rows. `init()`
// reads from `readRoster` (docs/adr/0025 §3); the localStorage blob is a
// dual-write backup reconciled by `rev`.

import { uniqueSlug } from '../slug.ts';
import type { Db } from './index.ts';
import type { EventRow, MetaRow, PartyRow, RosterEntryRow } from './schema.ts';

const META_ACTIVE_PARTY = 'activePartyId';
const META_BACKFILL = 'statExpBackfillApplied';
const META_IMPORTED = 'rosterImported';
const META_REV = 'rosterRev'; // docs/adr/0025 P4b — monotonic, mirrors the blob's `rev`

/** The columns of a `parties` row (everything but `pokemon`, plus `order`). */
const PARTY_FIELDS = ['id', 'name', 'description', 'baseGame', 'overrides', 'slug'];
/** The source-of-truth columns of a `rosterEntries` row (everything but `events`, plus `partyId`/`order`). */
const ENTRY_FIELDS = ['uid', 'nickname', 'nature', 'powerItem', 'machoBrace', 'ivs'];

function pick(obj: any, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

/**
 * Writes an already-normalised in-memory roster state into the object
 * stores, in ONE transaction (atomic — a throw rolls the whole thing
 * back). Party and entry `order` come from array position. Duplicate
 * party slugs are re-uniqued first: `parties.slug` is a UNIQUE index and
 * `_normalizeEntries` only backfills *missing* slugs, never collisions
 * (docs/adr/0025 §6).
 *
 * @param state - `{ statExpBackfillApplied?, activePartyId, parties: [...] }`
 */
export function writeRoster(db: Db, state: any): Promise<void> {
  const parties: any[] = Array.isArray(state.parties) ? state.parties : [];

  // Slug de-dupe pre-pass (outside the transaction — pure).
  const seen = new Set<string>();
  const slugs = parties.map((p: any) => {
    let slug = p.slug || uniqueSlug(p.name || 'Party', seen);
    if (seen.has(slug)) slug = uniqueSlug(p.name || 'Party', seen);
    seen.add(slug);
    return slug;
  });

  return db.transaction(['parties', 'rosterEntries', 'events', 'meta'], 'readwrite', (tx) => {
    const partiesOS = tx.objectStore('parties');
    const entriesOS = tx.objectStore('rosterEntries');
    const eventsOS = tx.objectStore('events');
    const metaOS = tx.objectStore('meta');

    partiesOS.clear();
    entriesOS.clear();
    eventsOS.clear();

    parties.forEach((party: any, pi: number) => {
      partiesOS.put({ ...pick(party, PARTY_FIELDS), slug: slugs[pi], order: pi });
      const pokemon: any[] = Array.isArray(party.pokemon) ? party.pokemon : [];
      pokemon.forEach((entry: any, ei: number) => {
        entriesOS.put({ ...pick(entry, ENTRY_FIELDS), partyId: party.id, order: ei });
        const events: any[] = Array.isArray(entry.events) ? entry.events : [];
        for (const ev of events) eventsOS.put({ ...ev, entryUid: entry.uid });
      });
    });

    metaOS.put({ key: META_ACTIVE_PARTY, value: state.activePartyId ?? null });
    metaOS.put({ key: META_BACKFILL, value: !!state.statExpBackfillApplied });
    metaOS.put({ key: META_REV, value: state.rev ?? 0 });
  });
}

export interface RosterState {
  rev: number;
  statExpBackfillApplied: boolean;
  activePartyId: string | null;
  parties: any[];
}

/**
 * Reconstructs the in-memory roster state from the object stores —
 * `parties` in `order`, each party's `rosterEntries` in `order`, each
 * entry's `events` in `entryUid+id` order (uuidv7 == fold order).
 */
export async function readRoster(db: Db): Promise<RosterState> {
  const [partyRows, entryRows, eventRows, metaRows] = await Promise.all([
    db.getAll<PartyRow>('parties'),
    db.getAll<RosterEntryRow>('rosterEntries'),
    db.getAll<EventRow>('events'),
    db.getAll<MetaRow>('meta'),
  ]);

  const eventsByEntry = new Map<string, any[]>();
  for (const ev of eventRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const list = eventsByEntry.get(ev.entryUid) ?? [];
    const { entryUid, ...event } = ev;
    list.push(event);
    eventsByEntry.set(ev.entryUid, list);
  }

  const entriesByParty = new Map<string, any[]>();
  for (const row of entryRows.sort((a, b) => a.order - b.order)) {
    const list = entriesByParty.get(row.partyId) ?? [];
    const { partyId, order, ...entry } = row;
    (entry as any).events = eventsByEntry.get(entry.uid) ?? [];
    list.push(entry);
    entriesByParty.set(row.partyId, list);
  }

  const parties = partyRows
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...party }) => ({ ...party, pokemon: entriesByParty.get(party.id) ?? [] }));

  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value] as [string, unknown]));
  return {
    rev: Number(meta[META_REV]) || 0,
    statExpBackfillApplied: !!meta[META_BACKFILL],
    activePartyId: (meta[META_ACTIVE_PARTY] as string | null) ?? null,
    parties,
  };
}

export async function readImportMarker(db: Db): Promise<any | null> {
  return (await db.get('meta', META_IMPORTED)) ?? null;
}

export function writeImportMarker(db: Db, info: any): Promise<IDBValidKey> {
  return db.put('meta', { key: META_IMPORTED, value: info });
}
