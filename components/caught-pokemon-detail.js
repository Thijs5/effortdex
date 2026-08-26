import { POWER_ITEMS, MACHO_BRACE_SPRITE, EXP_SHARE_SPRITE, VITAMINS, FEATHERS, FEATHER_BONUS, EV_BERRIES, EV_BERRY_REDUCTION, NATURES, STATS, STAT_LABEL, MACHO_BRACE_MULTIPLIER, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, STAT_EXP_VITAMIN_BONUS, STAT_EXP_VITAMIN_CEILING, FALLBACK_SPRITE, FALLBACK_ONERROR, MIN_LEVEL, MAX_LEVEL } from '../lib/constants.js';
import { gen1SpecialStat } from '../lib/gen1-special-stats.js';
import { titleCase, totalEvs, natureEffectHint, natureOptionsHtml, dayLabel, escapeHtml, sortByLabel } from '../lib/utils.js';
import { api, store, smogon } from '../lib/services.js';
import { versionedSpriteUrl } from '../lib/pokeapi-client.js';
import { toShowdownId, smogonSetsKey, TIER_DESCRIPTIONS } from '../lib/smogon-client.js';
import { matchGameVersion } from '../lib/game-versions.js';
import { attachDesignSystem } from '../lib/design-system.js';
import { wireSpriteFallback } from '../lib/sprite-fallback.js';
import { POKERUS_ICON_SVG } from '../lib/icons.js';
import './ev-summary.js';
import './ev-history-log.js';
import './evolution-chain.js';
import './pokemon-search.js';
import './item-button-grid.js';
import './ds-item-button.js';
import './level-input.js';

// Sorted once — these tables are static, so re-sorting them on every
// render (this card's entire point) would be pure waste.
const SORTED_VITAMINS = sortByLabel(VITAMINS);
const SORTED_FEATHERS = sortByLabel(FEATHERS);
const SORTED_EV_BERRIES = sortByLabel(EV_BERRIES);

// Tier badge color grouping — see .tier-badge's own CSS comment for why
// this is three loose groups, not a per-tier rainbow.
const TIER_DANGER = new Set(['Uber', 'AG']);
const TIER_SPECIAL = new Set(['LC', 'NFE']);

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
    // Pending edits for the Nature and IVs dialogs (docs/adr/0017) — null
    // means "unchanged", seeded from the entry when each dialog opens,
    // applied to the store only on that dialog's Save.
    this._pendingIvs = null;
    // Same idea for the Items dialog's held-item slot (Training item /
    // Exp. Share — mutually exclusive, docs/adr/0017): { powerItem,
    // machoBrace, expShare }, seeded when the dialog opens, applied only
    // by the dialog's own footer Save button.
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
    this._pendingApplies = [];
    // Pokérus's own pending toggle state — null while the dialog isn't
    // open (or has no uncommitted change), a real boolean once it does.
    // Not folded into `_pendingApplies`: it's a plain on/off flag, not a
    // repeatable/counted action, same shape as `_pendingHeldItem`.
    this._pendingPokerus = null;

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
        .competitive-dialog { gap: var(--space-4); }
        .competitive-dialog:not([open]) { display: none; }
        .competitive-dialog[open] { display: grid; }
        .competitive-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .competitive-dialog .ds-dialog-header { margin-bottom: 0; }
        .iv-dialog { gap: var(--space-4); }
        .iv-dialog:not([open]) { display: none; }
        .iv-dialog[open] { display: grid; }
        .iv-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .iv-dialog .ds-dialog-header { margin-bottom: 0; }
        .item-dialog { gap: var(--space-4); }
        .item-dialog:not([open]) { display: none; }
        .item-dialog[open] { display: grid; }
        .item-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .item-dialog .ds-dialog-header { margin-bottom: 0; }
        .battle-dialog { gap: var(--space-4); }
        .battle-dialog:not([open]) { display: none; }
        .battle-dialog[open] { display: grid; }
        .battle-dialog.ds-dialog { width: min(420px, calc(100vw - 2.4rem)); }
        .battle-dialog .ds-dialog-header { margin-bottom: 0; }
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
          .competitive-dialog.ds-dialog,
          .iv-dialog.ds-dialog,
          .item-dialog.ds-dialog,
          .level-up-dialog.ds-dialog,
          .nature-dialog.ds-dialog {
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

        .ivs { display: grid; gap: var(--space-2); min-width: 0; }
        .iv-grid { display: grid; gap: var(--space-2); }
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
        .iv-row-derived {
          font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft);
          text-align: right; padding-right: var(--space-2);
        }
        .iv-row--perfect .iv-row-label { color: var(--teal); }
        /* One extra column for the last-logged-reading note, read-only
           context before the new-value input (mirrors the level field's
           own "Lv. X →" shape) — blank (no note) when nothing's been
           logged for this stat yet, same width either way. */
        .level-up-stat-row { grid-template-columns: 3.5em auto 1fr; }
        .level-up-stat-last { font-family: var(--font-mono); font-size: var(--font-size-2xs); white-space: nowrap; }
        .iv-summary { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .iv-calc {
          display: grid; gap: var(--space-2); margin-top: var(--space-1);
          padding: var(--space-3); background: var(--lcd); border-radius: var(--radius-sm);
        }
        .iv-calc > summary { cursor: pointer; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .iv-calc-hint, .iv-calc-note { margin: var(--space-2) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .iv-calc-fields { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
        .iv-calc-fields select,
        .iv-calc-fields input { width: auto; flex: 1 1 6em; }
        .iv-calc-results { display: flex; flex-wrap: wrap; gap: var(--space-2); min-height: 1.5em; }
        .iv-calc-chip {
          border: 1px solid var(--lcd-line); border-radius: var(--radius-pill); background: var(--surface);
          padding: var(--space-1) var(--space-3); font-family: var(--font-mono); font-size: var(--font-size-2xs);
          cursor: pointer;
        }
        .iv-calc-chip:hover { border-color: var(--teal); color: var(--teal); }
        .iv-calc-readings { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); }
        .iv-calc-readings:empty { display: none; }
        .iv-calc-readings li {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
          font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft);
        }
        .iv-calc-reading-delete {
          border: none; background: none; color: var(--ink-soft); cursor: pointer; padding: 0 var(--space-1);
          font-size: var(--font-size-2xs); line-height: 1;
        }
        .iv-calc-reading-delete:hover { color: var(--poke-red); }

        .vitamins, .wings, .berries { display: grid; gap: var(--space-2); }

        .pokerus-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
        .pokerus-icon { width: 22px; height: 22px; flex: 0 0 auto; display: inline-flex; color: var(--pokerus-purple); }
        .pokerus-icon svg { width: 100%; height: 100%; }

        .exp-share-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
        .pokerus-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }

        .competitive-panel { display: grid; gap: var(--space-2); }
        /* Base stats: a fixed reference for min-maxing a build (which
           stats are worth EVs against a species' own ceiling) — moved
           here from next to the EV bars, where a number that never
           changes for this Pokémon specifically wasn't as useful as its
           actual current stat (caught-pokemon-detail's own _render). */
        .competitive-base-stats { display: grid; gap: var(--space-1); }
        .base-stat-row {
          display: grid; grid-template-columns: 3.5em 1fr; align-items: center; gap: var(--space-2);
          font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .base-stat-label { font-family: var(--font-mono); }
        .base-stat-value { font-family: var(--font-mono); color: var(--ink); text-align: right; }
        /* Three loose groups, not a full per-tier rainbow — a 14-color
           gradient would just be a new scale to learn. Default (teal):
           every ordinary ranked tier (OU down through PU/ZU and their
           banlists). --danger: Uber/AG, the "banned for being too
           strong" case, worth a visual heads-up. --special: LC/NFE,
           flagged as a different color on purpose since it's a
           different *axis* (evolution stage, not a power ranking) —
           the mix-up a newcomer is likeliest to make seeing a two-letter
           code next to ranked ones. */
        .tier-badge {
          font-family: var(--font-mono); font-size: var(--font-size-2xs); font-weight: 700;
          letter-spacing: 0.04em; color: var(--teal-strong); background: var(--teal-soft);
          border-radius: var(--radius-pill); padding: 0.15em 0.6em; text-transform: none;
          border: none; cursor: pointer;
        }
        .tier-badge--danger { color: var(--poke-red-dark); background: var(--danger-soft); }
        .tier-badge--special { color: var(--pokerus-purple); background: var(--pokerus-purple-soft); }
        /* Deliberately the plainest of the four — Illegal isn't "worse"
           than a ranked tier the way the danger/special groups carry
           their own meaning, it's "not applicable here at all", so it
           gets the same neutral treatment as an unset value elsewhere
           (e.g. the roster's "no held item" pill) rather than a color
           that implies it belongs on the same scale. */
        .tier-badge--illegal { color: var(--ink-soft); background: var(--lcd); border: 1px dashed var(--lcd-line); }
        .competitive-sets { display: grid; gap: var(--space-3); }
        .competitive-set {
          display: grid; gap: 0.2em; padding: var(--space-3); background: var(--lcd);
          border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .competitive-set-title { margin: 0; font-weight: 600; color: var(--ink); }
        .competitive-set-format { font-weight: 400; color: var(--ink-soft); text-transform: uppercase; }
        .competitive-set-line { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); }
        .competitive-set-line:empty { display: none; }
        .competitive-set-moves { margin: 0; font-size: var(--font-size-2xs); }
        .competitive-empty { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .competitive-attribution { margin: 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .competitive-attribution a { color: inherit; }

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

        <dialog class="item-dialog ds-dialog" aria-labelledby="item-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="item-dialog-title">Items</h2>
            <button class="item-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>

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

          <footer class="ds-dialog-footer">
            <button type="button" class="ds-btn ds-btn--primary item-dialog-save-btn">Save</button>
          </footer>
        </dialog>

        <dialog class="iv-dialog ds-dialog" aria-labelledby="iv-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="iv-dialog-title">IVs
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What are IVs?" title="Individual Values (IVs) are hidden, randomly-rolled bonus stat points fixed the moment this Pokémon was caught or hatched — 0-31 each (0-15 in Gen I/II, called DVs, with HP derived from the other four rather than stored on its own). Unlike EVs, they never change from training or leveling up. Enter them if you already know them (breeding, the in-game IV Judge), or use the calculator below to narrow one down from an observed stat.">?</button>
            </h2>
            <button class="iv-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <div class="iv-grid"></div>
          <p class="iv-summary" hidden></p>
          <details class="iv-calc" hidden>
            <summary>Don't know an IV? Calculate it from a stat</summary>
            <p class="iv-calc-hint">Check this Pokémon's actual <em class="iv-calc-stat-name"></em> stat right now (its summary screen in-game) and log it below — uses its current level and EVs, so check it now rather than typing in an old reading. Logging another reading later (after it levels up or gains EVs) narrows the candidates further.</p>
            <div class="iv-calc-fields">
              <select class="iv-calc-stat ds-field" aria-label="Stat"></select>
              <input type="number" inputmode="numeric" class="iv-calc-observed ds-field" min="1" aria-label="Observed stat value" placeholder="Actual stat" />
              <button type="button" class="ds-btn ds-btn--ghost iv-calc-btn">Log reading</button>
            </div>
            <ul class="iv-calc-readings" aria-live="polite"></ul>
            <p class="iv-calc-note" aria-live="polite" hidden></p>
            <div class="iv-calc-results" aria-live="polite"></div>
          </details>
          <footer class="ds-dialog-footer">
            <button type="button" class="ds-btn ds-btn--primary iv-dialog-save-btn">Save</button>
          </footer>
        </dialog>

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

        <dialog class="competitive-dialog ds-dialog" aria-labelledby="competitive-dialog-title">
          <header class="ds-dialog-header">
            <h2 id="competitive-dialog-title">Competitive</h2>
            <button class="competitive-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <div class="competitive-panel">
            <h3 class="section-title">Base stats</h3>
            <div class="competitive-base-stats"></div>
            <h3 class="section-title">Tier &amp; common sets
              <button type="button" class="help-btn" aria-expanded="false" aria-label="Where does this come from?" title="Tier via Pokémon Showdown, common sets via Smogon University's strategy dex — both fetched live and cached locally for about a week. Shown for this party's own generation. Not every species has a published competitive analysis.">?</button>
              <button type="button" class="tier-badge help-btn" aria-expanded="false" aria-label="What does this tier mean?" hidden></button>
            </h3>
            <div class="competitive-sets"></div>
            <p class="competitive-empty" hidden>No published competitive data for this Pokémon in this generation.</p>
            <p class="competitive-attribution">Tiers via Pokémon Showdown &middot; sets via Smogon University</p>
          </div>
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
    this.$ivDialog = shadow.querySelector('.iv-dialog');
    this.$ivDialogClose = shadow.querySelector('.iv-dialog-close');
    this.$ivGrid = shadow.querySelector('.iv-grid');
    this.$ivSummary = shadow.querySelector('.iv-summary');
    this.$ivCalc = shadow.querySelector('.iv-calc');
    this.$ivCalcStatName = shadow.querySelector('.iv-calc-stat-name');
    this.$ivCalcStat = shadow.querySelector('.iv-calc-stat');
    this.$ivCalcObserved = shadow.querySelector('.iv-calc-observed');
    this.$ivCalcBtn = shadow.querySelector('.iv-calc-btn');
    this.$ivCalcReadings = shadow.querySelector('.iv-calc-readings');
    this.$ivCalcNote = shadow.querySelector('.iv-calc-note');
    this.$ivCalcResults = shadow.querySelector('.iv-calc-results');
    this.$ivDialogSaveBtn = shadow.querySelector('.iv-dialog-save-btn');
    this.$ivCalcStat.innerHTML = STATS.map(({ key, label }) => `<option value="${key}">${label}</option>`).join('');
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
    this.$itemDialog = shadow.querySelector('.item-dialog');
    this.$itemDialogClose = shadow.querySelector('.item-dialog-close');
    this.$competitiveDialog = shadow.querySelector('.competitive-dialog');
    this.$competitiveDialogClose = shadow.querySelector('.competitive-dialog-close');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$itemGrid = shadow.querySelector('.item-grid');
    this.$itemDialogSaveBtn = shadow.querySelector('.item-dialog-save-btn');
    this.$pokerusToggle = shadow.querySelector('.pokerus-toggle-btn');
    this.$pokerusNote = shadow.querySelector('.pokerus-note');
    this.$expShareToggle = shadow.querySelector('.exp-share-toggle-btn');
    this.$vitaminGrid = shadow.querySelector('.vitamin-grid');
    this.$evHelpBtn = shadow.querySelector('.nature-dialog .help-btn');
    this.$wingsSection = shadow.querySelector('.wings');
    this.$wingGrid = shadow.querySelector('.wing-grid');
    this.$berriesSection = shadow.querySelector('.berries');
    this.$berryGrid = shadow.querySelector('.berry-grid');
    this.$tierBadge = shadow.querySelector('.tier-badge');
    this.$competitiveBaseStats = shadow.querySelector('.competitive-base-stats');
    this.$competitiveSets = shadow.querySelector('.competitive-sets');
    this.$competitiveEmpty = shadow.querySelector('.competitive-empty');
    this._competitiveToken = 0; // guards against a stale async response landing after a fast species switch
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

    this._spriteFallback = wireSpriteFallback(this.$sprite);

    this.$nature.innerHTML = natureOptionsHtml();
    this._wireEvents();
  }

  // Rebuilt on every render (not just once) because which items are even
  // offered — and the Power item bonus shown — depends on the entry's
  // party's game version, and this one component instance is reused
  // across different parties as the user navigates. Reads through
  // `_pendingHeldItem` while the Items dialog has an uncommitted pick
  // (docs/adr/0017) — falling back to the entry's actual committed
  // values the rest of the time (dialog closed, or an unrelated store
  // change re-rendering everything while it's open) — so an in-progress
  // pick survives a re-render it didn't cause. Also drives the Exp.
  // Share toggle's `active` state, since it shares this same pending
  // held-item slot.
  _updateItemGrid() {
    const bonus = store.powerItemBonus();
    const availability = store.trainingItemAvailability();
    const pending = this._pendingHeldItem || this._entry;
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
      this._onDialogClosed();
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
    // Delegated: the grid's number inputs are rebuilt every render (one
    // per stat, fewer in Gen I/II — see _renderIvs), so a single listener
    // here outlives any individual input the way the per-field ones above
    // can't.
    this.$ivGrid.addEventListener('change', (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const statKey = input?.dataset?.stat;
      if (!statKey) return;
      // Preview only — store.setIv doesn't run until Save (docs/adr/0017).
      // Updates the "N/6 known" summary and perfect-stat highlight live,
      // but deliberately *doesn't* call the full _renderIvs rebuild here:
      // that replaces every <input> in the grid (a fresh DOM node per
      // stat), and this fires on blur — the exact moment focus is moving
      // to whichever field the user clicks/tabs into next. Rebuilding
      // then would destroy that field's own node out from under the
      // focus-in-progress, discarding it as if it had never been typed
      // (a value another stat's change event does).
      this._pendingIvs[statKey] = input.value === '' ? null : Number(input.value);
      this._updateIvSummary();
    });
    this.$ivCalcStat.addEventListener('change', () => this._updateIvCalcHint());
    this.$ivCalcBtn.addEventListener('click', () => this._logIvReading());
    this.$ivCalcResults.addEventListener('click', (e) => {
      const chip = /** @type {HTMLElement} */ (e.target).closest('.iv-calc-chip');
      if (!chip) return;
      const statKey = /** @type {StatKey} */ (this.$ivCalcStat.value);
      const iv = Number(chip.dataset.iv);
      // Set pending *before* store.setIv, not after: store.setIv's save
      // synchronously dispatches the store's 'change' event, which
      // re-renders the grid from _pendingIvs immediately — updating
      // pending afterward would be one render too late, and Save would
      // then overwrite the calculator's own result with a stale value.
      if (this._pendingIvs) this._pendingIvs[statKey] = iv;
      store.setIv(this._entry.uid, statKey, iv);
    });
    this.$ivCalcReadings.addEventListener('click', (e) => {
      const del = /** @type {HTMLElement} */ (e.target).closest('.iv-calc-reading-delete');
      if (!del) return;
      store.deleteHistoryEntry(this._entry.uid, del.dataset.id);
    });

    // The "More" button opens a small menu (Training & EVs / Competitive)
    // rather than a dialog directly — the combined dialog got long enough
    // (Level & nature through Release, now Competitive on top) that
    // splitting by "what am I here to do" beat one long scroll. Mirrors
    // the app shell's own header menu (lib/shell.js) — open/outside-
    // click/Escape/arrow-key behavior all match it, reimplemented locally
    // since shadow DOM can't reuse that light-DOM listener setup.
    const moreMenuItems = () => [...this.$moreMenu.querySelectorAll('.more-menu-item')];
    const setMoreMenuOpen = (open) => {
      this.$moreMenu.hidden = !open;
      this.$moreBtn.setAttribute('aria-expanded', String(open));
      if (open) moreMenuItems()[0].focus();
    };
    this.$moreBtn.addEventListener('click', () => setMoreMenuOpen(this.$moreMenu.hidden));
    this.$moreMenu.addEventListener('click', (e) => {
      const item = /** @type {HTMLElement} */ (e.target).closest('.more-menu-item');
      if (!item) return;
      setMoreMenuOpen(false);
      if (item.dataset.open === 'ivs') this._openIvsDialog();
      else if (item.dataset.open === 'competitive') this._openDialog(this.$competitiveDialog);
      else if (item.dataset.action === 'release') this._releasePokemon();
    });
    // A click anywhere outside the menu closes it — listened on
    // `document`, not this.shadowRoot, since a click that lands outside
    // the whole component (e.g. the page background) never reaches a
    // shadow-root-scoped listener at all. e.target retargets to the host
    // element from outside the shadow boundary, so composedPath() (which
    // doesn't) is what actually finds .more-btn-wrap when the click was
    // inside it.
    document.addEventListener('click', (e) => {
      if (!this.$moreMenu.hidden && !e.composedPath().includes(this.$moreBtnWrap)) setMoreMenuOpen(false);
    });
    this.shadowRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.$moreMenu.hidden) {
        setMoreMenuOpen(false);
        this.$moreBtn.focus();
      }
    });
    this.$moreMenu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = moreMenuItems();
      const current = items.indexOf(/** @type {HTMLElement} */ (this.shadowRoot.activeElement));
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(current + step + items.length) % items.length].focus();
    });

    // 'close' catches every path a dialog can close by: the ✕, Esc, and
    // a backdrop click — also, harmlessly, a Save button's own .close()
    // call, since by then the pending fields it reset are already
    // applied to the store (docs/adr/0017).
    this.$natureDialog.addEventListener('close', () => this._onDialogClosed());
    this.$natureDialogClose.addEventListener('click', () => this.$natureDialog.close());
    this.$natureDialog.addEventListener('click', (e) => {
      if (e.target === this.$natureDialog) this.$natureDialog.close();
    });
    this.$natureDialogSaveBtn.addEventListener('click', () => this._saveNatureDialog());
    this.$natureBtn.addEventListener('click', () => this._openNatureDialog());
    this.$battleDialog.addEventListener('close', () => this._onDialogClosed());
    this.$battleDialogClose.addEventListener('click', () => this.$battleDialog.close());
    this.$battleDialog.addEventListener('click', (e) => {
      if (e.target === this.$battleDialog) this.$battleDialog.close();
    });
    this.$battleFab.addEventListener('click', () => {
      this.$status.textContent = '';
      this._openDialog(this.$battleDialog);
      // Focusing immediately (rather than waiting for a tap on the field)
      // is what actually triggers pokemon-search's own recent-picks
      // list/full-screen sheet — the point of the FAB is one tap to a
      // ready-to-pick list, not one tap to an empty field.
      this.$search.focus();
    });
    this.$itemDialog.addEventListener('close', () => {
      this._onDialogClosed();
      this._pendingHeldItem = null; // discard any uncommitted picks/queue — harmless no-op if Save already applied and closed
      this._pendingApplies = [];
      this._pendingPokerus = null;
    });
    this.$itemDialogClose.addEventListener('click', () => this.$itemDialog.close());
    this.$itemDialog.addEventListener('click', (e) => {
      if (e.target === this.$itemDialog) this.$itemDialog.close();
    });
    this.$itemBtn.addEventListener('click', () => this._openItemDialog());
    this.$competitiveDialog.addEventListener('close', () => this._onDialogClosed());
    this.$competitiveDialogClose.addEventListener('click', () => this.$competitiveDialog.close());
    this.$competitiveDialog.addEventListener('click', (e) => {
      if (e.target === this.$competitiveDialog) this.$competitiveDialog.close();
    });
    this.$ivDialog.addEventListener('close', () => {
      this._onDialogClosed();
      this._pendingIvs = null;
    });
    this.$ivDialogClose.addEventListener('click', () => this.$ivDialog.close());
    this.$ivDialog.addEventListener('click', (e) => {
      if (e.target === this.$ivDialog) this.$ivDialog.close();
    });
    this.$ivDialogSaveBtn.addEventListener('click', () => this._saveIvs());
    // Enter anywhere in a preview-then-Save dialog (Nature/IVs/Level —
    // docs/adr/0017) commits the same way clicking its own Save button
    // does, matching ordinary form expectations — without this, a native
    // <dialog> with no <form> wrapper just swallows Enter and does
    // nothing. Excluded: a <textarea> (Enter means "new line" there) and
    // a button (Enter/Space already activates it natively — re-clicking
    // Save here too would be a harmless but pointless double-fire).
    for (const [dialog, saveBtn] of /** @type {[HTMLDialogElement, HTMLButtonElement][]} */ ([
      [this.$natureDialog, this.$natureDialogSaveBtn],
      [this.$ivDialog, this.$ivDialogSaveBtn],
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
    // several separate dialogs now (Nature, Items, IVs, Level).
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
    // Everything in this dialog only previews here (docs/adr/0017) —
    // Training item/Exp. Share write into `_pendingHeldItem`, Pokérus
    // into `_pendingPokerus`, Vitamins/Wings/berries queue into
    // `_pendingApplies`; all of it applies together only on the
    // dialog's own footer Save button.
    this.$itemGrid.addEventListener('item-pick', (e) => {
      const val = e.detail.id;
      const pending = this._pendingHeldItem;
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
    // Pokérus only previews here too, same as everything else in this
    // dialog — applied on the footer Save button along with the rest.
    this.$pokerusToggle.addEventListener('pick', () => {
      this._pendingPokerus = !this.$pokerusToggle.hasAttribute('active');
      this.$pokerusToggle.toggleAttribute('active', this._pendingPokerus);
    });
    this.$expShareToggle.addEventListener('pick', () => {
      const pending = this._pendingHeldItem;
      pending.expShare = !pending.expShare;
      if (pending.expShare) {
        pending.powerItem = null;
        pending.machoBrace = false;
      }
      this._updateItemGrid();
    });
    this.$itemDialogSaveBtn.addEventListener('click', () => this._saveItemDialog());
    this.$vitaminGrid.addEventListener('item-pick', (e) => this._queueVitamin(e.detail.id));
    this.$wingGrid.addEventListener('item-pick', (e) => this._queueFeather(e.detail.id));
    this.$berryGrid.addEventListener('item-pick', (e) => this._queueBerry(e.detail.id));
    this.$search.addEventListener('pokemon-pick', (e) => {
      this._battle(e.detail.name, 'Looking up battle data…');
    });
    this.$histLog.addEventListener('redefeat', (e) => {
      // Opens the battle dialog too — its status line is the only place
      // "re-logging…"/an error would be visible now that it's not always
      // on-page (the FAB rework, issue #17).
      this._openDialog(this.$battleDialog);
      this._battle(e.detail.name, `Re-logging battle vs ${titleCase(e.detail.name)}…`);
    });
  }

  /** @param {HTMLDialogElement} dialog */
  _openDialog(dialog) {
    dialog.showModal();
    // styles.css's html:has(dialog[open]) scroll lock can't see into
    // this shadow root, so flag the open state on <html> ourselves.
    document.documentElement.dataset.modalOpen = '';
  }

  _onDialogClosed() {
    delete document.documentElement.dataset.modalOpen;
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
    this._openDialog(this.$natureDialog);
  }

  /** Applies the pending Nature if it actually changed, then closes. */
  _saveNatureDialog() {
    const e = this._entry;
    if (this.$nature.value !== (e.nature || '')) store.setNature(e.uid, this.$nature.value || null);
    this.$natureDialog.close();
  }

  /**
   * Seeds the held-item pending state from the entry (so a previous
   * session's discarded pick never leaks into a fresh one — same
   * reasoning as Nature/IVs, docs/adr/0017), clears the queued Vitamin/
   * Wing/berry list, refreshes every grid from that, then opens.
   */
  _openItemDialog() {
    const e = this._entry;
    this._pendingHeldItem = { powerItem: e.powerItem, machoBrace: e.machoBrace, expShare: e.expShare };
    this._pendingApplies = [];
    this._pendingPokerus = e.pokerus;
    this.$pokerusToggle.toggleAttribute('active', !!e.pokerus);
    this._updateItemGrid();
    this._updateVitaminGrid(e);
    this._updateWingGrid(e);
    this._updateBerryGrid(e);
    this._openDialog(this.$itemDialog);
  }

  /**
   * Applies everything staged in this dialog session, then closes:
   * the held-item choice (Training item, Macho Brace, or Exp. Share —
   * whichever ended up set), the Pokérus toggle, then every queued
   * Vitamin/Wing/berry click in the exact order it was queued
   * (`_simulatedEvs`'s own comment explains why order matters) —
   * replayed through the real store.useVitamin/useFeather/useBerry, so
   * the store's own capping logic is what actually runs, not the
   * preview math a second time. Everything shares one batchId so
   * ev-history-log.js collapses this Save into a single summarized
   * entry, same as the Level popup's.
   */
  _saveItemDialog() {
    const e = this._entry;
    const p = this._pendingHeldItem;
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
    this.$itemDialog.close();
  }

  /** Release is destructive and irreversible, so it's gated behind a native confirm() with no dialog of its own. */
  _releasePokemon() {
    const label = titleCase(this._entry.nickname || this._entry.speciesName);
    if (confirm(`Release ${label}? Its EV log will be deleted.`)) store.releasePokemon(this._entry.uid);
  }

  /** Seeds pending IVs from the entry, then opens. */
  _openIvsDialog() {
    this._pendingIvs = { ...this._entry.ivs };
    this._renderIvs(this._entry, store.usesStatExpSystem());
    this._openDialog(this.$ivDialog);
  }

  /** Applies every stat whose pending IV actually changed, then closes. */
  _saveIvs() {
    const e = this._entry;
    for (const { key } of STATS) {
      if (this._pendingIvs[key] !== e.ivs[key]) store.setIv(e.uid, key, this._pendingIvs[key]);
    }
    this.$ivDialog.close();
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
    } catch (err) {
      this.$status.textContent = err.message || 'Could not log that battle.';
    }
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
    const evs = { ...this._entry.evs };
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
    const uid = this._entry.uid;
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
    this._updateVitaminGrid(this._entry);
    this._updateWingGrid(this._entry);
    this._updateBerryGrid(this._entry);
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
    this._renderBaseStats(e, mergedSpecial);
    this.$evHelpBtn.title = statExp
      ? "Stat Experience is this game's hidden bonus stat pool — up to 65,535 per stat, gained mainly from battling (equal to the defeated Pokémon's own base stat). Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change Stat Experience, but training the stat your nature already boosts gets the most out of your points."
      : "EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.";

    const trained = totalCap != null && totalEvs(e.evs) >= totalCap;
    this.toggleAttribute('fully-trained', trained);

    this._renderIvs(e, statExp);
    this._updateItemGrid();
    const aids = store.effectiveAids(e);
    // Prefers the pending pick while the Items popup has one open and
    // uncommitted (same reasoning as _updateItemGrid's own pending
    // fallback) — the ambient ring/shimmer elsewhere on the card stays
    // keyed to the entry's actual committed status, same as Nature/IVs.
    this.$pokerusToggle.toggleAttribute('active', this._pendingPokerus ?? !!e.pokerus);
    const pokerusAvailable = store.pokerusAvailable();
    this.toggleAttribute('pokerus-infected', aids.pokerus);
    if (aids.pokerus) {
      const contracted = e.history.find((h) => h.kind === 'pokerus' && h.active);
      this.$sprite.title = contracted
        ? `Pokérus — contracted ${dayLabel(contracted.timestamp)} — every EV earned from battling is doubled, permanently`
        : 'Pokérus — every EV earned from battling is doubled, permanently';
    } else {
      this.$sprite.title = '';
    }
    this.$pokerusToggle.toggleAttribute('disabled', !pokerusAvailable);
    this.$pokerusNote.hidden = pokerusAvailable;
    this._updateVitaminGrid(e);
    const wingsAvailable = store.wingsAvailable();
    this.$wingsSection.hidden = !wingsAvailable;
    if (wingsAvailable) this._updateWingGrid(e);
    const berriesAvailable = store.berriesAvailable();
    this.$berriesSection.hidden = !berriesAvailable;
    if (berriesAvailable) this._updateBerryGrid(e);
    this.$histLog.entry = e;
    this._renderCompetitive(e);
  }

  /**
   * Species base stats, in the Competitive dialog now rather than next
   * to the EV bars — a fixed number that's the same for every one of
   * this species is the relevant reference when planning which stats to
   * invest EVs into against their own ceiling, not something to check
   * repeatedly next to this specific Pokémon's own current progress.
   * @param {RosterEntry} e @param {boolean} mergedSpecial
   */
  _renderBaseStats(e, mergedSpecial) {
    if (!e.baseStats) {
      this.$competitiveBaseStats.innerHTML = '';
      return;
    }
    // Same Gen I real-Special-stat substitution as the EV bars used to
    // show (gen1-special-stats.js) — the modern spa/spd split isn't a
    // 50/50 divide of the real historical value.
    const bs = mergedSpecial
      ? { ...e.baseStats, spa: gen1SpecialStat(e.speciesId, e.baseStats.spa, e.baseStats.spd), spd: gen1SpecialStat(e.speciesId, e.baseStats.spa, e.baseStats.spd) }
      : e.baseStats;
    this.$competitiveBaseStats.innerHTML = STATS.filter(({ key }) => !(mergedSpecial && key === 'spd'))
      .map(({ key, label }) => {
        const shownLabel = mergedSpecial && key === 'spa' ? 'SPC' : label;
        return `<div class="base-stat-row"><span class="base-stat-label">${escapeHtml(shownLabel)}</span><span class="base-stat-value">${bs[key]}</span></div>`;
      })
      .join('');
  }

  /**
   * Fetches (or reads from lib/smogon-client.js's own cache) this
   * species' current tier and common competitive sets, scoped to the
   * active party's own generation — clamped to Smogon's covered range
   * (1-9), defaulting to the current generation for an unrecognized/ROM
   * hack base game rather than showing nothing. Async and best-effort:
   * offline or a failed fetch just leaves the section showing its empty
   * state, never an error — this is a nice-to-have overlay on top of the
   * app's own offline-first EV tracking, not something it depends on.
   * @param {RosterEntry} e
   */
  async _renderCompetitive(e) {
    const token = ++this._competitiveToken;
    this.$tierBadge.hidden = true;
    this.$tierBadge.classList.remove('tier-badge--danger', 'tier-badge--special', 'tier-badge--illegal');
    // A stale open help-note (from this same badge, on a previous
    // species) would otherwise show that species' tier description
    // after switching — close it rather than let it linger.
    if (this.$tierBadge.getAttribute('aria-expanded') === 'true') {
      const heading = this.$tierBadge.closest('.section-title');
      if (heading?.nextElementSibling?.classList.contains('help-note')) heading.nextElementSibling.remove();
      this.$tierBadge.setAttribute('aria-expanded', 'false');
    }
    this.$competitiveSets.innerHTML = '';
    this.$competitiveEmpty.hidden = true;
    const gen = Math.min(9, Math.max(1, matchGameVersion(store.activeParty?.baseGame)?.gen ?? 9));
    try {
      const [tiers, sets] = await Promise.all([smogon.getTiers(), smogon.getSets(gen)]);
      if (token !== this._competitiveToken) return; // a newer species/render already owns the UI
      const tierInfo = tiers[toShowdownId(e.speciesName)];
      // "No badge" should only ever mean "no data for this species" — an
      // explicit Illegal tier (banned outright, or not yet released in
      // this format) is itself meaningful information, not the same
      // silence as "we don't know." Shown in its own muted color so it
      // doesn't read as just another ranked tier.
      if (tierInfo?.tier) {
        this.$tierBadge.textContent = tierInfo.tier;
        this.$tierBadge.title = TIER_DESCRIPTIONS[tierInfo.tier] || 'A Pokémon Showdown competitive tier.';
        this.$tierBadge.classList.toggle('tier-badge--danger', TIER_DANGER.has(tierInfo.tier));
        this.$tierBadge.classList.toggle('tier-badge--special', TIER_SPECIAL.has(tierInfo.tier));
        this.$tierBadge.classList.toggle('tier-badge--illegal', tierInfo.tier === 'Illegal');
        this.$tierBadge.hidden = false;
      }
      const speciesSets = sets[smogonSetsKey(e.speciesName)];
      if (!speciesSets) {
        this.$competitiveEmpty.hidden = false;
        return;
      }
      const flat = [];
      for (const [format, bySet] of Object.entries(speciesSets)) {
        for (const [setName, set] of Object.entries(bySet)) flat.push({ format, setName, set });
      }
      // Capped at 3 — this is a quick "is this a competitive spread"
      // glance, not a full strategy-dex mirror; the attribution line
      // points to the real thing for anyone who wants more.
      this.$competitiveSets.innerHTML = flat
        .slice(0, 3)
        .map(({ format, setName, set }) => this._competitiveSetHtml(format, setName, set))
        .join('');
    } catch {
      if (token !== this._competitiveToken) return;
      this.$competitiveEmpty.hidden = false;
    }
  }

  /** @param {string} format @param {string} setName @param {any} set @returns {string} */
  _competitiveSetHtml(format, setName, set) {
    // Several of a set's own fields — moves (per-slot), item, nature, and
    // evs — can each be either one value or an array of viable
    // alternatives (Smogon publishes "or" options within a single set,
    // e.g. Chansey's NU set offering two different EV spreads). Only the
    // first alternative is shown here — this card is a quick glance, not
    // a full options list; the attribution line points to the real dex
    // entry for anyone who wants the rest.
    const first = (/** @type {any} */ v) => (Array.isArray(v) ? v[0] : v);
    const moves = (set.moves || []).map(first).slice(0, 4);
    const evs = first(set.evs);
    const evsText = evs
      ? Object.entries(evs)
          .map(([key, value]) => `${value} ${STAT_LABEL[/** @type {StatKey} */ (key)] || key.toUpperCase()}`)
          .join(' / ')
      : '';
    return `
      <div class="competitive-set">
        <p class="competitive-set-title">${escapeHtml(setName)} <span class="competitive-set-format">${escapeHtml(format)}</span></p>
        <p class="competitive-set-line">${[first(set.item), first(set.nature)].filter(Boolean).map(escapeHtml).join(' &middot; ')}</p>
        <p class="competitive-set-line">${escapeHtml(evsText)}</p>
        <p class="competitive-set-moves">${moves.map(escapeHtml).join(', ')}</p>
      </div>
    `;
  }

  // Shows the selected nature's stat effect right under the picker, so
  // beginners don't have to memorize what e.g. "Adamant" does.
  _renderNatureHint() {
    const nature = NATURES.find((n) => n.id === this.$nature.value);
    this.$natureHint.textContent = nature ? natureEffectHint(nature) : '';
  }

  /**
   * The IVs dialog's contents — no toggle of any kind gates this, unlike
   * an earlier version of this feature: reaching it via the "More" menu
   * is the opt-in, the same as the Competitive dialog. Always computed
   * on every render (not just while the dialog happens to be open), so
   * it's ready the instant the menu opens it. Values shown come from
   * `_pendingIvs` while a dialog session is active (docs/adr/0017) —
   * falling back to the entry's real ivs lets this render correctly
   * before `_openIvsDialog` has ever seeded anything, too.
   * @param {RosterEntry} e @param {boolean} statExp
   */
  _renderIvs(e, statExp) {
    // The stat-formula calculator below is only implemented for the
    // modern (Gen III+) IV system so far — Gen I/II's Stat Experience
    // rounding is a distinct, less-documented formula (see store.js's
    // possibleIvsForStat doc comment).
    this.$ivCalc.hidden = statExp;

    const ivs = this._pendingIvs || e.ivs;
    const { max, legacy } = store.ivRange();
    // Sp. Def's row is dropped entirely in Gen I/II — it isn't a second
    // input, it's the same stored value as Sp. Atk (ivRange()'s doc
    // comment), so showing both would look editable when only one is.
    const rows = STATS.filter(({ key }) => !(legacy && key === 'spd'));
    this.$ivGrid.innerHTML = rows
      .map(({ key, label }) => {
        const value = ivs[key];
        const derived = legacy && key === 'hp';
        const displayLabel = legacy && key === 'spa' ? 'SPA/SPD' : label;
        const perfect = value === max;
        const control = derived
          ? `<span class="iv-row-derived">${value == null ? 'unknown' : value} (derived)</span>`
          : `<input type="number" inputmode="numeric" class="ds-field" data-stat="${key}" min="0" max="${max}" value="${value == null ? '' : value}" placeholder="?" aria-label="${escapeHtml(displayLabel)} IV" />`;
        return `<div class="iv-row${perfect ? ' iv-row--perfect' : ''}"><span class="iv-row-label">${escapeHtml(displayLabel)}</span>${control}</div>`;
      })
      .join('');
    this.$ivSummary.hidden = false;
    this._updateIvSummary();
  }

  /**
   * The "N/6 known, M perfect" summary line and each row's perfect
   * highlight, kept live on every field's own change — split out of
   * _renderIvs (which also rebuilds the grid's <input> elements from
   * scratch) specifically so a per-field edit never touches any other
   * field's DOM node; see the grid's 'change' listener for why that
   * matters. Also refreshes the IV calculator hint, same as a full
   * _renderIvs would.
   */
  _updateIvSummary() {
    const e = this._entry;
    const ivs = this._pendingIvs || e.ivs;
    const { max, legacy } = store.ivRange();
    const rows = STATS.filter(({ key }) => !(legacy && key === 'spd'));
    for (const row of this.$ivGrid.children) {
      const input = /** @type {HTMLElement} */ (row).querySelector('input[data-stat]');
      const key = /** @type {HTMLInputElement|null} */ (input)?.dataset.stat;
      if (key) row.classList.toggle('iv-row--perfect', ivs[key] === max);
    }
    const knownValues = rows.map(({ key }) => ivs[key]);
    const knownCount = knownValues.filter((v) => v != null).length;
    const perfectCount = knownValues.filter((v) => v === max).length;
    this.$ivSummary.textContent =
      knownCount === 0
        ? `Enter what you know — 0-${max} per stat.`
        : `${knownCount}/${rows.length} known${perfectCount > 0 ? `, ${perfectCount} perfect (${max})` : ''}.`;
    this._updateIvCalcHint();
  }

  _updateIvCalcHint() {
    const stat = STATS.find((s) => s.key === this.$ivCalcStat.value);
    this.$ivCalcStatName.textContent = stat ? stat.label : '';
    this._renderIvCalcReadings();
    this._renderIvCalcResults();
  }

  /** This stat's logged readings (level + observed value at the time), newest first, each deletable. */
  _renderIvCalcReadings() {
    const statKey = this.$ivCalcStat.value;
    const readings = this._entry.events.filter((ev) => ev.kind === 'stat-reading' && ev.statKey === statKey).reverse();
    this.$ivCalcReadings.innerHTML = readings
      .map(
        (r) =>
          `<li><span>Lv. ${r.level} — ${r.observedStat}</span><button type="button" class="iv-calc-reading-delete" data-id="${r.id}" title="Delete this reading" aria-label="Delete this reading">✕</button></li>`
      )
      .join('');
  }

  /**
   * Renders store.possibleIvsFromReadings as clickable chips — click one
   * to actually set it as this stat's IV. A low level often can't
   * distinguish several adjacent IVs at all (the stat formula's floor()
   * rounds them to the same displayed number), so more than one chip is
   * the normal case, not a bug — $ivCalcNote spells that out instead of
   * leaving a bare wall of numbers to interpret, since a raw candidate
   * list read as confusing/broken in testing without an explanation
   * attached. Nothing to show until at least one reading is logged.
   */
  _renderIvCalcResults() {
    const e = this._entry;
    const statKey = /** @type {StatKey} */ (this.$ivCalcStat.value);
    this.$ivCalcResults.innerHTML = '';
    this.$ivCalcNote.hidden = true;
    const hasReadings = e.events.some((ev) => ev.kind === 'stat-reading' && ev.statKey === statKey);
    if (!hasReadings || !e.baseStats) return;
    const matches = store.possibleIvsFromReadings(e, statKey, e.baseStats[statKey]);
    this.$ivCalcNote.hidden = false;
    if (matches.length === 0) {
      this.$ivCalcNote.textContent =
        'No IV 0-31 fits every reading logged for this stat — one of them was probably mislogged (wrong level/EVs at the time, or a typo). Delete the wrong one below.';
    } else if (matches.length === 1) {
      this.$ivCalcNote.textContent = 'Only one IV fits — tap it to fill it in.';
      this.$ivCalcResults.innerHTML = `<button type="button" class="iv-calc-chip" data-iv="${matches[0]}">${matches[0]}</button>`;
    } else {
      this.$ivCalcNote.textContent = `${matches.length} IVs fit every reading logged so far — that's normal, not an error. Log another reading after this Pokémon levels up (or gains EVs) to narrow it further; tap one below if you already know which from elsewhere (breeding, the IV Judge).`;
      this.$ivCalcResults.innerHTML = matches
        .map((iv) => `<button type="button" class="iv-calc-chip" data-iv="${iv}">${iv}</button>`)
        .join('');
    }
  }

  /** Logs the typed observed stat (at the entry's current level/EVs) as a new reading, then clears the input. */
  _logIvReading() {
    const e = this._entry;
    const statKey = /** @type {StatKey} */ (this.$ivCalcStat.value);
    const observed = Number(this.$ivCalcObserved.value);
    if (!observed || !e.baseStats) return;
    store.logStatReading(e.uid, statKey, observed);
    this.$ivCalcObserved.value = '';
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
    this._openDialog(this.$levelUpDialog);
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
   * Commits any pending Evolve/Undo choice first (the one network step
   * here — see evolution-chain.js's `commit()`), then the level, then
   * every filled-in stat row (at that now-current level), then closes.
   * A failed commit leaves the dialog open with its own error message
   * shown instead of closing over a Save that didn't fully apply. The
   * level and every stat reading share one batchId (not the evolve,
   * which stays its own prominent entry) so ev-history-log.js collapses
   * them into a single summarized entry instead of one row per stat.
   */
  async _saveLevelUp() {
    const e = this._entry;
    try {
      await this.$levelUpEvoChain.commit();
    } catch {
      return;
    }
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
      const fedCount = e.history.filter((h) => h.kind === 'vitamin' && h.vitaminId === v.id).length;
      const pendingCount = this._pendingApplies.filter((p) => p.kind === 'vitamin' && p.id === v.id).length;
      const capped = cappedByCutoff || cappedByCeiling || cappedByStatCap;
      const fedNote = fedCount ? ` — fed ${fedCount}×` : '';
      const pendingNote = pendingCount ? ` — ${pendingCount}× queued` : '';
      const title = capped
        ? (cappedByCutoff
            ? `This game stops vitamins once ${statLabel} has ${VITAMIN_STAT_CUTOFF}+ EVs`
            : cappedByCeiling
              ? `Vitamins stop working once ${statLabel} has ${STAT_EXP_VITAMIN_CEILING}+ Stat Experience`
              : `${statLabel} is already at the ${statCap} cap`) + fedNote + pendingNote
        : `Feed ${v.label} — raises ${statLabel} by up to ${bonus}` + fedNote + pendingNote;
      const boost = pendingCount ? `+${bonus} ${statLabel} · ${pendingCount}× queued` : `+${bonus} ${statLabel}`;
      return { id: v.id, label: v.label, sprite: v.sprite, boost, title, capped, disabled: capped, count: fedCount };
    });
  }

  // Same shape as vitamins, minus the 100-EV-cutoff framing — Wings
  // never have one. See `_updateVitaminGrid`'s own comment for the
  // simulated-EVs/queued-count/disabled reasoning, shared here.
  _updateWingGrid(e) {
    const simEvs = this._simulatedEvs();
    this.$wingGrid.items = SORTED_FEATHERS.map((f) => {
      const stat = simEvs[f.stat];
      const capped = stat >= 252;
      const fedCount = e.history.filter((h) => h.kind === 'feather' && h.featherId === f.id).length;
      const pendingCount = this._pendingApplies.filter((p) => p.kind === 'feather' && p.id === f.id).length;
      const fedNote = fedCount ? ` — fed ${fedCount}×` : '';
      const pendingNote = pendingCount ? ` — ${pendingCount}× queued` : '';
      const title = capped
        ? `${STAT_LABEL[f.stat]} is already at the 252 cap` + fedNote + pendingNote
        : `Feed ${f.label} — raises ${STAT_LABEL[f.stat]} EVs by ${FEATHER_BONUS}` + fedNote + pendingNote;
      const boost = pendingCount ? `+${FEATHER_BONUS} ${STAT_LABEL[f.stat]} · ${pendingCount}× queued` : `+${FEATHER_BONUS} ${STAT_LABEL[f.stat]}`;
      return { id: f.id, label: f.label, sprite: f.sprite, boost, title, capped, disabled: capped, count: fedCount };
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
      const fedCount = e.history.filter((h) => h.kind === 'berry' && h.berryId === b.id).length;
      const pendingCount = this._pendingApplies.filter((p) => p.kind === 'berry' && p.id === b.id).length;
      const fedNote = fedCount ? ` — fed ${fedCount}×` : '';
      const pendingNote = pendingCount ? ` — ${pendingCount}× queued` : '';
      const title = capped
        ? `${STAT_LABEL[b.stat]} is already at 0` + fedNote + pendingNote
        : `Feed ${b.label} — removes up to ${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]} EVs` + fedNote + pendingNote;
      const boost = pendingCount ? `−${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]} · ${pendingCount}× queued` : `−${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]}`;
      return { id: b.id, label: b.label, sprite: b.sprite, boost, title, capped, disabled: capped, count: fedCount };
    });
  }
}
customElements.define('caught-pokemon-detail', CaughtPokemonDetail);
