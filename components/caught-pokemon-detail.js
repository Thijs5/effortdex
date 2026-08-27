import { POWER_ITEMS, MACHO_BRACE_SPRITE, EXP_SHARE_SPRITE, NATURES, STATS, STAT_LABEL, MACHO_BRACE_MULTIPLIER, FALLBACK_SPRITE, FALLBACK_ONERROR, MIN_LEVEL, MAX_LEVEL } from '../lib/constants.js';
import { titleCase, totalEvs, natureEffectHint, natureOptionsHtml, dayLabel, escapeHtml } from '../lib/utils.js';
import { api, store } from '../lib/services.js';
import { versionedSpriteUrl } from '../lib/pokeapi-client.js';
import { evTrainingLocations } from '../lib/ev-training-locations.js';
import { attachDesignSystem } from '../lib/design-system.js';
import { wireSpriteFallback } from '../lib/sprite-fallback.js';
import { wireDisclosureMenu, openShadowDialog, clearShadowDialogFlag } from '../lib/dom.js';
import './ev-summary.js';
import './ev-history-log.js';
import './ev-training-guide.js';
import './evolution-chain.js';
import './pokemon-search.js';
import './level-input.js';
import './iv-dialog.js';
import './items-dialog.js';
import './competitive-dialog.js';

/**
 * <caught-pokemon-detail> — a caught Pokémon's full detail page: identity,
 * EV bars, training aids (power item / Pokérus), evolution
 * (<evolution-chain>), a battle search (picking a result logs the defeat
 * immediately) and a history log (<ev-history-log>). Set `.entry` to a
 * Store roster entry; it re-renders on assignment. Meant to be mounted
 * one at a time, full width.
 */
export class CaughtPokemonDetail extends HTMLElement {
  constructor() {
    super();
    this._entry = null;
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
        .sprite {
          grid-area: sprite; align-self: start;
          width: 64px; height: 64px; image-rendering: pixelated;
          background: var(--sprite-bg); border-radius: var(--radius-sm); object-fit: contain;
          box-sizing: border-box; border: 2px solid transparent;
        }
        /* Ambient cue for the permanent ×2 EV bonus, visible even with the
           status row scrolled out of view — mirrors the pill's own color
           so both read as the same status. */
        :host([pokerus-infected]) .sprite {
          border-color: var(--pokerus-purple);
          box-shadow: 0 0 0 3px var(--pokerus-purple-soft);
        }
        /* A Pokémon at the 510 EV cap gets a gold shimmer instead of a
           text badge — the achievement reads at a glance without taking
           up header space. Backgrounds paint fine on <img> (unlike
           ::after, which replaced elements like <img> don't support), so
           the shimmer is just an animated gradient behind the sprite's
           transparent PNG edges. The border/ring still goes to Pokérus
           when both apply (next rule, higher specificity) — trained is a
           one-time achievement the background alone already communicates,
           while the ring is this Pokémon's one ongoing status worth not
           burying. */
        :host([fully-trained]) .sprite {
          border-color: #caa53d;
          box-shadow: 0 0 0 3px rgba(202, 165, 61, 0.35), 0 0 8px rgba(255, 215, 0, 0.3);
          background-image: linear-gradient(120deg, #c9a227 0%, #ffe9a8 30%, #fff6d5 50%, #ffe9a8 70%, #c9a227 100%);
          background-size: 180% 180%;
          animation: fully-trained-shimmer 5.5s linear infinite;
        }
        /* Both apply: keep the Pokérus ring (a fact about the Pokémon)
           visible rather than letting the gold fully-trained treatment
           hide it, while still layering the gold glow around it. */
        :host([fully-trained][pokerus-infected]) .sprite {
          border-color: var(--pokerus-purple);
          box-shadow: 0 0 0 3px var(--pokerus-purple-soft), 0 0 8px rgba(255, 215, 0, 0.3);
        }
        @keyframes fully-trained-shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
        @media (prefers-reduced-motion: reduce) {
          :host([fully-trained]) .sprite { animation: none; background-position: 40% 50%; }
        }
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
        /* Release used to be its own bordered button at the bottom of a
           long dialog — now it's just a menu entry, gated on its own
           native confirm() (docs/adr/0017), so the red styling that used
           to signal "careful" moves here instead. */
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

        /* Dialog chrome comes from the shared .ds-dialog, its header
           from .ds-dialog-header; only the grid layout of this dialog's
           own sections lives here. The grid's gap already spaces the
           header from the first section, so the shared bottom margin
           would double up. */
        .nature-dialog { gap: var(--space-4); }
        .nature-dialog:not([open]) { display: none; }
        .nature-dialog[open] { display: grid; }
        .nature-dialog .ds-dialog-header { margin-bottom: 0; }
        .nature-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .battle-dialog { gap: var(--space-4); }
        .battle-dialog:not([open]) { display: none; }
        .battle-dialog[open] { display: grid; }
        .battle-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .battle-dialog .ds-dialog-header { margin-bottom: 0; }
        .training-guide-dialog { gap: var(--space-4); }
        .training-guide-dialog:not([open]) { display: none; }
        .training-guide-dialog[open] { display: grid; }
        .training-guide-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .training-guide-dialog .ds-dialog-header { margin-bottom: 0; }
        /* Everything in this dialog previews only, applied together by
           the one footer Save button (docs/adr/0017) — except Pokérus,
           which stays instant (a plain reversible toggle, not a
           queued/counted action). */
        .level-up-dialog { gap: var(--space-4); }
        .level-up-dialog:not([open]) { display: none; }
        .level-up-dialog[open] { display: grid; }
        /* Wider than the other compact dialogs (420px) — this is the one
           that embeds <evolution-chain>, and three stages (current + two
           evolutions) plus arrows routinely need more than 420px to fit
           on one row before wrapping. */
        .level-up-dialog.ds-dialog { width: min(560px, calc(100vw - 2.4rem)); }
        .level-up-dialog .ds-dialog-header { margin-bottom: 0; }
        /* min-width: 0 overrides a grid/flex item's default min-width:
           auto — without it, this row (itself a grid child of
           .level-up-dialog[open]) refuses to shrink past its own
           children's combined intrinsic content width, so on a narrow
           phone it overflows .ds-dialog's own right padding instead of
           actually shrinking to fit. */
        .level-up-dialog .field-inline {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
          font-size: var(--font-size-xs); color: var(--ink-soft); min-width: 0;
        }
        .level-up-dialog .field-inline level-input { flex: 1 1 auto; min-width: 0; max-width: 14em; }
        /* The current level is read-only context, not part of what Save
           applies — only the level-input to its right is editable. */
        .level-up-from { font-family: var(--font-mono); white-space: nowrap; }
        /* .ds-dialog's own mobile breakpoint (design-system.js) turns
           every dialog into a full-height edge-to-edge sheet by zeroing
           margin/border-radius and forcing height:100dvh — meant for the
           long, scrolly Training & EVs dialog. These three stay small
           floating cards instead (their content is short), which the
           width overrides above already enforce on their own, but width
           alone left margin:0 in place: with an explicit width narrower
           than the viewport and inset:0 from the dialog's own centering,
           margin:0 over-constrains the box and it resolves flush against
           the left edge rather than centered. Restoring margin/height/
           radius here at the same breakpoint fixes that — height uses
           fit-content, not auto: a <dialog>'s UA box is fixed-positioned
           with top/bottom both pinned (inset:0), and for an abspos box
           with top and bottom both constrained, height:auto resolves to
           fill the remaining space rather than shrink to content (CSS2.1
           10.6.4) — which this grid's default align-content:stretch then
           spreads across the visible row tracks as a huge gap. fit-content
           is an explicit (non-auto) value, so it isn't subject to that
           fill-the-gap resolution and genuinely shrink-wraps instead. */
        @media (max-width: 640px) {
          .battle-dialog.ds-dialog,
          .level-up-dialog.ds-dialog,
          .nature-dialog.ds-dialog,
          .training-guide-dialog.ds-dialog {
            margin: auto;
            height: fit-content;
            max-height: calc(100dvh - 2.4rem);
            border-radius: var(--radius-md);
          }
        }
        .level-up-evolve, .level-up-stats { display: grid; gap: var(--space-2); min-width: 0; }
        .level-up-stats-hint { margin: 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .level-up-stats-fields { display: grid; gap: var(--space-2); }

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
        .battle-dialog .battle-dialog-body { display: grid; gap: var(--space-3); min-width: min(320px, 80vw); }

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
        /* Tap-to-toggle explanation under a section title — title-attribute
           tooltips don't exist on touch devices, so the same text must be
           reachable with a tap. */
        .help-note {
          margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
          color: var(--ink-soft); background: var(--lcd);
          border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
          text-transform: none; letter-spacing: normal;
        }

        .nature-dialog .field-inline {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
          font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .nature-dialog .field-inline select { width: auto; flex: 1 1 auto; max-width: 14em; }
        .nature-hint {
          margin: calc(-1 * var(--space-2)) 0 0; font-family: var(--font-mono);
          font-size: var(--font-size-2xs); color: var(--ink-soft); text-align: right;
        }
        .nature-hint:empty { display: none; }

        /* min-width: 0 on the row and its 1fr column's input — see the
           Level field's own min-width comment above for why a grid/flex
           item's default min-width: auto matters here (a narrow phone
           otherwise overflows past the dialog's own right edge instead
           of the input actually shrinking to fit). */
        .iv-row {
          display: grid; grid-template-columns: 3.5em 1fr; align-items: center; gap: var(--space-2);
          font-size: var(--font-size-xs); color: var(--ink-soft); min-width: 0;
        }
        .iv-row-label { font-family: var(--font-mono); }
        .iv-row input { width: auto; min-width: 0; }
        /* One extra column for the last-logged-reading note, read-only
           context before the new-value input (mirrors the level field's
           own "Lv. X →" shape) — blank (no note) when nothing's been
           logged for this stat yet, same width either way. */
        .level-up-stat-row { grid-template-columns: 3.5em auto 1fr; }
        .level-up-stat-last { font-family: var(--font-mono); font-size: var(--font-size-2xs); white-space: nowrap; }
        .training-guide-attribution { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }

        .status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--poke-red-dark); min-height: 1em; }
      </style>
      <article class="card">
        <header>
          <img class="sprite" alt="" />
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
              <button class="more-menu-item more-menu-item--danger" type="button" role="menuitem" data-action="release">Release</button>
            </div>
          </div>
        </header>

        <dialog class="nature-dialog ds-dialog" aria-labelledby="nature-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="nature-dialog-title">Nature
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What is EV training?" title="EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.">?</button>
            </h2>
            <button class="nature-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <label class="field-inline nature-field" hidden>Nature
            <select class="nature-select ds-field" aria-label="Nature"></select>
          </label>
          <p class="nature-hint" aria-live="polite"></p>
          <footer class="ds-dialog-footer">
            <button type="button" class="ds-btn ds-btn--primary nature-dialog-save-btn">Save</button>
          </footer>
        </dialog>

        <items-dialog></items-dialog>

        <iv-dialog></iv-dialog>

        <dialog class="level-up-dialog ds-dialog" aria-labelledby="level-up-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="level-up-dialog-title">Level</h2>
            <button class="level-up-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <label class="field-inline level-up-field">Level
            <span class="level-up-from">Lv. <span class="level-up-from-value"></span> →</span>
            <level-input class="level-up-input" aria-label="New level"></level-input>
          </label>

          <section class="level-up-evolve" hidden>
            <h3 class="section-title">Evolution</h3>
            <evolution-chain class="level-up-evo-chain"></evolution-chain>
          </section>

          <section class="level-up-stats" hidden>
            <h3 class="section-title">Log stat readings at Lv. <span class="level-up-stats-level"></span> (optional)</h3>
            <p class="level-up-stats-hint">Check any of this Pokémon's stats on its summary screen right now and enter them below — narrows its IVs. Leave any blank to skip.</p>
            <div class="level-up-stats-fields"></div>
          </section>

          <footer class="ds-dialog-footer">
            <button type="button" class="ds-btn ds-btn--primary level-up-done-btn" hidden>Save</button>
          </footer>
        </dialog>

        <competitive-dialog></competitive-dialog>

        <dialog class="training-guide-dialog ds-dialog" aria-labelledby="training-guide-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="training-guide-dialog-title">Where to train
              <button type="button" class="help-btn" aria-expanded="false" aria-label="About this list" title="A short, hand-picked list of good spots to grind each stat's EVs in this game — not an exhaustive list. Tap a Pokémon to log a battle against it.">?</button>
            </h2>
            <button class="training-guide-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <ev-training-guide></ev-training-guide>
          <p class="training-guide-attribution">Locations via Bulbapedia &amp; Marriland's EV training guides</p>
        </dialog>

        <div class="card-body">
          <div class="card-col card-col--left">
            <h3 class="section-title">EV values</h3>
            <ev-summary></ev-summary>
          </div>
        </div>

        <ev-history-log></ev-history-log>

        <button type="button" class="battle-fab ds-btn ds-btn--primary" aria-haspopup="dialog">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
          Log a battle
        </button>

        <dialog class="battle-dialog ds-dialog" aria-labelledby="battle-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="battle-dialog-title">Log a battle
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What about Exp. Share?" title="Holding an Exp. Share doesn't change how EVs work here — a Pokémon that gets EVs via Exp. Share earns exactly what it would from fighting directly. Just log the defeat here for this Pokémon too, whether or not it was the one that actually battled.">?</button>
            </h2>
            <button class="battle-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <div class="battle-dialog-body">
            <pokemon-search placeholder="Defeated Pokémon…" show-ev-yield sheet-title="Log a battle" force-sheet></pokemon-search>
            <p class="status" aria-live="polite"></p>
          </div>
        </dialog>
      </article>
    `;

    this.$sprite = shadow.querySelector('.sprite');
    this.$speciesNum = shadow.querySelector('.species-num');
    this.$nickname = shadow.querySelector('.nickname');
    this.$species = shadow.querySelector('.species');
    this.$levelValue = shadow.querySelector('.level-value');
    this.$levelUpBtn = shadow.querySelector('.level-up-btn');
    this.$natureField = shadow.querySelector('.nature-field');
    this.$nature = shadow.querySelector('.nature-select');
    this.$natureHint = shadow.querySelector('.nature-hint');
    this.$natureBtn = shadow.querySelector('.nature-btn');
    this.$natureDialog = shadow.querySelector('.nature-dialog');
    this.$natureDialogClose = shadow.querySelector('.nature-dialog-close');
    this.$natureDialogSaveBtn = shadow.querySelector('.nature-dialog-save-btn');
    this.$ivDialog = shadow.querySelector('iv-dialog');
    this.$levelUpDialog = shadow.querySelector('.level-up-dialog');
    this.$levelUpDialogClose = shadow.querySelector('.level-up-dialog-close');
    this.$levelUpInput = shadow.querySelector('.level-up-input');
    this.$levelUpFromValue = shadow.querySelector('.level-up-from-value');
    this.$levelUpEvolve = shadow.querySelector('.level-up-evolve');
    this.$levelUpEvoChain = shadow.querySelector('.level-up-evo-chain');
    this.$levelUpStats = shadow.querySelector('.level-up-stats');
    this.$levelUpStatsLevel = shadow.querySelector('.level-up-stats-level');
    this.$levelUpStatsFields = shadow.querySelector('.level-up-stats-fields');
    this.$levelUpDoneBtn = shadow.querySelector('.level-up-done-btn');
    this.$moreBtnWrap = shadow.querySelector('.more-btn-wrap');
    this.$moreBtn = shadow.querySelector('.more-btn');
    this.$moreMenu = shadow.querySelector('.more-menu');
    this.$itemBtn = shadow.querySelector('.held-item-btn');
    this.$itemBtnSprite = shadow.querySelector('.held-item-btn-sprite');
    this.$itemBtnLabel = shadow.querySelector('.held-item-btn-label');
    this.$itemsDialog = shadow.querySelector('items-dialog');
    this.$competitiveDialog = shadow.querySelector('competitive-dialog');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$evHelpBtn = shadow.querySelector('.nature-dialog .help-btn');
    this.$search = shadow.querySelector('pokemon-search');
    // Shows what battling this opponent would actually add right now —
    // held item, Pokérus and the 252/510 caps folded in — rather than
    // the opponent's raw base yield, since those are what the player
    // actually cares about when picking who to grind against. Reads
    // `this._entry` live at call time, so it stays correct as the entry
    // (or its Pokérus/item state) changes without needing to be reset.
    this.$search.evModifier = (mon) => store.previewDefeat(this._entry.uid, mon)?.applied;
    this.$status = shadow.querySelector('.status');
    this.$histLog = shadow.querySelector('ev-history-log');
    this.$battleFab = shadow.querySelector('.battle-fab');
    this.$battleDialog = shadow.querySelector('.battle-dialog');
    this.$battleDialogClose = shadow.querySelector('.battle-dialog-close');
    this.$trainingGuideBtn = shadow.querySelector('.training-guide-menu-item');
    this.$trainingGuideDialog = shadow.querySelector('.training-guide-dialog');
    this.$trainingGuideDialogClose = shadow.querySelector('.training-guide-dialog-close');
    this.$trainingGuide = shadow.querySelector('ev-training-guide');

    this._spriteFallback = wireSpriteFallback(this.$sprite);

    this.$nature.innerHTML = natureOptionsHtml();
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
    this.$levelUpBtn.addEventListener('click', () => this._openLevelUpDialog());
    this.$levelUpInput.addEventListener('change', () => this._previewLevelUpInput());
    this.$levelUpDoneBtn.addEventListener('click', () => this._saveLevelUp());
    this.$levelUpDialog.addEventListener('close', () => {
      clearShadowDialogFlag();
      this.$levelUpEvoChain.discard(); // no-op if Save already committed it
    });
    this.$levelUpDialogClose.addEventListener('click', () => this.$levelUpDialog.close());
    this.$levelUpDialog.addEventListener('click', (e) => {
      if (e.target === this.$levelUpDialog) this.$levelUpDialog.close();
    });
    // Nature also commits only on Save — the select already holds its
    // own pending value; the hint below is a pure display computation,
    // not a mutation, so it still updates live.
    this.$nature.addEventListener('change', () => this._renderNatureHint());

    // The "More" button opens a small menu (Training & EVs / Competitive)
    // rather than a dialog directly — the combined dialog got long enough
    // (Level & nature through Release, now Competitive on top) that
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
      if (item.dataset.open === 'ivs') this.$ivDialog.open();
      else if (item.dataset.open === 'competitive') this.$competitiveDialog.open();
      else if (item.dataset.open === 'training-guide') openShadowDialog(this.$trainingGuideDialog);
      else if (item.dataset.action === 'release') this._releasePokemon();
    });

    // 'close' catches every path a dialog can close by: the ✕, Esc, and
    // a backdrop click — also, harmlessly, a Save button's own .close()
    // call, since by then the pending fields it reset are already
    // applied to the store (docs/adr/0017).
    this.$natureDialog.addEventListener('close', () => clearShadowDialogFlag());
    this.$natureDialogClose.addEventListener('click', () => this.$natureDialog.close());
    this.$natureDialog.addEventListener('click', (e) => {
      if (e.target === this.$natureDialog) this.$natureDialog.close();
    });
    this.$natureDialogSaveBtn.addEventListener('click', () => this._saveNatureDialog());
    this.$natureBtn.addEventListener('click', () => this._openNatureDialog());
    this.$battleDialog.addEventListener('close', () => clearShadowDialogFlag());
    this.$battleDialogClose.addEventListener('click', () => this.$battleDialog.close());
    this.$battleDialog.addEventListener('click', (e) => {
      if (e.target === this.$battleDialog) this.$battleDialog.close();
    });
    this.$battleFab.addEventListener('click', () => {
      this.$status.textContent = '';
      openShadowDialog(this.$battleDialog);
      // Focusing immediately (rather than waiting for a tap on the field)
      // is what actually triggers pokemon-search's own recent-picks
      // list/full-screen sheet — the point of the FAB is one tap to a
      // ready-to-pick list, not one tap to an empty field.
      this.$search.focus();
    });
    this.$itemBtn.addEventListener('click', () => this.$itemsDialog.open());
    // Enter anywhere in a preview-then-Save dialog (Nature/Level —
    // docs/adr/0017) commits the same way clicking its own Save button
    // does, matching ordinary form expectations — without this, a native
    // <dialog> with no <form> wrapper just swallows Enter and does
    // nothing. Excluded: a <textarea> (Enter means "new line" there) and
    // a button (Enter/Space already activates it natively — re-clicking
    // Save here too would be a harmless but pointless double-fire).
    // iv-dialog.js wires this same behavior for its own dialog itself.
    for (const [dialog, saveBtn] of /** @type {[HTMLDialogElement, HTMLButtonElement][]} */ ([
      [this.$natureDialog, this.$natureDialogSaveBtn],
      [this.$levelUpDialog, this.$levelUpDoneBtn],
    ])) {
      dialog.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
        e.preventDefault();
        saveBtn.click();
      });
    }
    // The "?" buttons toggle their explanation inline: title tooltips are
    // hover-only, which leaves them unreachable on touch devices. Listens
    // on the shadow root, since these help buttons are spread across
    // several separate dialogs (Nature, Battle, Where to train) — Items/
    // IVs/Competitive each wire their own identical delegation in their
    // own shadow root now (iv-dialog.js/items-dialog.js/
    // competitive-dialog.js).
    this.shadowRoot.addEventListener('click', (e) => {
      const btn = e.target.closest('.help-btn');
      if (!btn) return;
      // A body sub-section's own heading (e.g. "Vitamins") anchors the
      // note right after it, same as always. A dialog-header "?" (IVs,
      // Nature, Competitive) has no .section-title ancestor — anchor to
      // the header itself instead, so the note lands as the body's first
      // element (right below the sticky header) rather than inside the
      // header (too cramped) or, with no anchor at all, crashing.
      const anchor = btn.closest('.section-title') || btn.closest('.ds-dialog-header');
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
    this.$search.addEventListener('pokemon-pick', (e) => {
      this._battle(e.detail.name, 'Looking up battle data…');
    });
    this.$histLog.addEventListener('redefeat', (e) => {
      // Opens the battle dialog too — its status line is the only place
      // "re-logging…"/an error would be visible now that it's not always
      // on-page (the FAB rework, issue #17).
      openShadowDialog(this.$battleDialog);
      this._battle(e.detail.name, `Re-logging battle vs ${titleCase(e.detail.name)}…`);
    });
    this.$trainingGuideDialog.addEventListener('close', () => clearShadowDialogFlag());
    this.$trainingGuideDialogClose.addEventListener('click', () => this.$trainingGuideDialog.close());
    this.$trainingGuideDialog.addEventListener('click', (e) => {
      if (e.target === this.$trainingGuideDialog) this.$trainingGuideDialog.close();
    });
    // Reuses the battle dialog for status, same precedent as the history
    // log's own 'redefeat' handler above — its status line is the only
    // place "logging…"/an error would show. Closes the guide first: a
    // native <dialog>.showModal() call from inside another open modal is
    // otherwise a dead end (docs/adr/0007's own modal-on-modal note).
    this.$trainingGuide.addEventListener('spot-pick', (e) => {
      this.$trainingGuideDialog.close();
      openShadowDialog(this.$battleDialog);
      this._battle(e.detail.name, `Logging battle vs ${titleCase(e.detail.name)}…`);
    });
  }

  /**
   * Seeds Nature from the entry (so a previous session's discarded edit
   * never leaks into a fresh one), then opens. Nature has no history
   * event of its own to undo (ADR 0006) — unlike Pokérus/Exp. Share/
   * vitamins, a wrong pick has no cheap fix, which is exactly why it
   * stays Save-gated instead of moving to the instant Items dialog.
   */
  _openNatureDialog() {
    this.$nature.value = this._entry.nature || '';
    this._renderNatureHint();
    openShadowDialog(this.$natureDialog);
  }

  /** Applies the pending Nature if it actually changed, then closes. */
  _saveNatureDialog() {
    const e = this._entry;
    if (this.$nature.value !== (e.nature || '')) store.setNature(e.uid, this.$nature.value || null);
    this.$natureDialog.close();
  }

  /** Release is destructive and irreversible, so it's gated behind a native confirm() with no dialog of its own. */
  _releasePokemon() {
    const label = titleCase(this._entry.nickname || this._entry.speciesName);
    if (confirm(`Release ${label}? Its EV log will be deleted.`)) store.releasePokemon(this._entry.uid);
  }

  set entry(e) {
    this._entry = e;
    this._render();
  }
  get entry() {
    return this._entry;
  }

  async _battle(name, statusText) {
    this.$status.textContent = statusText;
    try {
      const mon = await api.getPokemon(name);
      store.logDefeat(this._entry.uid, mon);
      this.$status.textContent = '';
      this.$battleDialog.close();
    } catch (err) {
      this.$status.textContent = err.message || 'Could not log that battle.';
    }
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    const modernSprite = e.sprite || FALLBACK_SPRITE;
    const versioned = versionedSpriteUrl(store.spriteBaseGame(), e.speciesId);
    this._spriteFallback.setVersionedSprite(versioned, modernSprite);
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
    this.$natureField.hidden = !natureAvailable;
    if (natureAvailable && !this.$natureDialog.open) this.$nature.value = e.nature || '';
    this._renderNatureHint();
    const nature = natureAvailable ? NATURES.find((n) => n.id === e.nature) : null;
    this._renderNatureBadge(nature, natureAvailable);
    this._renderItemBadge(e);
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
    this.$evHelpBtn.title = statExp
      ? "Stat Experience is this game's hidden bonus stat pool — up to 65,535 per stat, gained mainly from battling (equal to the defeated Pokémon's own base stat). Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change Stat Experience, but training the stat your nature already boosts gets the most out of your points."
      : "EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.";

    const trained = totalCap != null && totalEvs(e.evs) >= totalCap;
    this.toggleAttribute('fully-trained', trained);

    // IVs/Items/Competitive each keep themselves live from `.entry` now
    // (iv-dialog.js/items-dialog.js/competitive-dialog.js) — the ambient
    // ring/shimmer below stays keyed to the entry's actual committed
    // Pokérus status regardless, same as it always did.
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
    // Curated per-game data (lib/ev-training-locations.js), not a party
    // rule — no override, so read straight off the party's own baseGame
    // rather than through an effective-aids-style helper.
    const locations = evTrainingLocations(store.activeParty?.baseGame);
    this.$trainingGuideBtn.hidden = !locations;
    this.$trainingGuide.spriteGame = store.spriteBaseGame();
    this.$trainingGuide.locations = locations;
    this.$histLog.entry = e;
  }

  // Shows the selected nature's stat effect right under the picker, so
  // beginners don't have to memorize what e.g. "Adamant" does.
  _renderNatureHint() {
    const nature = NATURES.find((n) => n.id === this.$nature.value);
    this.$natureHint.textContent = nature ? natureEffectHint(nature) : '';
  }

  /**
   * Opens the Level popup fresh each time, prefilled to the current
   * level (not +1 — this is as much "log/fix stats now" as it is
   * "level up"). Both the evolution chain and the stat-reading rows
   * (Gen III+ only, same gate possibleIvsFromReadings/logStatReading
   * use) are shown immediately rather than gated behind an actual
   * increase — <evolution-chain> already only offers Evolve for a
   * directly-reachable next stage regardless of level (same as it did
   * in Training & EVs before it moved here), and logging or fixing a
   * stat reading shouldn't require bumping the level first either.
   * Nothing here touches the store yet — typing a level or a stat is
   * only a preview until Save commits it all together.
   */
  _openLevelUpDialog() {
    const e = this._entry;
    this.$levelUpFromValue.textContent = String(e.level);
    this.$levelUpInput.value = String(e.level);
    this.$levelUpEvolve.hidden = false;
    this.$levelUpEvoChain.entry = e;
    this.$levelUpEvoChain.load();
    if (store.usesStatExpSystem()) {
      this.$levelUpStats.hidden = true;
    } else {
      // Cleared before rebuilding: _renderLevelUpStatsFields carries
      // forward whatever's already in these inputs (for a mid-edit
      // re-render, e.g. the level field changing while this dialog stays
      // open), but a fresh open of the dialog should never inherit
      // fields left over from a previous, already-closed session.
      this.$levelUpStatsFields.innerHTML = '';
      this._renderLevelUpStatsFields(e.level);
      this.$levelUpStats.hidden = false;
    }
    this.$levelUpDoneBtn.hidden = false;
    openShadowDialog(this.$levelUpDialog);
  }

  /**
   * Rebuilds the stat rows for `level`'s label, carrying forward
   * whatever the user already typed into each one — this can run again
   * mid-edit (the level field changing), so losing a half-entered
   * reading just because the level was also adjusted would be hostile.
   * @param {number} level
   */
  _renderLevelUpStatsFields(level) {
    const existing = new Map(
      [...this.$levelUpStatsFields.querySelectorAll('input[data-stat]')].map((input) => [input.dataset.stat, input.value])
    );
    this.$levelUpStatsLevel.textContent = String(level);
    const e = this._entry;
    this.$levelUpStatsFields.innerHTML = STATS.map(({ key, label }) => {
      // The most recently logged reading for this stat, regardless of
      // level — read-only context alongside the new-value input, the
      // same "before → new" shape as the level field above it. Also
      // prefills the input itself (same convention as the level field
      // being prefilled to the current level) — a stat's real value
      // does shift with level, so this is a starting point to correct
      // after rechecking in-game, not assumed still accurate.
      const last = e.events.filter((ev) => ev.kind === 'stat-reading' && ev.statKey === key).at(-1);
      const lastNote = last ? `${last.observedStat} (Lv. ${last.level}) →` : '';
      const prefill = last ? String(last.observedStat) : '';
      const value = existing.get(key) ?? prefill;
      // data-prefill lets Save (below) tell "still exactly what it was
      // prefilled to" apart from "the user actually typed/confirmed
      // this" — a stat's real value shifts with level, so an untouched
      // prefill is a starting point to overwrite, not a reading to log.
      return `<div class="iv-row level-up-stat-row"><span class="iv-row-label">${escapeHtml(label)}</span><span class="level-up-stat-last">${escapeHtml(lastNote)}</span><input type="number" inputmode="numeric" class="ds-field" data-stat="${key}" data-prefill="${escapeHtml(prefill)}" min="1" value="${escapeHtml(value)}" aria-label="${escapeHtml(label)} observed stat value" placeholder="Actual stat" /></div>`;
    }).join('');
  }

  /** Clamps and previews the typed level against the stat rows' heading — nothing persists until Save. */
  _previewLevelUpInput() {
    const parsed = Math.round(Number(this.$levelUpInput.value));
    const clamped = Number.isNaN(parsed) ? this._entry.level : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
    this.$levelUpInput.value = String(clamped);
    if (!store.usesStatExpSystem()) this._renderLevelUpStatsFields(clamped);
  }

  /**
   * Records the level (and every filled-in stat row, at that now-current
   * level) first, then commits any pending Evolve/Undo choice (the one
   * network step here — see evolution-chain.js's `commit()`), then
   * closes — so history reads level-up-then-evolve, matching how the
   * games narrate it, rather than evolve-then-level. A failed evolve
   * commit leaves the dialog open with its own error message shown
   * instead of closing over a Save that didn't fully apply; the level
   * and stat readings it already recorded stay recorded, since a failed
   * evolve doesn't invalidate them. The level and every stat reading
   * share one batchId (not the evolve, which stays its own prominent
   * entry) so ev-history-log.js collapses them into a single summarized
   * entry instead of one row per stat.
   */
  async _saveLevelUp() {
    const e = this._entry;
    const batchId = crypto.randomUUID();
    store.setLevel(e.uid, this.$levelUpInput.value, batchId);
    for (const input of this.$levelUpStatsFields.querySelectorAll('input[data-stat]')) {
      const observed = Number(input.value);
      // Skip a field still sitting at its untouched prefill — see that
      // attribute's own comment (_renderLevelUpStatsFields) for why an
      // unconfirmed prefill must not get logged as if re-checked.
      if (observed && input.value !== input.dataset.prefill) {
        store.logStatReading(e.uid, /** @type {StatKey} */ (input.dataset.stat), observed, batchId);
      }
    }
    try {
      await this.$levelUpEvoChain.commit();
    } catch {
      return;
    }
    this.$levelUpDialog.close();
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
customElements.define('caught-pokemon-detail', CaughtPokemonDetail);
