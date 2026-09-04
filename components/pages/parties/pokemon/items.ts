import { POWER_ITEMS, MACHO_BRACE_SPRITE, EXP_SHARE_SPRITE, VITAMINS, FEATHERS, FEATHER_BONUS, EV_BERRIES, EV_BERRY_REDUCTION, MACHO_BRACE_MULTIPLIER, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, STAT_EXP_VITAMIN_BONUS, STAT_EXP_VITAMIN_CEILING, STAT_LABEL } from '../../../../lib/constants.ts';
import { sortByLabel } from '../../../../lib/utils.ts';
import { store } from '../../../../lib/services.ts';
import { POKERUS_ICON_SVG } from '../../../../lib/icons.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import '../../../atoms/item-button-grid.ts';
import '../../../atoms/ds-item-button.ts';
import type { RosterEntry, EvMap, StatKey } from '../../../../lib/store.ts';
import type { StatItem } from '../../../../lib/constants.ts';
import type { ItemButtonGrid, ItemButtonSpec } from '../../../atoms/item-button-grid.ts';
import type { DsItemButton } from '../../../atoms/ds-item-button.ts';

// Sorted once — these tables are static, so re-sorting them on every
// render (this dialog's entire point while open) would be pure waste.
const SORTED_VITAMINS = sortByLabel(VITAMINS);
const SORTED_FEATHERS = sortByLabel(FEATHERS);
const SORTED_EV_BERRIES = sortByLabel(EV_BERRIES);

type HeldItemPending = { powerItem: string | null; machoBrace: boolean; expShare: boolean };
type Apply = { kind: 'vitamin' | 'feather' | 'berry'; id: string };

/**
 * <items-dialog> — a roster Pokémon's training-aids dialog: held
 * Training item/Macho Brace, Pokérus, Exp. Share, Vitamins, Wings and
 * EV-reducing berries. Extracted out of pokemon-detail.js (docs/
 * adr/0008's own note that it was still oversized even after
 * item-button-grid.js) — same "own dialog, own pending state, own
 * store calls" shape as ivs.js/competitive.js.
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment.
 * Call `open()` to seed a fresh pending-edit session (docs/adr/0017:
 * nothing commits to the store until this dialog's own Save) and show it.
 *
 * Routed under "#/parties/<slug>/<uid>/items" (docs/adr/0023) — still
 * instantiated and owned by pokemon-detail.js's own shadow DOM, same as
 * before; the route only decides when `open()`/`close()` get called.
 */
export class ItemsDialog extends BaseDialog {
  _entry: RosterEntry | null = null;
  // Pending edits for this dialog session (docs/adr/0017) — null means
  // "no dialog session open". Held-item slot (Training item/Macho
  // Brace/Exp. Share — mutually exclusive), seeded from the entry.
  _pendingHeldItem: HeldItemPending | null = null;
  // Every Vitamin/Wing/berry click queued this dialog session, in the
  // order clicked. Nothing is recorded in the store until Save replays
  // this list through store.useVitamin/useFeather/useBerry, in order.
  _pendingApplies: Apply[] = [];
  // Pokérus's own pending toggle state — null while no dialog session
  // is open, a real boolean once one is.
  _pendingPokerus: boolean | null = null;
  $aidsSection: HTMLElement;
  $itemGrid: ItemButtonGrid;
  $pokerusToggle: DsItemButton;
  $expShareToggle: DsItemButton;
  $vitaminGrid: ItemButtonGrid;
  $wingsSection: HTMLElement;
  $wingGrid: ItemButtonGrid;
  $berriesSection: HTMLElement;
  $berryGrid: ItemButtonGrid;
  $saveBtn: HTMLButtonElement | null;

  constructor() {
    super('item-dialog', 'item-dialog-title');

    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .section-title {
        margin: 0; font-size: var(--font-size-2xs);
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
        display: flex; align-items: center; gap: var(--space-2);
      }
      .help-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--lcd-line);
        background: var(--surface); color: var(--ink-soft);
        font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none;
        line-height: 1; padding: 0; flex: 0 0 auto; cursor: pointer;
      }
      .help-btn:hover, .help-btn:focus-visible { border-color: var(--teal); color: var(--teal); }
      .help-note {
        margin: 0; font-size: var(--font-size-2xs);
        color: var(--ink-soft); background: var(--lcd);
        border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
        text-transform: none; letter-spacing: normal;
      }
      .vitamins, .wings, .berries { display: grid; gap: var(--space-2); }
      .toggle-row, .vitamins, .wings, .berries { margin-top: var(--space-4); }
      .aids[hidden] + .toggle-row { margin-top: 0; }
      .toggle-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); align-items: start; }
      .pokerus-section, .exp-share-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
      .pokerus-icon { width: 22px; height: 22px; flex: 0 0 auto; display: inline-flex; color: var(--pokerus-purple); }
      .pokerus-icon svg { width: 100%; height: 100%; }
    `;
    this.shadow.appendChild(style);

    this.$title.textContent = 'Items';
    this.$body.innerHTML = `
      <section class="aids">
        <h3 class="section-title">Training item
          <button type="button" class="help-btn" aria-expanded="false" aria-label="What do training items do?" title="Held items that speed up EV gains from battling. The Macho Brace doubles every EV earned in battle for any stat. A Power item instead adds a flat bonus to one specific stat every battle, on top of whatever that battle normally gives.">?</button>
        </h3>
        <item-button-grid class="item-grid" columns="2"></item-button-grid>
      </section>

      <div class="toggle-row">
        <section class="pokerus-section">
          <h3 class="section-title">Pokérus
            <button type="button" class="help-btn" aria-expanded="false" aria-label="What is Pokérus?" title="A rare, harmless in-game virus. While infected, every EV your Pokémon earns from battling is doubled — pure bonus, no downside. It can also spread to other party members over time. Once it cures (after a few days), the ×2 EV bonus stays forever — no need to toggle this off.">?</button>
          </h3>
          <ds-item-button class="pokerus-toggle-btn" label="Pokérus" boost="×2 EVs">
            <span slot="icon" class="pokerus-icon" aria-hidden="true">${POKERUS_ICON_SVG}</span>
          </ds-item-button>
        </section>

        <section class="exp-share-section">
          <h3 class="section-title">Exp. Share
            <button type="button" class="help-btn" aria-expanded="false" aria-label="What does Exp. Share do?" title="While holding an Exp. Share, this Pokémon also earns EVs whenever any other Pokémon in this party has a battle logged — the same base amount that Pokémon got, doubled by this Pokémon's own Pokérus if it has any. It never inherits the other Pokémon's held item bonus.">?</button>
          </h3>
          <ds-item-button class="exp-share-toggle-btn" icon="${EXP_SHARE_SPRITE}" label="Exp. Share" boost="Shares other EVs"></ds-item-button>
        </section>
      </div>

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

    this.$aidsSection = this.shadow.querySelector<HTMLElement>('.aids')!;
    this.$itemGrid = this.shadow.querySelector<ItemButtonGrid>('.item-grid')!;
    this.$pokerusToggle = this.shadow.querySelector<DsItemButton>('.pokerus-toggle-btn')!;
    this.$expShareToggle = this.shadow.querySelector<DsItemButton>('.exp-share-toggle-btn')!;
    this.$vitaminGrid = this.shadow.querySelector<ItemButtonGrid>('.vitamin-grid')!;
    this.$wingsSection = this.shadow.querySelector<HTMLElement>('.wings')!;
    this.$wingGrid = this.shadow.querySelector<ItemButtonGrid>('.wing-grid')!;
    this.$berriesSection = this.shadow.querySelector<HTMLElement>('.berries')!;
    this.$berryGrid = this.shadow.querySelector<ItemButtonGrid>('.berry-grid')!;
    this.$saveBtn = this.shadow.querySelector<HTMLButtonElement>('.item-dialog-save-btn');

    // The "?" help buttons toggle their explanation inline.
    this.shadow.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.help-btn');
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
        note.textContent = btn.title;
        anchor.after(note);
        btn.setAttribute('aria-expanded', 'true');
      }
    });
    // Everything in this dialog only previews here (docs/adr/0017).
    this.$itemGrid?.addEventListener('item-pick', (e) => {
      const val = (e as CustomEvent).detail.id;
      const pending = this._pendingHeldItem as HeldItemPending;
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
      const pending = this._pendingHeldItem as HeldItemPending;
      pending.expShare = !pending.expShare;
      if (pending.expShare) {
        pending.powerItem = null;
        pending.machoBrace = false;
      }
      this._updateItemGrid();
    });
    this.$saveBtn?.addEventListener('click', () => this._save());
    this.$vitaminGrid?.addEventListener('item-pick', (e) => this._queueVitamin((e as CustomEvent).detail.id));
    this.$wingGrid?.addEventListener('item-pick', (e) => this._queueFeather((e as CustomEvent).detail.id));
    this.$berryGrid?.addEventListener('item-pick', (e) => this._queueBerry((e as CustomEvent).detail.id));
  }

  set entry(e: RosterEntry | null) {
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
    // When the game has no Pokérus, say so on the button's own sub-line
    // instead of a separate note underneath it.
    this.$pokerusToggle.setAttribute('boost', pokerusAvailable ? '×2 EVs' : 'Not in this game');
  }
  get entry(): RosterEntry | null {
    return this._entry;
  }

  /**
   * Seeds the held-item pending state from the entry (so a previous
   * session's discarded pick never leaks into a fresh one — docs/adr/0017),
   * clears the queued Vitamin/Wing/berry list, refreshes every grid from
   * that, then opens.
   */
  open(): void {
    const e = this._entry as RosterEntry;
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

  _onClose(): void {
    this._pendingHeldItem = null;
    this._pendingApplies = [];
    this._pendingPokerus = null;
  }

  /**
   * Applies everything staged in this dialog session, then closes: the
   * held-item choice, the Pokérus toggle, then every queued Vitamin/Wing/
   * berry click in the exact order it was queued — replayed through the
   * real store.useVitamin/useFeather/useBerry, so the store's own
   * capping logic is what actually runs. Everything shares one batchId.
   */
  _save(): void {
    const e = this._entry as RosterEntry;
    const p = this._pendingHeldItem as HeldItemPending;
    const batchId = crypto.randomUUID();
    if (p.expShare) store.setExpShare(e.uid, true, batchId);
    else if (p.machoBrace) store.setMachoBrace(e.uid, true, batchId);
    else {
      // Clear the Exp. Share explicitly rather than leaning on
      // setPowerItem's tail call (GitHub issue #39).
      store.setPowerItem(e.uid, p.powerItem, batchId);
      store.setExpShare(e.uid, false, batchId);
    }
    store.setPokerus(e.uid, !!this._pendingPokerus, batchId);
    for (const item of this._pendingApplies) {
      if (item.kind === 'vitamin') store.useVitamin(e.uid, item.id, batchId);
      else if (item.kind === 'feather') store.useFeather(e.uid, item.id, batchId);
      else store.useBerry(e.uid, item.id, batchId);
    }
    this.close();
  }

  // Rebuilt on every render because which items are offered — and the
  // Power item bonus shown — depends on the entry's party's game version.
  // Reads through `_pendingHeldItem` while a dialog session is active
  // (docs/adr/0017), falling back to the entry's actual committed values
  // otherwise. Also drives the Exp. Share toggle's `active` state.
  _updateItemGrid(): void {
    const e = this._entry as RosterEntry;
    const bonus = store.powerItemBonus();
    const availability = store.trainingItemAvailability();
    // Gen I/II have no held-item training aids at all — hide the section.
    this.$aidsSection.hidden = !availability.machoBrace && !availability.powerItems;
    const pending: HeldItemPending | RosterEntry = this._pendingHeldItem || e;
    const selected = pending.machoBrace ? 'macho-brace' : pending.powerItem || '';
    this.$expShareToggle.toggleAttribute('active', !!pending.expShare);

    const offered: { id: string; label: string; boost: string; sprite: string }[] = [];
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
   * click order — what Save would produce right now.
   */
  _simulatedEvs(): EvMap {
    const e = this._entry as RosterEntry;
    const evs = { ...e.evs };
    for (const item of this._pendingApplies) {
      const y = this._previewYield(item.kind, item.id, evs);
      if (!y) continue;
      if (item.kind === 'berry') evs[y.stat] -= y.applied;
      else {
        evs[y.stat] += y.applied;
        const linked = (y as { linkedStat?: StatKey | null }).linkedStat;
        if (linked) evs[linked] += y.applied;
      }
    }
    return evs;
  }

  _previewYield(kind: 'vitamin' | 'feather' | 'berry', id: string, evs: EvMap) {
    const uid = (this._entry as RosterEntry).uid;
    if (kind === 'vitamin') return store.previewVitamin(uid, id, evs);
    if (kind === 'feather') return store.previewFeather(uid, id, evs);
    return store.previewBerry(uid, id, evs);
  }

  /** Queues one vitamin click (docs/adr/0017) — nothing is recorded until Save. */
  _queueVitamin(vitaminId: string): void {
    const y = this._previewYield('vitamin', vitaminId, this._simulatedEvs());
    if (!y?.applied) return;
    this._pendingApplies.push({ kind: 'vitamin', id: vitaminId });
    this._updateQueuedGrids();
  }

  /** Queues one Wing click — see `_queueVitamin`'s own comment. */
  _queueFeather(featherId: string): void {
    const y = this._previewYield('feather', featherId, this._simulatedEvs());
    if (!y?.applied) return;
    this._pendingApplies.push({ kind: 'feather', id: featherId });
    this._updateQueuedGrids();
  }

  /** Queues one EV-reducing berry click — see `_queueVitamin`'s own comment. */
  _queueBerry(berryId: string): void {
    const y = this._previewYield('berry', berryId, this._simulatedEvs());
    if (!y?.applied) return;
    this._pendingApplies.push({ kind: 'berry', id: berryId });
    this._updateQueuedGrids();
  }

  /**
   * Refreshes every grid that reads through `_simulatedEvs()` — a click
   * in any one of Vitamins/Wings/berries can change what's still room
   * for in any *other* one too (they all draw from the same running EV
   * total).
   */
  _updateQueuedGrids(): void {
    const e = this._entry as RosterEntry;
    this._updateVitaminGrid(e);
    this._updateWingGrid(e);
    this._updateBerryGrid(e);
  }

  _updateVitaminGrid(e: RosterEntry): void {
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

  _updateWingGrid(e: RosterEntry): void {
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

  _updateBerryGrid(e: RosterEntry): void {
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
  // each grid differs only in its cap rule and its wording, but all three
  // feed the same fed-count / pending-count / disabled-when-capped row
  // shape into <item-button-grid>. `kind` is the history/pending-apply
  // discriminator; history entries key the target id as `${kind}Id`.
  _buildItemGridRow(
    e: RosterEntry,
    kind: 'vitamin' | 'feather' | 'berry',
    item: StatItem,
    { capped, cappedReason, activeText, boostText }: { capped: boolean; cappedReason: string; activeText: string; boostText: string }
  ): ItemButtonSpec {
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
