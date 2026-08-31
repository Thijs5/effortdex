import { POWER_ITEMS, MACHO_BRACE_SPRITE, EXP_SHARE_SPRITE, NATURES, STATS, STAT_LABEL, MACHO_BRACE_MULTIPLIER, FALLBACK_SPRITE, FALLBACK_ONERROR } from '../../lib/constants.js';
import { titleCase, natureEffectHint, dayLabel } from '../../lib/utils.js';
import { api, store } from '../../lib/services.js';
import { versionedSpriteUrl, versionedSpriteIsOpaque } from '../../lib/pokeapi-client.js';
import { availableSpeciesFor } from '../../lib/species-availability.js';
import { attachDesignSystem } from '../../lib/design-system.js';
import { wireSpriteFallback } from '../../lib/sprite-fallback.js';
import { wireDisclosureMenu } from '../../lib/dom.js';
import * as router from '../../lib/router.js';
import '../molecules/ev-summary.js';
import './ev-history-log.js';
import './pokemon-search.js';
import '../pages/parties/pokemon/nature.js';
import '../pages/parties/pokemon/level.js';
import '../pages/parties/pokemon/ivs.js';
import '../pages/parties/pokemon/items.js';
import '../pages/parties/pokemon/competitive.js';
import '../pages/parties/pokemon/training-guide.js';

/**
 * <pokemon-detail> — a roster Pokémon's full detail page: identity,
 * EV bars, training aids (power item / Pokérus), evolution
 * (<evolution-chain>), a battle search (picking a result logs the battle
 * immediately) and a history log (<ev-history-log>). Set `.entry` to a
 * Store roster entry; it re-renders on assignment. Meant to be mounted
 * one at a time, full width.
 */
export class PokemonDetail extends HTMLElement {
  constructor() {
    super();
    this._entry = null;
    this._allowedSpeciesToken = 0;
    // The Nature dialog's own preview-then-Save state (docs/adr/0017)
    // lives directly on its <select> value — no separate pending field
    // needed. IVs/Items/Competitive each own their own dialog and pending
    // state now (iv-dialog.js/items-dialog.js/competitive-dialog.js,
    // extracted per docs/adr/0008's note that this file was still
    // oversized even after item-button-grid.js).

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          display: grid;
          gap: var(--space-4);
          position: relative;
        }

        /* Sprite anchors the left edge across every row; all text and
           badges share one column beside it, so the header has a single
           left alignment line instead of three competing ones. Item/
           Pokérus status now lives inline in .meta next to the level
           button rather than owning its own row. */
        header {
          display: grid; grid-template-columns: 64px 1fr auto;
          grid-template-areas: "sprite titles more";
          align-items: center; column-gap: var(--space-4); row-gap: 0;
          padding-bottom: var(--space-4);
          border-bottom: 1px dashed var(--lcd-line);
        }
        .sprite-frame {
          grid-area: sprite; align-self: start;
          position: relative; width: 64px; height: 64px;
          display: inline-flex;
        }
        .sprite {
          width: 100%; height: 100%; image-rendering: pixelated; object-fit: contain;
        }
        /* Gen I/II sprites are an opaque white bitmap (no alpha) — round
           its corners and sit it on the sprite chip so it doesn't read as
           a hard white rectangle. Every other gen is a transparent PNG
           and gets neither: it floats on the page. */
        .sprite-frame--opaque .sprite {
          background: var(--sprite-bg); border-radius: var(--radius-sm);
        }

        /* Fully trained (at the 510 EV cap): a soft gold halo, subtly
           pulsing — the achievement reads at a glance without a text
           badge taking up header space. drop-shadow reads the sprite's
           alpha, so on a transparent PNG the halo hugs the silhouette;
           the opaque Gen I/II bitmap would just outline its rectangle, so
           that variant gets a box-shadow ring on the rounded chip
           instead — same colour, same pulse rhythm, different shape. */
        :host([fully-trained]) .sprite {
          animation: sprite-glow-pulse 2.8s ease-in-out infinite;
        }
        :host([fully-trained]) .sprite-frame--opaque .sprite {
          animation: sprite-glow-pulse-box 2.8s ease-in-out infinite;
        }
        @keyframes sprite-glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 1px var(--sprite-glow)) drop-shadow(0 0 3px var(--sprite-glow)); }
          50%      { filter: drop-shadow(0 0 3px var(--sprite-glow)) drop-shadow(0 0 7px var(--sprite-glow)); }
        }
        @keyframes sprite-glow-pulse-box {
          0%, 100% { box-shadow: 0 0 0 2px var(--sprite-glow), 0 0 5px 0 var(--sprite-glow-soft); }
          50%      { box-shadow: 0 0 0 2px var(--sprite-glow), 0 0 12px 2px var(--sprite-glow-soft); }
        }
        @media (prefers-reduced-motion: reduce) {
          :host([fully-trained]) .sprite {
            animation: none;
            filter: drop-shadow(0 0 2px var(--sprite-glow)) drop-shadow(0 0 5px var(--sprite-glow));
          }
          :host([fully-trained]) .sprite-frame--opaque .sprite {
            filter: none;
            box-shadow: 0 0 0 2px var(--sprite-glow), 0 0 9px 1px var(--sprite-glow-soft);
          }
        }

        /* Pokérus: a small "PKRS" tag on the sprite's lower edge, echoing
           the marker the games show on the summary screen. pokemon.js
           only toggles [pokerus-infected] for parties whose generation
           actually has Pokérus (Gen II+, minus a few later titles). */
        .sprite-pkrs {
          position: absolute; left: 50%; bottom: -3px; transform: translateX(-50%);
          display: none; padding: 1px 4px; border-radius: var(--radius-pill);
          background: var(--pokerus-purple); color: var(--on-pokerus);
          font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700;
          letter-spacing: 0.08em; line-height: 1.35; white-space: nowrap;
          pointer-events: none;
        }
        :host([pokerus-infected]) .sprite-pkrs { display: block; }
        /* "#169 Adamant Slowpoke": Dex number, then nature (the games'
           own phrasing), then the editable name — one line, one glance.
           Both prefixes are softer weight/color than the editable name
           so the three parts stay visually distinct. */
        .name-row { display: flex; align-items: baseline; gap: 0.45em; min-width: 0; }
        .species-num {
          font-family: var(--font-mono); font-size: var(--font-size-xs);
          color: var(--ink-soft); white-space: nowrap;
        }
        /* Styled as a sentence fragment ("Adamant"), not a pill badge —
           unlike .held-item-btn, this sits inline in the title row
           ("#169 Adamant Slowpoke"), so it needs to read as part of that
           sentence rather than as chrome. Still a real <button> (opens
           .nature-dialog); the empty state shows "Set nature" instead of
           nothing, so there's always something to tap. */
        .nature-btn {
          font-family: var(--font-display); font-weight: 500; font-size: var(--font-size-input);
          color: var(--ink-soft); white-space: nowrap; border: none; background: none;
          padding: 0; cursor: pointer;
        }
        .nature-btn:hover { color: var(--teal); }
        .nature-btn--empty { font-size: var(--font-size-xs); font-style: italic; }
        /* At least as tall as the sprite and top-aligned with it, so the
           name sits level with the sprite's top edge instead of floating
           in a taller, vertically-centered box — min-height, not a fixed
           height, so a long held-item label wrapping .meta onto a second
           line grows this box instead of overflowing past its bottom
           edge into the divider/content below it. */
        .titles {
          grid-area: titles; align-self: start; min-width: 0;
          min-height: 64px; display: flex; flex-direction: column; justify-content: space-between;
        }
        .nickname {
          display: block; flex: 1 1 auto; min-width: 0; width: auto; border: none; background: transparent;
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-input);
          padding: 0; color: var(--ink);
        }
        .nickname:focus-visible { outline: 2px solid var(--teal); border-radius: var(--radius-sm); }
        .meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .species {
          font-family: var(--font-mono); font-size: var(--font-size-xs);
          color: var(--ink-soft); text-transform: capitalize;
        }
        .level-up-btn {
          display: inline-flex; align-items: center; gap: 0.3em;
          border: 1px solid var(--lcd-line); background: var(--surface); cursor: pointer;
          border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: var(--font-size-xs);
          color: var(--ink-soft); padding: 0.2em 0.6em; min-height: 30px; touch-action: manipulation;
        }
        .level-up-btn:hover { color: var(--teal); border-color: var(--teal); }
        .level-up-btn svg { width: 11px; height: 11px; color: var(--teal); }
        .more-btn-wrap { grid-area: more; align-self: start; position: relative; }
        .more-btn { display: inline-flex; align-items: center; gap: 0.3em; white-space: nowrap; }
        .more-btn svg { width: 14px; height: 14px; }
        /* The number+nature prefix (added ahead of the editable name)
           leaves less room for a long nickname on a phone-width card —
           drop the "More" label and keep just its icon, freeing that
           width back up. */
        @media (max-width: 420px) {
          .more-btn-label { display: none; }
        }

        /* Mirrors the app-shell header menu (styles.css's .header-menu)
           — same look, reimplemented locally since shadow DOM can't
           reach that light-DOM stylesheet's rules. */
        .more-menu {
          position: absolute; top: calc(100% + 8px); right: 0; z-index: 50;
          min-width: 180px; display: grid; gap: 2px; padding: var(--space-2);
          background: var(--surface); color: var(--ink); border: 1px solid var(--lcd-line);
          border-radius: var(--radius-md); box-shadow: var(--shadow-suggestions);
        }
        .more-menu[hidden] { display: none; }
        .more-menu-item {
          display: flex; align-items: center; width: 100%; padding: var(--space-2) var(--space-3);
          border: none; border-radius: var(--radius-sm); background: transparent;
          text-align: left; font-size: var(--font-size-md); color: inherit; cursor: pointer;
        }
        .more-menu-item:hover { background: var(--lcd); }
        /* Remove used to be its own bordered "Release" button at the
           bottom of a long dialog — now it's just a menu entry, gated on
           its own native confirm() (docs/adr/0017), so the red styling
           that used to signal "careful" moves here instead. */
        .more-menu-item--danger { color: var(--poke-red-dark); }
        .more-menu-item--danger:hover { background: var(--danger-soft); color: var(--poke-red); }

        .status-pill {
          display: inline-flex; align-items: center; gap: 0.35em;
          text-transform: none; letter-spacing: normal; padding: 0.3em 0.65em;
        }
        .status-pill img { width: 16px; height: 16px; object-fit: contain; image-rendering: pixelated; }
        /* Two classes (not one) so this reliably beats the shared
           .ds-pill-badge gold default at equal specificity. */
        .status-pill.status-pill--item { background: var(--teal-soft); color: var(--teal); }
        /* No item held: a dashed outline instead of a filled pill, so
           "nothing selected" reads as visibly different from an actual
           status rather than just a quieter version of one. */
        .status-pill.status-pill--empty {
          background: transparent; color: var(--ink-soft);
          border: 1px dashed var(--lcd-line);
        }
        .held-item-btn { border: none; cursor: pointer; font-family: inherit; }
        .held-item-btn:hover { filter: brightness(0.97); }
        /* .status-pill--empty's background is transparent, so the filter
           above has nothing to darken — give the dashed/no-item state its
           own visible hover instead of silently doing nothing. */
        .held-item-btn.status-pill--empty:hover { background: var(--lcd); filter: none; }

        .card-body { display: grid; gap: var(--space-5); }
        .card-col { display: grid; gap: var(--space-4); align-content: start; max-width: 360px; }

        /* Log a battle moved off the page and behind this FAB (issue #17):
           it's the single most repeated action here, so it stays reachable
           from anywhere on a page that can now run long (history log fills
           the rest of the width) instead of scrolling out of view with the
           rest of card-body. Fixed to the viewport, not the card, on
           purpose — sticky would still leave it behind once the card's own
           box ends. */
        /* Cleared above index.html's own .bezel-footer (~66px tall), which
           sits at the true viewport bottom on any page shorter than the
           viewport — the same corner a fixed FAB would otherwise land on
           top of. */
        .battle-fab {
          position: fixed; right: var(--space-4); bottom: calc(66px + var(--space-4)); z-index: 5;
          display: inline-flex; align-items: center; gap: var(--space-2);
          box-shadow: 0 3px 0 var(--poke-red-dark), var(--shadow-panel);
        }
        .battle-fab svg { width: 18px; height: 18px; flex: 0 0 auto; }

        .section-title {
          margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
          display: flex; align-items: center; gap: var(--space-2);
        }
        .sheet-exp-share-note {
          margin: 0; font-size: var(--font-size-xs); color: var(--ink-soft);
        }

        .battle-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--poke-red-dark); min-height: 1em; }
      </style>
      <article class="card">
        <header>
          <span class="sprite-frame">
            <img class="sprite" alt="" />
            <span class="sprite-pkrs" aria-hidden="true">PKRS</span>
          </span>
          <div class="titles">
            <div class="name-row">
              <span class="species-num"></span>
              <button class="nature-btn" type="button" title="Nature" hidden></button>
              <input class="nickname" aria-label="Nickname" />
            </div>
            <div class="meta">
              <span class="species" hidden></span>
              <button class="level-up-btn" type="button" title="Set level">
                <span class="level-value"></span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
              </button>
              <button class="held-item-btn ds-pill-badge status-pill" type="button" title="Held item" hidden>
                <img class="held-item-btn-sprite" alt="" hidden ${FALLBACK_ONERROR} />
                <span class="held-item-btn-label"></span>
              </button>
            </div>
          </div>
          <div class="more-btn-wrap">
            <button class="more-btn ds-btn ds-btn--outline ds-btn--sm" type="button" title="More" aria-label="More" aria-haspopup="menu" aria-expanded="false">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="17.5" r="1.7"/></svg>
              <span class="more-btn-label">More</span>
            </button>
            <div class="more-menu" role="menu" aria-label="More" hidden>
              <button class="more-menu-item" type="button" role="menuitem" data-open="ivs">IVs</button>
              <button class="more-menu-item" type="button" role="menuitem" data-open="competitive">Competitive</button>
              <button class="more-menu-item training-guide-menu-item" type="button" role="menuitem" data-open="training-guide" hidden>Where to train</button>
              <button class="more-menu-item more-menu-item--danger" type="button" role="menuitem" data-action="remove">Remove</button>
            </div>
          </div>
        </header>

        <nature-dialog></nature-dialog>
        <level-up-dialog></level-up-dialog>
        <items-dialog></items-dialog>
        <iv-dialog></iv-dialog>
        <competitive-dialog></competitive-dialog>
        <training-guide-dialog></training-guide-dialog>

        <div class="card-body">
          <div class="card-col card-col--left">
            <h3 class="section-title">EV values</h3>
            <ev-summary></ev-summary>
          </div>
        </div>

        <ev-history-log></ev-history-log>

        <button type="button" class="battle-fab ds-btn ds-btn--primary" aria-haspopup="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
          Log a battle
        </button>
        <p class="battle-status" aria-live="polite"></p>

        <!--
          One modal layer, not two (issue: the old outer .battle-dialog
          wrapper around this search's own full-screen sheet could be left
          open after the sheet closed — two stacked dialogs with only one
          of them actually tracking "closed"). This <pokemon-search>'s own
          force-sheet mode *is* the whole "Log a battle" UI now; the FAB
          shows it and focuses it, and pokemon-search's 'sheet-close' event
          (fired on pick, Escape, or blur-away) re-hides it below.
        -->
        <pokemon-search hidden placeholder="Defeated Pokémon…" show-ev-yield sheet-title="Log a battle" force-sheet>
          <p class="sheet-exp-share-note" slot="sheet-extra" hidden>Holding an Exp. Share — log the defeat here too, whether or not this Pokémon did the fighting. It earns the same EVs either way.</p>
        </pokemon-search>
      </article>
    `;

    this.$sprite = shadow.querySelector('.sprite');
    this.$spriteFrame = shadow.querySelector('.sprite-frame');
    this.$speciesNum = shadow.querySelector('.species-num');
    this.$nickname = shadow.querySelector('.nickname');
    this.$species = shadow.querySelector('.species');
    this.$levelValue = shadow.querySelector('.level-value');
    this.$levelUpBtn = shadow.querySelector('.level-up-btn');
    this.$natureBtn = shadow.querySelector('.nature-btn');
    this.$natureDialog = shadow.querySelector('nature-dialog');
    this.$levelDialog = shadow.querySelector('level-up-dialog');
    this.$ivDialog = shadow.querySelector('iv-dialog');
    this.$moreBtnWrap = shadow.querySelector('.more-btn-wrap');
    this.$moreBtn = shadow.querySelector('.more-btn');
    this.$moreMenu = shadow.querySelector('.more-menu');
    this.$itemBtn = shadow.querySelector('.held-item-btn');
    this.$itemBtnSprite = shadow.querySelector('.held-item-btn-sprite');
    this.$itemBtnLabel = shadow.querySelector('.held-item-btn-label');
    this.$itemsDialog = shadow.querySelector('items-dialog');
    this.$competitiveDialog = shadow.querySelector('competitive-dialog');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$search = shadow.querySelector('pokemon-search');
    this.$sheetExpShareNote = shadow.querySelector('.sheet-exp-share-note');
    // Shows what battling this opponent would actually add right now —
    // held item, Pokérus and the 252/510 caps folded in — rather than
    // the opponent's raw base yield, since those are what the player
    // actually cares about when picking who to grind against. Reads
    // `this._entry` live at call time, so it stays correct as the entry
    // (or its Pokérus/item state) changes without needing to be reset.
    this.$search.evModifier = (mon) => store.previewDefeat(this._entry.uid, mon)?.applied;
    this.$battleStatus = shadow.querySelector('.battle-status');
    this.$histLog = shadow.querySelector('ev-history-log');
    this.$battleFab = shadow.querySelector('.battle-fab');
    this.$trainingGuideBtn = shadow.querySelector('.training-guide-menu-item');
    this.$trainingGuideDialog = shadow.querySelector('training-guide-dialog');

    this._spriteFallback = wireSpriteFallback(this.$sprite);

    // Which of the six dialog routes (docs/adr/0023), if any, is
    // currently shown — set by syncDialog(), read there and in
    // closeDialogs() to avoid a redundant close+reopen of the same
    // dialog on a re-render that doesn't actually change the route
    // (showModal() throws on an already-open <dialog>).
    this._openSegment = null;
    this._wireEvents();
  }

  _wireEvents() {
    // Nickname stays instant, unlike Nature/Pokérus/Exp. Share/IVs below
    // (docs/adr/0017) — it isn't inside any dialog at all (it's always
    // editable right on the card header), so there's no Save button it
    // could sensibly defer to.
    this.$nickname.addEventListener('change', () => {
      store.renamePokemon(this._entry.uid, this.$nickname.value.trim());
    });
    this.$levelUpBtn.addEventListener('click', () => this._navigateToDialog('level'));

    // Every dialog route (docs/adr/0023) closes the same way regardless
    // of how it actually closed (Save, Cancel, ✕, Escape, backdrop
    // click) — each dialog already navigated nowhere on its own, so this
    // is the one place that syncs the URL back down to the bare Pokémon
    // page. Reading the route fresh (not a value captured at open time)
    // is what makes this a no-op if something else already navigated
    // away (e.g. a route change via Back/Forward already closed this
    // dialog through syncDialog()). base-dialog.js re-dispatches its
    // inner <dialog>'s own 'close' on the host element for exactly this
    // — the inner event doesn't cross the shadow boundary on its own.
    for (const [dialogEl, segment] of /** @type {[any, import('../../lib/router.js').PokemonDialog][]} */ ([
      [this.$natureDialog, 'nature'],
      [this.$levelDialog, 'level'],
      [this.$ivDialog, 'ivs'],
      [this.$itemsDialog, 'items'],
      [this.$competitiveDialog, 'competitive'],
      [this.$trainingGuideDialog, 'training-guide'],
    ])) {
      dialogEl.addEventListener('close', () => this._syncRouteOnClose(segment));
    }

    // The "More" button opens a small menu (Training & EVs / Competitive)
    // rather than a dialog directly — the combined dialog got long enough
    // (Level & nature through Remove, now Competitive on top) that
    // splitting by "what am I here to do" beat one long scroll. Shares its
    // open/outside-click/Escape/arrow-key behavior with the app shell's own
    // header menu (lib/shell.js) via wireDisclosureMenu — shadow DOM just
    // needs its own shadowRoot passed as the active-element root.
    const setMoreMenuOpen = wireDisclosureMenu({
      button: this.$moreBtn,
      menu: this.$moreMenu,
      itemSelector: '.more-menu-item',
      boundary: this.$moreBtnWrap,
      activeRoot: this.shadowRoot,
    });
    this.$moreMenu.addEventListener('click', (e) => {
      const item = /** @type {HTMLElement} */ (e.target).closest('.more-menu-item');
      if (!item) return;
      setMoreMenuOpen(false);
      if (item.dataset.open === 'ivs') this._navigateToDialog('ivs');
      else if (item.dataset.open === 'competitive') this._navigateToDialog('competitive');
      else if (item.dataset.open === 'training-guide') this._navigateToDialog('training-guide');
      else if (item.dataset.action === 'remove') this._removePokemon();
    });

    this.$natureBtn.addEventListener('click', () => this._navigateToDialog('nature'));
    // One modal layer, not two — <pokemon-search force-sheet> owns its
    // own full-screen sheet, so this element's plain `hidden` attribute
    // (not a wrapping <dialog>) is the only other state to manage: show
    // it and focus it to open, and let its own 'sheet-close' (fired on
    // pick, Escape, or blur-away — every way the sheet can end) hide it
    // again, whichever of those actually happened.
    this.$search.addEventListener('sheet-close', () => {
      this.$search.hidden = true;
    });
    this.$battleFab.addEventListener('click', () => {
      this.$battleStatus.textContent = '';
      this.$search.hidden = false;
      // Focusing immediately (rather than waiting for a tap on the field)
      // is what actually triggers pokemon-search's own recent-picks
      // list/full-screen sheet — the point of the FAB is one tap to a
      // ready-to-pick list, not one tap to an empty field.
      this.$search.focus();
    });
    this.$itemBtn.addEventListener('click', () => this._navigateToDialog('items'));
    this.$search.addEventListener('pokemon-pick', (e) => {
      this._battle(e.detail.name, 'Looking up battle data…');
    });
    this.$histLog.addEventListener('redefeat', (e) => {
      // Already knows the opponent's name — no need to open the search at
      // all, just the always-on-page status line.
      this._battle(e.detail.name, `Re-logging battle vs ${titleCase(e.detail.name)}…`);
    });
    // Already knows the opponent's name — no search UI needed, just the
    // always-on-page status line. training-guide.js already closes
    // itself before dispatching this.
    this.$trainingGuideDialog.addEventListener('spot-pick', (e) => {
      this._battle(e.detail.name, `Logging battle vs ${titleCase(e.detail.name)}…`);
    });
  }

  /** @param {import('../../lib/router.js').PokemonDialog} segment */
  _navigateToDialog(segment) {
    const partySlug = store.activeParty?.slug;
    if (partySlug && this._entry) router.navigateToPokemonDialog(partySlug, this._entry.uid, segment);
  }

  /** @param {import('../../lib/router.js').PokemonDialog} segment */
  _syncRouteOnClose(segment) {
    const route = router.currentRoute();
    if (route.pokemonDialog === segment) router.navigateToPokemon(route.partySlug, route.pokemonUid);
  }

  /** Removing a Pokémon from the roster is destructive and irreversible, so it's gated behind a native confirm() with no dialog of its own. */
  _removePokemon() {
    const label = titleCase(this._entry.nickname || this._entry.speciesName);
    if (confirm(`Remove ${label}? Its EV log will be deleted.`)) store.removePokemon(this._entry.uid);
  }

  set entry(e) {
    this._entry = e;
    this._render();
  }
  get entry() {
    return this._entry;
  }

  /**
   * The roster's own party (GitHub issue #31) — restricts the "Log a
   * battle" search to species actually reachable in this party's
   * generation (its base game's own, or `overrides.availableGeneration`)
   * instead of every species PokéAPI knows about. Set alongside `entry` by
   * components/pages/parties/pokemon/pokemon.js's `render()`.
   * `PokeApiClient`'s own cache (docs/adr/0001) makes recomputing this on
   * every render cheap after the first lookup.
   * @param {import('../../lib/store.js').Party|null} p
   */
  set party(p) {
    const token = ++this._allowedSpeciesToken;
    availableSpeciesFor(p, api).then((allowed) => {
      if (token === this._allowedSpeciesToken) this.$search.allowedSpecies = allowed;
    });
  }

  /** @param {import('../../lib/router.js').PokemonDialog} segment @returns {any} */
  _dialogFor(segment) {
    return {
      nature: this.$natureDialog,
      level: this.$levelDialog,
      ivs: this.$ivDialog,
      items: this.$itemsDialog,
      competitive: this.$competitiveDialog,
      'training-guide': this.$trainingGuideDialog,
    }[segment];
  }

  /** Closes whichever of the six dialogs is open — a harmless no-op if none are. */
  closeDialogs() {
    for (const segment of /** @type {import('../../lib/router.js').PokemonDialog[]} */ (['nature', 'level', 'ivs', 'items', 'competitive', 'training-guide'])) {
      this._dialogFor(segment).close();
    }
    this._openSegment = null;
  }

  /**
   * Called by components/pages/parties/pokemon/pokemon.js's render() on
   * every route change (docs/adr/0023) — opens the named dialog (seeding
   * its own pending state via that dialog's own `open()`), closing
   * whichever else was open first. Guarded on `_openSegment` so a
   * re-render that doesn't actually change which dialog is open (e.g. an
   * unrelated store change) doesn't close-then-reopen the same one —
   * `showModal()` throws on an already-open `<dialog>`, and closing an
   * in-progress edit out from under the user would discard it.
   * @param {import('../../lib/router.js').PokemonDialog|null} segment
   */
  syncDialog(segment) {
    if (segment === this._openSegment) return;
    this.closeDialogs();
    this._openSegment = segment;
    if (segment) this._dialogFor(segment).open();
  }

  async _battle(name, statusText) {
    this.$battleStatus.textContent = statusText;
    try {
      const mon = await api.getPokemon(name);
      store.logBattle(this._entry.uid, mon);
      this.$battleStatus.textContent = '';
    } catch (err) {
      this.$battleStatus.textContent = err.message || 'Could not log that battle.';
    }
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    const modernSprite = e.sprite || FALLBACK_SPRITE;
    const spriteGame = store.spriteBaseGame();
    const versioned = versionedSpriteUrl(spriteGame, e.speciesId);
    this._spriteFallback.setVersionedSprite(versioned, modernSprite);
    // Gen I/II sprites carry an opaque white background — the fully-trained
    // halo boxes them instead of hugging a silhouette (see the stylesheet).
    this.$spriteFrame.classList.toggle('sprite-frame--opaque', !!versioned && versionedSpriteIsOpaque(spriteGame));
    // Nickname is instant (not dialog-scoped, see _wireEvents), so this
    // always reflects the real, current value — no pending state to
    // preserve here the way Nature/Pokérus/Exp. Share below need to.
    this.$nickname.value = e.nickname || titleCase(e.speciesName);
    this.$speciesNum.textContent = `#${String(e.speciesId).padStart(3, '0')}`;
    // The species name only earns a second mention when a nickname is
    // hiding it — with no nickname the title already reads e.g. "#169
    // Crobat", so repeating "Crobat" below it would say nothing new.
    this.$species.hidden = !e.nickname;
    this.$species.textContent = e.nickname ? titleCase(e.speciesName) : '';
    this.$levelValue.textContent = `Lv. ${e.level}`;
    const natureAvailable = store.natureAvailable();
    this.$natureDialog.entry = e;
    this.$levelDialog.entry = e;
    const nature = natureAvailable ? NATURES.find((n) => n.id === e.nature) : null;
    this._renderNatureBadge(nature, natureAvailable);
    this._renderItemBadge(e);
    // Only relevant while this Pokémon actually holds an Exp. Share.
    this.$sheetExpShareNote.hidden = !e.expShare;
    // Recently-defeated opponents, most recent first (history is
    // unshift-ordered already) — lets a grinding session re-pick the
    // same opponent without retyping it each time.
    this.$search.recent = e.history
      .filter((h) => h.kind === 'battle')
      .map((h) => ({ name: h.opponentName, sprite: h.sprite }));
    const statExp = store.usesStatExpSystem();
    const totalCap = store.totalCap();
    const mergedSpecial = store.specialStatMerged();
    this.$evSummary.evs = e.evs;
    // The real current value per stat, not the species' base — a
    // reference number that never actually changes isn't as useful next
    // to a per-Pokémon EV tracker as what this specific one currently
    // has (docs/adr note: base stats moved to the Competitive dialog,
    // where min-maxing a build is the actual relevant use for them).
    // Null (blank) under Stat Experience (Gen I/II — store.actualStat
    // doesn't attempt that era's own rounding) or wherever this stat's
    // IV isn't known yet, same as store.actualStat's own contract.
    this.$evSummary.actualStats = e.baseStats
      ? Object.fromEntries(STATS.map(({ key }) => [key, store.actualStat(e, key, e.baseStats[key])]))
      : null;
    this.$evSummary.nature = nature;
    this.$evSummary.statCap = store.statCap();
    this.$evSummary.totalCap = totalCap;
    this.$evSummary.mergedSpecial = mergedSpecial;
    this.$natureDialog.helpTitle = statExp
      ? "Stat Experience is this game's hidden bonus stat pool — up to 65,535 per stat, gained mainly from battling (equal to the defeated Pokémon's own base stat). Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change Stat Experience, but training the stat your nature already boosts gets the most out of your points."
      : "EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.";

    this.toggleAttribute('fully-trained', store.isFullyTrained(e));

    // IVs/Items/Competitive each keep themselves live from `.entry` now
    // (iv-dialog.js/items-dialog.js/competitive-dialog.js) — the PKRS tag
    // below stays keyed to the entry's actual committed Pokérus status
    // regardless, same as it always did.
    this.$ivDialog.entry = e;
    this.$itemsDialog.entry = e;
    this.$competitiveDialog.entry = e;
    const aids = store.effectiveAids(e);
    this.toggleAttribute('pokerus-infected', aids.pokerus);
    if (aids.pokerus) {
      const contracted = e.history.find((h) => h.kind === 'pokerus' && h.active);
      this.$sprite.title = contracted
        ? `Pokérus — contracted ${dayLabel(contracted.timestamp)} — every EV earned from battling is doubled, permanently`
        : 'Pokérus — every EV earned from battling is doubled, permanently';
    } else {
      this.$sprite.title = '';
    }
    this.$trainingGuideDialog.entry = e;
    this.$trainingGuideBtn.hidden = !this.$trainingGuideDialog.locations();
    this.$histLog.entry = e;
  }

  // The nature badge sits in the title row, always visible, phrased the
  // way the games do: "Adamant Slowpoke" — and is itself the button that
  // opens .nature-dialog (docs/adr/0017), mirroring .level-up-btn/
  // .held-item-btn's "the badge is the trigger" pattern. Unlike the
  // held-item badge, an unset nature still needs a visible, tappable
  // "Set nature" — there'd otherwise be no way to ever set one.
  _renderNatureBadge(nature, natureAvailable) {
    this.$natureBtn.hidden = !natureAvailable;
    if (!natureAvailable) return;
    this.$natureBtn.classList.toggle('nature-btn--empty', !nature);
    this.$natureBtn.textContent = nature ? nature.label : 'Set nature';
    this.$natureBtn.title = nature ? `${nature.label} nature — ${natureEffectHint(nature)}` : 'Nature';
  }

  // The header's held-item badge doubles as the button that opens the
  // Items popup — mirrors .level-up-btn's own "the badge is the trigger"
  // pattern. Never hidden: Vitamins/Pokérus/Exp. Share/EV-reducing
  // berries live in that same popup now too (docs/adr/0017) and none of
  // those are gated on held-item support, so this stays the one entry
  // point regardless of generation. Exp. Share shows here rather than in
  // a badge of its own, since it's mutually exclusive with a power item/
  // the Macho Brace (store.js's setExpShare/setPowerItem/setMachoBrace)
  // — one held item, one slot to show it in. Reads through
  // store.effectiveAids for the power-item/Macho-Brace half, so an item
  // the party's rules don't support (e.g. a Macho Brace left over from
  // before the game version was edited) shows as "No item" — matching
  // the fact that it no longer applies — rather than claiming a bonus
  // that isn't granted. Pre-Gen III, where holding an item isn't a
  // mechanic at all, falls back to the dialog's own generic "Items"
  // label instead of a misleading "No item".
  _renderItemBadge(e) {
    this.$itemBtn.hidden = false;
    const aids = store.effectiveAids(e);
    let sprite = null;
    let label;
    let empty = true;
    if (e.expShare) {
      sprite = EXP_SHARE_SPRITE;
      label = 'Exp. Share';
      empty = false;
    } else if (aids.machoBrace) {
      sprite = MACHO_BRACE_SPRITE;
      label = `Macho Brace — ×${MACHO_BRACE_MULTIPLIER} EVs`;
      empty = false;
    } else if (aids.powerItem) {
      const item = POWER_ITEMS.find((p) => p.id === aids.powerItem);
      if (item) {
        sprite = item.sprite;
        label = `${item.label} — +${store.powerItemBonus()} ${STAT_LABEL[item.stat]}`;
        empty = false;
      }
    }
    if (label == null) {
      const availability = store.trainingItemAvailability();
      label = availability.machoBrace || availability.powerItems ? 'No item' : 'Items';
    }
    this.$itemBtn.classList.toggle('status-pill--item', !empty);
    this.$itemBtn.classList.toggle('status-pill--empty', empty);
    this.$itemBtnSprite.hidden = !sprite;
    this.$itemBtnSprite.src = sprite || '';
    this.$itemBtnLabel.textContent = label;
  }

}
customElements.define('pokemon-detail', PokemonDetail);
