import { POWER_ITEMS, MACHO_BRACE_SPRITE, EXP_SHARE_SPRITE, VITAMINS, FEATHERS, FEATHER_BONUS, EV_BERRIES, EV_BERRY_REDUCTION, MACHO_BRACE_MULTIPLIER, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, STAT_EXP_VITAMIN_BONUS, STAT_EXP_VITAMIN_CEILING, STAT_LABEL } from '../../lib/constants.js';
import { sortByLabel } from '../../lib/utils.js';
import { store } from '../../lib/services.js';
import { POKERUS_ICON_SVG } from '../../lib/icons.js';
import { BaseDialog } from '../atoms/base-dialog.js';
import '../atoms/item-button-grid.js';
import '../atoms/ds-item-button.js';

/** @typedef {import('../lib/store.js').RosterEntry} RosterEntry */
/** @typedef {import('../lib/store.js').EvMap} EvMap */

// Sorted once — these tables are static, so re-sorting them on every
// render (this dialog's entire point while open) would be pure waste.
const SORTED_VITAMINS = sortByLabel(VITAMINS);
const SORTED_FEATHERS = sortByLabel(FEATHERS);
const SORTED_EV_BERRIES = sortByLabel(EV_BERRIES);

/**
 * <items-dialog> — a roster Pokémon's training-aids dialog: held
 * Training item/Macho Brace, Pokérus, Exp. Share, Vitamins, Wings and
 * EV-reducing berries. Extracted out of pokemon-detail.js (docs/
 * adr/0008's own note that it was still oversized even after
 * item-button-grid.js) — same "own dialog, own pending state, own
 * store calls" shape as iv-dialog.js/competitive-dialog.js.
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment
 * (mirrors pokemon-detail's own "rebuild is cheap" render, ADR
 * 0002 point 5), so every grid stays correct even while this dialog is
 * open and an unrelated store change (e.g. another party member's
 * Exp. Share-linked battle) fires a re-render. Call `open()` to seed a
 * fresh pending-edit session (docs/adr/0017: nothing commits to the
 * store until this dialog's own Save) and show it.
 */
export class ItemsDialog extends BaseDialog {
  constructor() {
    super('item-dialog', 'item-dialog-title');
    /** @type {RosterEntry|null} */
    this._entry = null;
    // Pending edits for this dialog session (docs/adr/0017) — null means
    // "no dialog session open". Held-item slot (Training item/Macho
    // Brace/Exp. Share — mutually exclusive), seeded from the entry when
    // `open()` is called, applied to the store only by Save.
    /** @type {{ powerItem: string|null, machoBrace: boolean, expShare: boolean }|null} */
    this._pendingHeldItem = null;
    // Every Vitamin/Wing/berry click queued this dialog session, in the
    // order clicked: [{ kind: 'vitamin'|'feather'|'berry', id }]. Nothing
    // is recorded in the store until Save replays this list through the
    // real store.useVitamin/useFeather/useBerry, in order — an ordered
    // list rather than a per-id count because whether a *later* click
    // still adds anything depends on every earlier one already queued
    // (the same stat's cap gets closer with each), so replay order has
    // to match click order exactly, for both the live "would this next
    // click still do anything" preview and the real Save.
    /** @type {{ kind: 'vitamin'|'feather'|'berry', id: string }[]} */
    this._pendingApplies = [];
    // Pokérus's own pending toggle state — null while no dialog session
    // is open, a real boolean once one is. Not folded into
    // `_pendingApplies`: it's a plain on/off flag, not a
    // repeatable/counted action.
    /** @type {boolean|null} */
    this._pendingPokerus = null;

    const shadow = /** @type {ShadowRoot} */ (this.shadowRoot);
    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .section-title {
        margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
        display: flex; align-items: center; gap: var(--space-2);
      }
      .help-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--lcd-line);
        background: var(--surface); color: var(--ink-soft); font-family: var(--font-mono);
        font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none;
        line-height: 1; padding: 0; flex: 0 0 auto; cursor: pointer;
      }
      .help-btn:hover, .help-btn:focus-visible { border-color: var(--teal); color: var(--teal); }
      .help-note {
        margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
        color: var(--ink-soft); background: var(--lcd);
        border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
        text-transform: none; letter-spacing: normal;
      }
      .vitamins, .wings, .berries { display: grid; gap: var(--space-2); }
      .pokerus-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
      .pokerus-icon { width: 22px; height: 22px; flex: 0 0 auto; display: inline-flex; color: var(--pokerus-purple); }
      .pokerus-icon svg { width: 100%; height: 100%; }
      .exp-share-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
      .pokerus-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
    `;
    shadow.appendChild(style);

    this.$title.textContent = 'Items';
    this.$body.innerHTML = `
      <section class="aids">
        <h3 class="section-title">Training item
          <button type="button" class="help-btn" aria-expanded="false" aria-label="What do training items do?" title="Held items that speed up EV gains from battling. The Macho Brace doubles every EV earned in battle for any stat. A Power item instead adds a flat bonus to one specific stat every battle, on top of whatever that battle normally gives.">?</button>
        </h3>
        <item-button-grid class="item-grid" columns="2"></item-button-grid>
      </section>

      <section class="pokerus-section">
        <h3 class="section-title">Pokérus
          <button type="button" class="help-btn" aria-expanded="false" aria-label="What is Pokérus?" title="A rare, harmless in-game virus. While infected, every EV your Pokémon earns from battling is doubled — pure bonus, no downside. It can also spread to other party members over time. Once it cures (after a few days), the ×2 EV bonus stays forever — no need to toggle this off.">?</button>
        </h3>
        <ds-item-button class="pokerus-toggle-btn" label="Pokérus" boost="×2 EVs">
          <span slot="icon" class="pokerus-icon" aria-hidden="true">${POKERUS_ICON_SVG}</span>
        </ds-item-button>
        <p class="pokerus-note" hidden>Pokérus doesn't double EVs in this game.</p>
      </section>

      <section class="exp-share-section">
        <h3 class="section-title">Exp. Share
          <button type="button" class="help-btn" aria-expanded="false" aria-label="What does Exp. Share do?" title="While holding an Exp. Share, this Pokémon also earns EVs whenever any other Pokémon in this party has a battle logged — the same base amount that Pokémon got, doubled by this Pokémon's own Pokérus if it has any. It never inherits the other Pokémon's held item bonus.">?</button>
        </h3>
        <ds-item-button class="exp-share-toggle-btn" icon="${EXP_SHARE_SPRITE}" label="Exp. Share" boost="Shares other EVs"></ds-item-button>
      </section>

      <section class="vitamins">
        <h3 class="section-title">Vitamins</h3>
        <item-button-grid class="vitamin-grid"></item-button-grid>
      </section>

      <section class="wings">
        <h3 class="section-title">Wings</h3>
        <item-button-grid class="wing-grid"></item-button-grid>
      </section>

      <section class="berries">
        <h3 class="section-title">EV-reducing berries</h3>
        <item-button-grid class="berry-grid"></item-button-grid>
      </section>
    `;
    this.$footer.innerHTML = `<button type="button" class="ds-btn ds-btn--primary item-dialog-save-btn">Save</button>`;
    this.$footer.hidden = false;

    this.$itemGrid = shadow.querySelector('.item-grid');
    this.$pokerusToggle = shadow.querySelector('.pokerus-toggle-btn');
    this.$pokerusNote = /** @type {HTMLElement} */ (shadow.querySelector('.pokerus-note'));
    this.$expShareToggle = shadow.querySelector('.exp-share-toggle-btn');
    this.$vitaminGrid = shadow.querySelector('.vitamin-grid');
    this.$wingsSection = /** @type {HTMLElement} */ (shadow.querySelector('.wings'));
    this.$wingGrid = shadow.querySelector('.wing-grid');
    this.$berriesSection = /** @type {HTMLElement} */ (shadow.querySelector('.berries'));
    this.$berryGrid = shadow.querySelector('.berry-grid');
    this.$saveBtn = shadow.querySelector('.item-dialog-save-btn');

    // The "?" help buttons toggle their explanation inline — several
    // live in this one dialog (Training item, Pokérus, Exp. Share).
    shadow.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('.help-btn');
      if (!btn) return;
      const anchor = btn.closest('.section-title');
      if (!anchor) return;
      const next = anchor.nextElementSibling;
      if (next?.classList.contains('help-note')) {
        next.remove();
        btn.setAttribute('aria-expanded', 'false');
      } else {
        const note = document.createElement('p');
        note.className = 'help-note';
        note.textContent = /** @type {HTMLElement} */ (btn).title;
        anchor.after(note);
        btn.setAttribute('aria-expanded', 'true');
      }
    });
    // Everything in this dialog only previews here (docs/adr/0017) —
    // Training item/Exp. Share write into `_pendingHeldItem`, Pokérus
    // into `_pendingPokerus`, Vitamins/Wings/berries queue into
    // `_pendingApplies`; all of it applies together only on Save.
    this.$itemGrid?.addEventListener('item-pick', (e) => {
      const val = /** @type {CustomEvent} */ (e).detail.id;
      const pending = /** @type {{ powerItem: string|null, machoBrace: boolean, expShare: boolean }} */ (this._pendingHeldItem);
      const selected = pending.machoBrace ? 'macho-brace' : pending.powerItem || '';
      if (val === selected) {
        pending.powerItem = null; // clicking the active item again clears it
        pending.machoBrace = false;
      } else if (val === 'macho-brace') {
        pending.machoBrace = true;
        pending.powerItem = null;
      } else {
        pending.powerItem = val;
        pending.machoBrace = false;
      }
      pending.expShare = false; // picking a training item vacates Exp. Share's slot too
      this._updateItemGrid();
    });
    this.$pokerusToggle?.addEventListener('pick', () => {
      this._pendingPokerus = !this.$pokerusToggle.hasAttribute('active');
      this.$pokerusToggle.toggleAttribute('active', this._pendingPokerus);
    });
    this.$expShareToggle?.addEventListener('pick', () => {
      const pending = /** @type {{ powerItem: string|null, machoBrace: boolean, expShare: boolean }} */ (this._pendingHeldItem);
      pending.expShare = !pending.expShare;
      if (pending.expShare) {
        pending.powerItem = null;
        pending.machoBrace = false;
      }
      this._updateItemGrid();
    });
    this.$saveBtn?.addEventListener('click', () => this._save());
    this.$vitaminGrid?.addEventListener('item-pick', (e) => this._queueVitamin(/** @type {CustomEvent} */ (e).detail.id));
    this.$wingGrid?.addEventListener('item-pick', (e) => this._queueFeather(/** @type {CustomEvent} */ (e).detail.id));
    this.$berryGrid?.addEventListener('item-pick', (e) => this._queueBerry(/** @type {CustomEvent} */ (e).detail.id));
  }

  /** @param {RosterEntry|null} e */
  set entry(e) {
    this._entry = e;
    if (!e) return;
    this._updateItemGrid();
    this._updateVitaminGrid(e);
    const wingsAvailable = store.wingsAvailable();
    this.$wingsSection.hidden = !wingsAvailable;
    if (wingsAvailable) this._updateWingGrid(e);
    const berriesAvailable = store.berriesAvailable();
    this.$berriesSection.hidden = !berriesAvailable;
    if (berriesAvailable) this._updateBerryGrid(e);
    this.$pokerusToggle.toggleAttribute('active', this._pendingPokerus ?? !!e.pokerus);
    const pokerusAvailable = store.pokerusAvailable();
    this.$pokerusToggle.toggleAttribute('disabled', !pokerusAvailable);
    this.$pokerusNote.hidden = pokerusAvailable;
  }
  get entry() {
    return this._entry;
  }

  /**
   * Seeds the held-item pending state from the entry (so a previous
   * session's discarded pick never leaks into a fresh one — same
   * reasoning as iv-dialog.js's own pending IVs, docs/adr/0017), clears
   * the queued Vitamin/Wing/berry list, refreshes every grid from that,
   * then opens.
   */
  open() {
    const e = /** @type {RosterEntry} */ (this._entry);
    this._pendingHeldItem = { powerItem: e.powerItem, machoBrace: e.machoBrace, expShare: e.expShare };
    this._pendingApplies = [];
    this._pendingPokerus = e.pokerus;
    this.$pokerusToggle.toggleAttribute('active', !!e.pokerus);
    this._updateItemGrid();
    this._updateVitaminGrid(e);
    this._updateWingGrid(e);
    this._updateBerryGrid(e);
    super.open();
  }

  _onClose() {
    // Discard any uncommitted picks/queue — harmless no-op if Save
    // already applied and closed.
    this._pendingHeldItem = null;
    this._pendingApplies = [];
    this._pendingPokerus = null;
  }

  /**
   * Applies everything staged in this dialog session, then closes: the
   * held-item choice (Training item, Macho Brace, or Exp. Share —
   * whichever ended up set), the Pokérus toggle, then every queued
   * Vitamin/Wing/berry click in the exact order it was queued
   * (`_simulatedEvs`'s own comment explains why order matters) —
   * replayed through the real store.useVitamin/useFeather/useBerry, so
   * the store's own capping logic is what actually runs, not the
   * preview math a second time. Everything shares one batchId so
   * ev-history-log.js collapses this Save into a single summarized
   * entry, same as the Level popup's.
   */
  _save() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const p = /** @type {{ powerItem: string|null, machoBrace: boolean, expShare: boolean }} */ (this._pendingHeldItem);
    const batchId = crypto.randomUUID();
    if (p.expShare) store.setExpShare(e.uid, true, batchId);
    else if (p.machoBrace) store.setMachoBrace(e.uid, true, batchId);
    else store.setPowerItem(e.uid, p.powerItem, batchId);
    store.setPokerus(e.uid, this._pendingPokerus, batchId);
    for (const item of this._pendingApplies) {
      if (item.kind === 'vitamin') store.useVitamin(e.uid, item.id, batchId);
      else if (item.kind === 'feather') store.useFeather(e.uid, item.id, batchId);
      else store.useBerry(e.uid, item.id, batchId);
    }
    this.close();
  }

  // Rebuilt on every render (not just once) because which items are even
  // offered — and the Power item bonus shown — depends on the entry's
  // party's game version, and this one component instance is reused
  // across different parties as the user navigates. Reads through
  // `_pendingHeldItem` while a dialog session is active (docs/adr/0017)
  // — falling back to the entry's actual committed values the rest of
  // the time (no session open, or an unrelated store change re-rendering
  // everything while it is) — so an in-progress pick survives a
  // re-render it didn't cause. Also drives the Exp. Share toggle's
  // `active` state, since it shares this same pending held-item slot.
  _updateItemGrid() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const bonus = store.powerItemBonus();
    const availability = store.trainingItemAvailability();
    const pending = this._pendingHeldItem || e;
    const selected = pending.machoBrace ? 'macho-brace' : pending.powerItem || '';
    this.$expShareToggle.toggleAttribute('active', !!pending.expShare);

    const offered = [];
    if (availability.machoBrace) {
      offered.push({
        id: 'macho-brace',
        label: 'Macho Brace',
        boost: `×${MACHO_BRACE_MULTIPLIER} all EVs`,
        sprite: MACHO_BRACE_SPRITE,
      });
    }
    if (availability.powerItems) {
      for (const p of POWER_ITEMS) {
        offered.push({
          id: p.id,
          label: p.label,
          boost: `+${bonus} ${STAT_LABEL[p.stat]}`,
          sprite: p.sprite,
        });
      }
    }
    this.$itemGrid.items = sortByLabel(offered).map((item) => ({
      ...item,
      title: `${item.label} — ${item.boost}`,
      active: item.id === selected,
    }));
  }

  /**
   * The entry's actual current EVs, folded forward through every
   * Vitamin/Wing/berry click queued so far this dialog session, in
   * click order — what Save would produce right now. Used both to
   * preview one more queued click (would it still add/remove anything)
   * and to label each button with what it would apply.
   * @returns {EvMap}
   */
  _simulatedEvs() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const evs = { ...e.evs };
    for (const item of this._pendingApplies) {
      const y = this._previewYield(item.kind, item.id, evs);
      if (!y) continue;
      if (item.kind === 'berry') evs[y.stat] -= y.applied;
      else {
        evs[y.stat] += y.applied;
        if (y.linkedStat) evs[y.linkedStat] += y.applied;
      }
    }
    return evs;
  }

  /** @param {'vitamin'|'feather'|'berry'} kind @param {string} id @param {EvMap} evs */
  _previewYield(kind, id, evs) {
    const uid = /** @type {RosterEntry} */ (this._entry).uid;
    if (kind === 'vitamin') return store.previewVitamin(uid, id, evs);
    if (kind === 'feather') return store.previewFeather(uid, id, evs);
    return store.previewBerry(uid, id, evs);
  }

  /**
   * Queues one vitamin click (docs/adr/0017) — nothing is recorded until
   * Save. No status line: the button itself already shows the queued
   * count (`_updateVitaminGrid`'s boost text) and disables outright once
   * another click genuinely couldn't add anything, so there's nothing a
   * separate line would say that isn't already visible on the button.
   */
  _queueVitamin(vitaminId) {
    const y = this._previewYield('vitamin', vitaminId, this._simulatedEvs());
    if (!y?.applied) return;
    this._pendingApplies.push({ kind: 'vitamin', id: vitaminId });
    this._updateQueuedGrids();
  }

  /** Queues one Wing click — see `_queueVitamin`'s own comment. */
  _queueFeather(featherId) {
    const y = this._previewYield('feather', featherId, this._simulatedEvs());
    if (!y?.applied) return;
    this._pendingApplies.push({ kind: 'feather', id: featherId });
    this._updateQueuedGrids();
  }

  /** Queues one EV-reducing berry click — see `_queueVitamin`'s own comment. */
  _queueBerry(berryId) {
    const y = this._previewYield('berry', berryId, this._simulatedEvs());
    if (!y?.applied) return;
    this._pendingApplies.push({ kind: 'berry', id: berryId });
    this._updateQueuedGrids();
  }

  /**
   * Refreshes every grid that reads through `_simulatedEvs()` — a click
   * in any one of Vitamins/Wings/berries can change what's still room
   * for in any *other* one too (they all draw from the same running EV
   * total), so queuing in one must re-check every one of them, not just
   * the grid the click happened in.
   */
  _updateQueuedGrids() {
    const e = /** @type {RosterEntry} */ (this._entry);
    this._updateVitaminGrid(e);
    this._updateWingGrid(e);
    this._updateBerryGrid(e);
  }

  // Same template as the training item buttons — sprite, name, and the
  // stat it feeds in a lighter line underneath — so there's no need to
  // remember which vitamin maps to which stat. Marks a button dim (and,
  // unlike a plain "capped" visual, genuinely unclickable — see
  // item-button-grid.js's own comment) once queuing another click
  // wouldn't add anything — the Gen III-VII 100-EV vitamin cutoff, the
  // Gen I-II 25,600-Stat-Experience ceiling, the stat's own cap, or (with
  // enough already queued this session) the running total from
  // `_simulatedEvs` hitting one of those first. Also badges each button
  // with how many times it's already been fed (history, permanent) and,
  // separately, how many are queued this session (`_pendingApplies`,
  // discarded if the dialog closes without Save) — the two are deliberately
  // shown apart so "already happened" and "about to happen on Save" are
  // never confused for one number. On Gen I, Zinc is dropped entirely —
  // Special hasn't split into SpA/SpD yet.
  _updateVitaminGrid(e) {
    const statExp = store.usesStatExpSystem();
    const mergedSpecial = store.specialStatMerged();
    const cutoffApplies = !statExp && store.vitaminCutoffApplies();
    const bonus = statExp ? STAT_EXP_VITAMIN_BONUS : VITAMIN_BONUS;
    const statCap = store.statCap();
    const simEvs = this._simulatedEvs();
    this.$vitaminGrid.items = SORTED_VITAMINS.filter((v) => !(mergedSpecial && v.id === 'zinc')).map((v) => {
      const statLabel = mergedSpecial && v.stat === 'spa' ? 'SPC' : STAT_LABEL[v.stat];
      const stat = simEvs[v.stat];
      const cappedByCutoff = cutoffApplies && stat >= VITAMIN_STAT_CUTOFF;
      const cappedByStatCap = stat >= statCap;
      const cappedByCeiling = statExp && stat >= STAT_EXP_VITAMIN_CEILING;
      const capped = cappedByCutoff || cappedByCeiling || cappedByStatCap;
      const cappedReason = cappedByCutoff
        ? `This game stops vitamins once ${statLabel} has ${VITAMIN_STAT_CUTOFF}+ EVs`
        : cappedByCeiling
          ? `Vitamins stop working once ${statLabel} has ${STAT_EXP_VITAMIN_CEILING}+ Stat Experience`
          : `${statLabel} is already at the ${statCap} cap`;
      return this._buildItemGridRow(e, 'vitamin', v, {
        capped,
        cappedReason,
        activeText: `Feed ${v.label} — raises ${statLabel} by up to ${bonus}`,
        boostText: `+${bonus} ${statLabel}`,
      });
    });
  }

  // Same shape as vitamins, minus the 100-EV-cutoff framing — Wings
  // never have one. See `_updateVitaminGrid`'s own comment for the
  // simulated-EVs/queued-count/disabled reasoning, shared here.
  _updateWingGrid(e) {
    const statCap = store.statCap();
    const simEvs = this._simulatedEvs();
    this.$wingGrid.items = SORTED_FEATHERS.map((f) => {
      const stat = simEvs[f.stat];
      const capped = stat >= statCap;
      return this._buildItemGridRow(e, 'feather', f, {
        capped,
        cappedReason: `${STAT_LABEL[f.stat]} is already at the ${statCap} cap`,
        activeText: `Feed ${f.label} — raises ${STAT_LABEL[f.stat]} EVs by ${FEATHER_BONUS}`,
        boostText: `+${FEATHER_BONUS} ${STAT_LABEL[f.stat]}`,
      });
    });
  }

  // Mirrors _updateWingGrid, but "capped" here means nothing left to
  // remove (the stat is already at 0) rather than at the ceiling, and
  // the boost reads as a reduction — these subtract EVs rather than add
  // them.
  _updateBerryGrid(e) {
    const simEvs = this._simulatedEvs();
    this.$berryGrid.items = SORTED_EV_BERRIES.map((b) => {
      const stat = simEvs[b.stat];
      const capped = stat <= 0;
      return this._buildItemGridRow(e, 'berry', b, {
        capped,
        cappedReason: `${STAT_LABEL[b.stat]} is already at 0`,
        activeText: `Feed ${b.label} — removes up to ${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]} EVs`,
        boostText: `−${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]}`,
      });
    });
  }

  // Shared shape behind _updateVitaminGrid/_updateWingGrid/_updateBerryGrid:
  // each grid differs only in its cap rule and its wording (computed by the
  // caller above and passed in), but all three feed the same fed-count
  // (permanent, from history) / pending-count (queued this session, from
  // `_pendingApplies`) / disabled-when-capped row shape into <item-button-grid>.
  // `kind` is the history/pending-apply discriminator ('vitamin'/'feather'/
  // 'berry'); history entries key the target id as `${kind}Id`.
  _buildItemGridRow(e, kind, item, { capped, cappedReason, activeText, boostText }) {
    const fedCount = e.history.filter((h) => h.kind === kind && h[`${kind}Id`] === item.id).length;
    const pendingCount = this._pendingApplies.filter((p) => p.kind === kind && p.id === item.id).length;
    const fedNote = fedCount ? ` — fed ${fedCount}×` : '';
    const pendingNote = pendingCount ? ` — ${pendingCount}× queued` : '';
    const title = (capped ? cappedReason : activeText) + fedNote + pendingNote;
    const boost = pendingCount ? `${boostText} · ${pendingCount}× queued` : boostText;
    return { id: item.id, label: item.label, sprite: item.sprite, boost, title, capped, disabled: capped, count: fedCount };
  }
}
customElements.define('items-dialog', ItemsDialog);
