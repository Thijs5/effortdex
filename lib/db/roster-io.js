// @ts-check
// The one module in lib/db/ that knows the roster's shape: it maps the
// `{ schema, statExpBackfillApplied, activePartyId, parties: [...] }`
// blob Store keeps in memory to and from the relational `parties` /
// `rosterEntries` / `events` / `meta` object stores (docs/adr/0025 §3,
// §6). Everything else about the roster stays in lib/store.js.
//
// P4a: `writeRoster` populates the rows from an already-normalised
// in-memory state; `readRoster` reconstructs that state from the rows.
// The localStorage blob is still authoritative — these are exercised
// and verified against it before P4b flips the read.

import { uniqueSlug } from '../slug.js';

const META_ACTIVE_PARTY = 'activePartyId';
const META_BACKFILL = 'statExpBackfillApplied';
const META_IMPORTED = 'rosterImported';

/** The columns of a `parties` row (everything but `pokemon`, plus `order`). */
const PARTY_FIELDS = ['id', 'name', 'description', 'baseGame', 'overrides', 'slug'];
/** The source-of-truth columns of a `rosterEntries` row (everything but `events`, plus `partyId`/`order`). */
const ENTRY_FIELDS = ['uid', 'nickname', 'nature', 'powerItem', 'machoBrace', 'ivs'];

/** @param {any} obj @param {string[]} keys */
function pick(obj, keys) {
  /** @type {any} */
  const out = {};
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
 * @param {import('./index.js').Db} db
 * @param {any} state - `{ statExpBackfillApplied?, activePartyId, parties: [...] }`
 * @returns {Promise<void>}
 */
export function writeRoster(db, state) {
  const parties = Array.isArray(state.parties) ? state.parties : [];

  // Slug de-dupe pre-pass (outside the transaction — pure).
  /** @type {Set<string>} */
  const seen = new Set();
  const slugs = parties.map((/** @type {any} */ p) => {
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

    parties.forEach((/** @type {any} */ party, /** @type {number} */ pi) => {
      partiesOS.put({ ...pick(party, PARTY_FIELDS), slug: slugs[pi], order: pi });
      const pokemon = Array.isArray(party.pokemon) ? party.pokemon : [];
      pokemon.forEach((/** @type {any} */ entry, /** @type {number} */ ei) => {
        entriesOS.put({ ...pick(entry, ENTRY_FIELDS), partyId: party.id, order: ei });
        const events = Array.isArray(entry.events) ? entry.events : [];
        for (const ev of events) eventsOS.put({ ...ev, entryUid: entry.uid });
      });
    });

    metaOS.put({ key: META_ACTIVE_PARTY, value: state.activePartyId ?? null });
    metaOS.put({ key: META_BACKFILL, value: !!state.statExpBackfillApplied });
  });
}

/**
 * Reconstructs the in-memory roster state from the object stores —
 * `parties` in `order`, each party's `rosterEntries` in `order`, each
 * entry's `events` in `entryUid+id` order (uuidv7 == fold order).
 *
 * @param {import('./index.js').Db} db
 * @returns {Promise<{ statExpBackfillApplied: boolean, activePartyId: string|null, parties: any[] }>}
 */
export async function readRoster(db) {
  const [partyRows, entryRows, eventRows, metaRows] = await Promise.all([
    db.getAll('parties'),
    db.getAll('rosterEntries'),
    db.getAll('events'),
    db.getAll('meta'),
  ]);

  /** @type {Map<string, any[]>} */
  const eventsByEntry = new Map();
  for (const ev of eventRows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const list = eventsByEntry.get(ev.entryUid) ?? [];
    const { entryUid, ...event } = ev;
    list.push(event);
    eventsByEntry.set(ev.entryUid, list);
  }

  /** @type {Map<string, any[]>} */
  const entriesByParty = new Map();
  for (const row of entryRows.sort((a, b) => a.order - b.order)) {
    const list = entriesByParty.get(row.partyId) ?? [];
    const { partyId, order, ...entry } = row;
    entry.events = eventsByEntry.get(entry.uid) ?? [];
    list.push(entry);
    entriesByParty.set(row.partyId, list);
  }

  const parties = partyRows
    .sort((a, b) => a.order - b.order)
    .map(({ order, ...party }) => ({ ...party, pokemon: entriesByParty.get(party.id) ?? [] }));

  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  return {
    statExpBackfillApplied: !!meta[META_BACKFILL],
    activePartyId: meta[META_ACTIVE_PARTY] ?? null,
    parties,
  };
}

/** @param {import('./index.js').Db} db @returns {Promise<any|null>} */
export async function readImportMarker(db) {
  return (await db.get('meta', META_IMPORTED)) ?? null;
}

/** @param {import('./index.js').Db} db @param {any} info */
export function writeImportMarker(db, info) {
  return db.put('meta', { key: META_IMPORTED, value: info });
}
