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
        .nature-prefix {
          font-family: var(--font-display); font-weight: 500; font-size: var(--font-size-input);
          color: var(--ink-soft); white-space: nowrap;
        }
        /* Same height as the sprite and top-aligned with it, so the name
           sits level with the sprite's top edge instead of floating in a
           taller, vertically-centered box. */
        .titles {
          grid-area: titles; align-self: start; min-width: 0;
          height: 64px; display: flex; flex-direction: column; justify-content: space-between;
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
        .level-up-btn:hover:not(:disabled) { color: var(--teal); border-color: var(--teal); }
        .level-up-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .level-up-btn svg { width: 11px; height: 11px; color: var(--teal); }
        .level-up-btn:disabled svg { color: inherit; }
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

        /* An inline item in .meta now, not its own row — flex-wrap here
           lets its own pills wrap independently if they run out of room. */
        .status-row { display: inline-flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
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

        /* Dialog chrome comes from the shared .ds-dialog, its header
           from .ds-dialog-header; only the grid layout of this dialog's
           own sections lives here. The grid's gap already spaces the
           header from the first section, so the shared bottom margin
           would double up. */
        .more-dialog { gap: var(--space-5); }
        .more-dialog:not([open]) { display: none; }
        .more-dialog[open] { display: grid; }
        .more-dialog .ds-dialog-header { margin-bottom: 0; }
        /* The dialog grew a lot (Wings/Berries/Exp. Share on top of the
           original sections) — on screens with room to spare, widen it
           and flow its sections into two columns instead of one long
           single-column scroll. The header, evolution chain (its own
           variable-width content) and release button stay full-width. */
        @media (min-width: 760px) {
          /* Compound selector (not just .more-dialog), so this reliably
             beats the shared .ds-dialog width at equal specificity
             regardless of adoptedStyleSheets vs. shadow-tree <style>
             ordering — same reasoning as .status-pill--item elsewhere. */
          .more-dialog.ds-dialog { width: min(720px, calc(100vw - 2.4rem)); }
          .more-dialog[open] { grid-template-columns: 1fr 1fr; column-gap: var(--space-5); }
          .more-dialog .ds-dialog-header,
          .more-dialog .evolve-panel,
          .more-dialog .release {
            grid-column: 1 / -1;
          }
        }
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
        .release {
          display: inline-flex; align-items: center; justify-content: center; gap: 0.35em;
          border: 1px solid var(--lcd-line); background: transparent; cursor: pointer; width: 100%;
          border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: 600;
          color: var(--poke-red-dark); padding: var(--space-3);
        }
        .release:hover { color: var(--poke-red); border-color: var(--poke-red); }

        .card-body { display: grid; gap: var(--space-5); }
        @media (min-width: 760px) {
          .card-body { grid-template-columns: minmax(240px, 360px) 1fr; align-items: start; }
        }
        .card-col { display: grid; gap: var(--space-4); align-content: start; }

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

        .details-section { display: grid; gap: var(--space-3); }
        .details-section .field-inline {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
          font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .details-section .field-inline select,
        .details-section .field-inline input { width: auto; flex: 1 1 auto; max-width: 14em; }
        .nature-hint {
          margin: calc(-1 * var(--space-2)) 0 0; font-family: var(--font-mono);
          font-size: var(--font-size-2xs); color: var(--ink-soft); text-align: right;
        }
        .nature-hint:empty { display: none; }

        .ivs { display: grid; gap: var(--space-2); }
        .iv-grid { display: grid; gap: var(--space-2); }
        .iv-row {
          display: grid; grid-template-columns: 3.5em 1fr; align-items: center; gap: var(--space-2);
          font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .iv-row-label { font-family: var(--font-mono); }
        .iv-row input { width: auto; }
        .iv-row-derived {
          font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft);
          text-align: right; padding-right: var(--space-2);
        }
        .iv-row--perfect .iv-row-label { color: var(--teal); }
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

        .aids { display: grid; gap: var(--space-2); }

        .vitamins, .wings, .berries { display: grid; gap: var(--space-2); }
        .vitamin-status, .wing-status, .berry-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }

        /* Exp. Share and Pokérus are both a single toggle button plus a
           title — light enough to sit side by side at any dialog width,
           not just once the dialog itself goes two-column. */
        .exp-pokerus-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); align-items: start; }

        .pokerus-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
        .pokerus-icon { width: 22px; height: 22px; flex: 0 0 auto; display: inline-flex; color: var(--pokerus-purple); }
        .pokerus-icon svg { width: 100%; height: 100%; }

        .exp-share-section { display: grid; gap: var(--space-2); justify-items: stretch; min-width: 0; }
        .pokerus-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }

        .evolve-panel { display: grid; gap: var(--space-2); }

        .competitive-panel { display: grid; gap: var(--space-2); }
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

        .battle { display: grid; gap: var(--space-2); }
        .status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--poke-red-dark); min-height: 1em; }
      </style>
      <article class="card">
        <header>
          <img class="sprite" alt="" />
          <div class="titles">
            <div class="name-row">
              <span class="species-num"></span>
              <span class="nature-prefix" hidden></span>
              <input class="nickname" aria-label="Nickname" />
            </div>
            <div class="meta">
              <span class="species" hidden></span>
              <button class="level-up-btn" type="button" title="Level up (+1)">
                <span class="level-value"></span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
              </button>
              <div class="status-row" hidden></div>
            </div>
          </div>
          <div class="more-btn-wrap">
            <button class="more-btn ds-btn ds-btn--outline ds-btn--sm" type="button" title="More" aria-label="More" aria-haspopup="menu" aria-expanded="false">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="17.5" r="1.7"/></svg>
              <span class="more-btn-label">More</span>
            </button>
            <div class="more-menu" role="menu" aria-label="More" hidden>
              <button class="more-menu-item" type="button" role="menuitem" data-open="training">Training &amp; EVs</button>
              <button class="more-menu-item" type="button" role="menuitem" data-open="ivs">IVs</button>
              <button class="more-menu-item" type="button" role="menuitem" data-open="competitive">Competitive</button>
            </div>
          </div>
        </header>

        <dialog class="more-dialog ds-dialog">
          <header class="ds-dialog-header">
            <h2>Training &amp; EVs</h2>
            <button class="more-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>

          <!--
            Level & nature always leads — it's the one section that's
            identity, not a training mechanic, so it isn't part of the
            generation ordering below. Everything after it is ordered by
            the generation each mechanic was introduced in (Vitamins/
            Exp. Share Gen I, Pokérus Gen II, Macho Brace/EV-reducing
            berries Gen III, Power items Gen IV, Wings Gen V), not by
            feature-add order — a fixed, predictable position beats a
            "newest at the bottom" list once there are this many.
            Evolution isn't generation-gated, so it stays last, ahead of
            Release.
          -->
          <section class="details-section">
            <h3 class="section-title">Level &amp; nature
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What is EV training?" title="EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.">?</button>
            </h3>
            <label class="field-inline">Level
              <input type="number" inputmode="numeric" pattern="[0-9]*" class="level-input ds-field" min="${MIN_LEVEL}" max="${MAX_LEVEL}" aria-label="Level" />
            </label>
            <label class="field-inline nature-field" hidden>Nature
              <select class="nature-select ds-field" aria-label="Nature"></select>
            </label>
            <p class="nature-hint" aria-live="polite"></p>
          </section>


          <section class="vitamins">
            <h3 class="section-title">Vitamins
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What do vitamins do?" title="Vitamins (HP Up, Protein, Iron, Calcium, Zinc, Carbos) instantly add EVs to one stat without battling — a quick way to top off a stat. Each only works until that stat has 100 EVs from any source; after that, only battling, items, or Pokérus can push it further toward the 252 cap.">?</button>
            </h3>
            <item-button-grid class="vitamin-grid"></item-button-grid>
            <p class="vitamin-status" aria-live="polite"></p>
          </section>

          <div class="exp-pokerus-row">
            <section class="exp-share-section">
              <h3 class="section-title">Exp. Share
                <button type="button" class="help-btn" aria-expanded="false" aria-label="What does Exp. Share do?" title="While holding an Exp. Share, this Pokémon also earns EVs whenever any other Pokémon in this party has a battle logged — the same base amount that Pokémon got, doubled by this Pokémon's own Pokérus if it has any. It never inherits the other Pokémon's held item bonus.">?</button>
              </h3>
              <ds-item-button class="exp-share-toggle-btn" icon="${EXP_SHARE_SPRITE}" label="Exp. Share" boost="Shares other EVs"></ds-item-button>
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
          </div>

          <section class="aids">
            <h3 class="section-title">Training item
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What do training items do?" title="Held items that speed up EV gains from battling. The Macho Brace doubles every EV earned in battle for any stat. A Power item instead adds a flat bonus to one specific stat every battle, on top of whatever that battle normally gives.">?</button>
            </h3>
            <item-button-grid class="item-grid" columns="2"></item-button-grid>
          </section>

          <section class="berries">
            <h3 class="section-title">EV-reducing berries
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What do EV-reducing berries do?" title="Pomeg, Kelpsy, Qualot, Hondew, Grepa and Tamato berries remove 10 EVs from one stat — useful for undoing a mis-trained stat. Floors at 0.">?</button>
            </h3>
            <item-button-grid class="berry-grid"></item-button-grid>
            <p class="berry-status" aria-live="polite"></p>
          </section>

          <section class="wings">
            <h3 class="section-title">Wings
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What do Wings do?" title="Wings (Health, Muscle, Resist, Genius, Clever, Swift) instantly add 1 EV to one stat without battling. Unlike vitamins, there's no 100-EV cutoff — they work all the way to the 252 cap.">?</button>
            </h3>
            <item-button-grid class="wing-grid"></item-button-grid>
            <p class="wing-status" aria-live="polite"></p>
          </section>

          <div class="evolve-panel">
            <h3 class="section-title">Evolution</h3>
            <evolution-chain></evolution-chain>
          </div>

          <button class="release" title="Release this Pokémon" aria-label="Release this Pokémon">
            <span aria-hidden="true">↪</span> Release this Pokémon
          </button>
        </dialog>

        <dialog class="iv-dialog ds-dialog">
          <header class="ds-dialog-header">
            <h2>IVs
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
            <p class="iv-calc-hint">Check this Pokémon's actual <em class="iv-calc-stat-name"></em> stat right now (its summary screen in-game) and enter it below — uses its current level and EVs, so check it now rather than typing in an old reading.</p>
            <div class="iv-calc-fields">
              <select class="iv-calc-stat ds-field" aria-label="Stat"></select>
              <input type="number" inputmode="numeric" class="iv-calc-observed ds-field" min="1" aria-label="Observed stat value" placeholder="Actual stat" />
              <button type="button" class="ds-btn ds-btn--ghost iv-calc-btn">Find IV</button>
            </div>
            <p class="iv-calc-note" aria-live="polite" hidden></p>
            <div class="iv-calc-results" aria-live="polite"></div>
          </details>
        </dialog>

        <dialog class="competitive-dialog ds-dialog">
          <header class="ds-dialog-header">
            <h2>Competitive</h2>
            <button class="competitive-dialog-close ds-dialog-close" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <div class="competitive-panel">
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

          <div class="card-col card-col--right">
            <section class="battle">
              <h3 class="section-title">Log a battle
                <button type="button" class="help-btn" aria-expanded="false" aria-label="What about Exp. Share?" title="Holding an Exp. Share doesn't change how EVs work here — a Pokémon that gets EVs via Exp. Share earns exactly what it would from fighting directly. Just log the defeat here for this Pokémon too, whether or not it was the one that actually battled.">?</button>
              </h3>
              <pokemon-search placeholder="Defeated Pokémon…" show-ev-yield></pokemon-search>
              <p class="status" aria-live="polite"></p>
            </section>

            <ev-history-log></ev-history-log>
          </div>
        </div>
      </article>
    `;

    this.$sprite = shadow.querySelector('.sprite');
    this.$speciesNum = shadow.querySelector('.species-num');
    this.$nickname = shadow.querySelector('.nickname');
    this.$species = shadow.querySelector('.species');
    this.$levelValue = shadow.querySelector('.level-value');
    this.$levelUpBtn = shadow.querySelector('.level-up-btn');
    this.$levelInput = shadow.querySelector('.level-input');
    this.$natureField = shadow.querySelector('.nature-field');
    this.$nature = shadow.querySelector('.nature-select');
    this.$natureHint = shadow.querySelector('.nature-hint');
    this.$naturePrefix = shadow.querySelector('.nature-prefix');
    this.$ivDialog = shadow.querySelector('.iv-dialog');
    this.$ivDialogClose = shadow.querySelector('.iv-dialog-close');
    this.$ivGrid = shadow.querySelector('.iv-grid');
    this.$ivSummary = shadow.querySelector('.iv-summary');
    this.$ivCalc = shadow.querySelector('.iv-calc');
    this.$ivCalcStatName = shadow.querySelector('.iv-calc-stat-name');
    this.$ivCalcStat = shadow.querySelector('.iv-calc-stat');
    this.$ivCalcObserved = shadow.querySelector('.iv-calc-observed');
    this.$ivCalcBtn = shadow.querySelector('.iv-calc-btn');
    this.$ivCalcNote = shadow.querySelector('.iv-calc-note');
    this.$ivCalcResults = shadow.querySelector('.iv-calc-results');
    this.$ivCalcStat.innerHTML = STATS.map(({ key, label }) => `<option value="${key}">${label}</option>`).join('');
    this.$statusRow = shadow.querySelector('.status-row');
    this.$moreBtnWrap = shadow.querySelector('.more-btn-wrap');
    this.$moreBtn = shadow.querySelector('.more-btn');
    this.$moreMenu = shadow.querySelector('.more-menu');
    this.$moreDialog = shadow.querySelector('.more-dialog');
    this.$moreDialogClose = shadow.querySelector('.more-dialog-close');
    this.$competitiveDialog = shadow.querySelector('.competitive-dialog');
    this.$competitiveDialogClose = shadow.querySelector('.competitive-dialog-close');
    this.$release = shadow.querySelector('.release');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$itemGrid = shadow.querySelector('.item-grid');
    this.$pokerusToggle = shadow.querySelector('.pokerus-toggle-btn');
    this.$pokerusNote = shadow.querySelector('.pokerus-note');
    this.$expShareToggle = shadow.querySelector('.exp-share-toggle-btn');
    this.$vitaminGrid = shadow.querySelector('.vitamin-grid');
    this.$vitaminStatus = shadow.querySelector('.vitamin-status');
    this.$evHelpBtn = shadow.querySelector('.details-section .help-btn');
    this.$vitaminHelpBtn = shadow.querySelector('.vitamins .help-btn');
    this.$wingsSection = shadow.querySelector('.wings');
    this.$wingGrid = shadow.querySelector('.wing-grid');
    this.$wingStatus = shadow.querySelector('.wing-status');
    this.$berriesSection = shadow.querySelector('.berries');
    this.$berryGrid = shadow.querySelector('.berry-grid');
    this.$berryStatus = shadow.querySelector('.berry-status');
    this.$evoChain = shadow.querySelector('evolution-chain');
    this.$tierBadge = shadow.querySelector('.tier-badge');
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

    this._spriteFallback = wireSpriteFallback(this.$sprite);

    this.$nature.innerHTML = natureOptionsHtml();
    this._wireEvents();
  }

  // Rebuilt on every render (not just once) because which items are even
  // offered — and the Power item bonus shown — depends on the entry's
  // party's game version, and this one component instance is reused
  // across different parties as the user navigates. Each button applies
  // its item immediately on click (clicking the active one again clears
  // it) — there's no separate "None" option or save step.
  _updateItemGrid() {
    const bonus = store.powerItemBonus();
    const availability = store.trainingItemAvailability();
    const selected = this._entry.machoBrace ? 'macho-brace' : this._entry.powerItem || '';

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
    this.$nickname.addEventListener('change', () => {
      store.renamePokemon(this._entry.uid, this.$nickname.value.trim());
    });
    this.$levelUpBtn.addEventListener('click', () => {
      store.setLevel(this._entry.uid, this._entry.level + 1);
    });
    this.$levelInput.addEventListener('change', () => {
      store.setLevel(this._entry.uid, this.$levelInput.value);
    });
    this.$nature.addEventListener('change', () => {
      store.setNature(this._entry.uid, this.$nature.value || null);
      this._renderNatureHint();
    });
    // Delegated: the grid's number inputs are rebuilt every render (one
    // per stat, fewer in Gen I/II — see _renderIvs), so a single listener
    // here outlives any individual input the way the per-field ones above
    // can't.
    this.$ivGrid.addEventListener('change', (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const statKey = input?.dataset?.stat;
      if (!statKey) return;
      store.setIv(this._entry.uid, /** @type {StatKey} */ (statKey), input.value === '' ? null : Number(input.value));
    });
    this.$ivCalcStat.addEventListener('change', () => this._updateIvCalcHint());
    this.$ivCalcBtn.addEventListener('click', () => this._runIvCalculator());
    this.$ivCalcResults.addEventListener('click', (e) => {
      const chip = /** @type {HTMLElement} */ (e.target).closest('.iv-calc-chip');
      if (!chip) return;
      store.setIv(this._entry.uid, /** @type {StatKey} */ (this.$ivCalcStat.value), Number(chip.dataset.iv));
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
      if (item.dataset.open === 'training') this._openDialog(this.$moreDialog);
      else if (item.dataset.open === 'ivs') this._openDialog(this.$ivDialog);
      else if (item.dataset.open === 'competitive') this._openDialog(this.$competitiveDialog);
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
    // a backdrop click.
    this.$moreDialog.addEventListener('close', () => this._onDialogClosed());
    this.$moreDialogClose.addEventListener('click', () => this.$moreDialog.close());
    this.$moreDialog.addEventListener('click', (e) => {
      if (e.target === this.$moreDialog) this.$moreDialog.close();
    });
    this.$competitiveDialog.addEventListener('close', () => this._onDialogClosed());
    this.$competitiveDialogClose.addEventListener('click', () => this.$competitiveDialog.close());
    this.$competitiveDialog.addEventListener('click', (e) => {
      if (e.target === this.$competitiveDialog) this.$competitiveDialog.close();
    });
    this.$ivDialog.addEventListener('close', () => this._onDialogClosed());
    this.$ivDialogClose.addEventListener('click', () => this.$ivDialog.close());
    this.$ivDialog.addEventListener('click', (e) => {
      if (e.target === this.$ivDialog) this.$ivDialog.close();
    });
    // The "?" buttons toggle their explanation inline: title tooltips are
    // hover-only, which leaves them unreachable on touch devices. Listens
    // on the shadow root, not just $moreDialog, since the battle
    // section's own help button (Exp. Share) lives outside that dialog.
    this.shadowRoot.addEventListener('click', (e) => {
      const btn = e.target.closest('.help-btn');
      if (!btn) return;
      const heading = btn.closest('.section-title');
      const next = heading.nextElementSibling;
      if (next?.classList.contains('help-note')) {
        next.remove();
        btn.setAttribute('aria-expanded', 'false');
      } else {
        const note = document.createElement('p');
        note.className = 'help-note';
        note.textContent = btn.title;
        heading.after(note);
        btn.setAttribute('aria-expanded', 'true');
      }
    });
    this.$release.addEventListener('click', () => {
      const label = titleCase(this._entry.nickname || this._entry.speciesName);
      if (confirm(`Release ${label}? Its EV log will be deleted.`)) {
        this.$moreDialog.close();
        store.releasePokemon(this._entry.uid);
      }
    });
    this.$itemGrid.addEventListener('item-pick', (e) => {
      const val = e.detail.id;
      const selected = this._entry.machoBrace ? 'macho-brace' : this._entry.powerItem || '';
      if (val === selected) {
        store.setPowerItem(this._entry.uid, null); // clicking the active item again clears it
      } else if (val === 'macho-brace') {
        store.setMachoBrace(this._entry.uid, true);
      } else {
        store.setPowerItem(this._entry.uid, val);
      }
    });
    this.$pokerusToggle.addEventListener('pick', () => {
      store.setPokerus(this._entry.uid, !this.$pokerusToggle.hasAttribute('active'));
    });
    this.$expShareToggle.addEventListener('pick', () => {
      store.setExpShare(this._entry.uid, !this.$expShareToggle.hasAttribute('active'));
    });
    this.$vitaminGrid.addEventListener('item-pick', (e) => this._useVitamin(e.detail.id));
    this.$wingGrid.addEventListener('item-pick', (e) => this._useFeather(e.detail.id));
    this.$berryGrid.addEventListener('item-pick', (e) => this._useBerry(e.detail.id));
    this.$search.addEventListener('pokemon-pick', (e) => {
      this._battle(e.detail.name, 'Looking up battle data…');
    });
    this.$histLog.addEventListener('redefeat', (e) => {
      this._battle(e.detail.name, `Re-logging battle vs ${titleCase(e.detail.name)}…`);
    });
  }

  /** @param {HTMLDialogElement} dialog */
  _openDialog(dialog) {
    dialog.showModal();
    // styles.css's html:has(dialog[open]) scroll lock can't see into
    // this shadow root, so flag the open state on <html> ourselves.
    document.documentElement.dataset.modalOpen = '';
    if (dialog === this.$moreDialog) this.$evoChain.load();
  }

  _onDialogClosed() {
    delete document.documentElement.dataset.modalOpen;
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

  /** Feeds one vitamin and reports exactly which stat moved and by how much. */
  _useVitamin(vitaminId) {
    const vitamin = VITAMINS.find((v) => v.id === vitaminId);
    const result = store.useVitamin(this._entry.uid, vitaminId);
    if (!result || !vitamin) return;
    const statLabel = result.linkedStat ? 'SPC' : STAT_LABEL[vitamin.stat];
    const noun = store.usesStatExpSystem() ? 'Stat Experience' : 'EVs';
    if (result.applied) {
      this.$vitaminStatus.textContent = `${vitamin.label}: +${result.applied} ${statLabel}`;
    } else if (result.blockedByCutoff) {
      this.$vitaminStatus.textContent = `${vitamin.label}: no ${noun} gained — this game stops vitamins once ${statLabel} has ${VITAMIN_STAT_CUTOFF}+ EVs`;
    } else if (result.blockedByCeiling) {
      this.$vitaminStatus.textContent = `${vitamin.label}: no ${noun} gained — vitamins stop working once ${statLabel} has ${STAT_EXP_VITAMIN_CEILING}+ Stat Experience`;
    } else {
      this.$vitaminStatus.textContent = `${vitamin.label}: no ${noun} gained — ${statLabel} is already maxed out`;
    }
  }

  /** Feeds one Wing and reports exactly which stat moved and by how much. */
  _useFeather(featherId) {
    const feather = FEATHERS.find((f) => f.id === featherId);
    const result = store.useFeather(this._entry.uid, featherId);
    if (!result || !feather) return;
    this.$wingStatus.textContent = result.applied
      ? `${feather.label}: +${result.applied} ${STAT_LABEL[feather.stat]}`
      : `${feather.label}: no EVs gained — ${STAT_LABEL[feather.stat]} is already maxed out`;
  }

  /** Feeds one EV-reducing berry and reports exactly which stat moved and by how much. */
  _useBerry(berryId) {
    const berry = EV_BERRIES.find((b) => b.id === berryId);
    const result = store.useBerry(this._entry.uid, berryId);
    if (!result || !berry) return;
    this.$berryStatus.textContent = result.applied
      ? `${berry.label}: −${result.applied} ${STAT_LABEL[berry.stat]}`
      : `${berry.label}: no EVs removed — ${STAT_LABEL[berry.stat]} is already at 0`;
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    const modernSprite = e.sprite || FALLBACK_SPRITE;
    const versioned = versionedSpriteUrl(store.spriteBaseGame(), e.speciesId);
    this._spriteFallback.setVersionedSprite(versioned, modernSprite);
    this.$nickname.value = e.nickname || titleCase(e.speciesName);
    this.$speciesNum.textContent = `#${String(e.speciesId).padStart(3, '0')}`;
    // The species name only earns a second mention when a nickname is
    // hiding it — with no nickname the title already reads e.g. "#169
    // Crobat", so repeating "Crobat" below it would say nothing new.
    this.$species.hidden = !e.nickname;
    this.$species.textContent = e.nickname ? titleCase(e.speciesName) : '';
    this.$levelValue.textContent = `Lv. ${e.level}`;
    this.$levelUpBtn.disabled = e.level >= MAX_LEVEL;
    this.$levelInput.value = e.level;
    const natureAvailable = store.natureAvailable();
    this.$natureField.hidden = !natureAvailable;
    if (natureAvailable) this.$nature.value = e.nature || '';
    this._renderNatureHint();
    const nature = natureAvailable ? NATURES.find((n) => n.id === e.nature) : null;
    this._renderNatureBadge(nature, natureAvailable);
    this._renderStatusBadges(e);
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
    // The caught mon's own modern spa/spd isn't a 50/50 split of Gen I's
    // single Special stat (see gen1-special-stats.js) — show the real
    // historical value in the merged "Base SPC" label instead.
    this.$evSummary.baseStats =
      mergedSpecial && e.baseStats
        ? { ...e.baseStats, spa: gen1SpecialStat(e.speciesId, e.baseStats.spa, e.baseStats.spd), spd: gen1SpecialStat(e.speciesId, e.baseStats.spa, e.baseStats.spd) }
        : e.baseStats;
    this.$evSummary.nature = nature;
    this.$evSummary.statCap = store.statCap();
    this.$evSummary.totalCap = totalCap;
    this.$evSummary.mergedSpecial = mergedSpecial;
    this.$evHelpBtn.title = statExp
      ? "Stat Experience is this game's hidden bonus stat pool — up to 65,535 per stat, gained mainly from battling (equal to the defeated Pokémon's own base stat). Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change Stat Experience, but training the stat your nature already boosts gets the most out of your points."
      : "EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.";
    this.$vitaminHelpBtn.title = statExp
      ? `Vitamins (HP Up, Protein, Iron, Calcium, Carbos) instantly add ${STAT_EXP_VITAMIN_BONUS} Stat Experience to one stat without battling — but only work until that stat has ${STAT_EXP_VITAMIN_CEILING} Stat Experience from any source (battling included); after that, only battling can push it further toward the 65,535 cap.`
      : 'Vitamins (HP Up, Protein, Iron, Calcium, Zinc, Carbos) instantly add EVs to one stat without battling — a quick way to top off a stat. Each only works until that stat has 100 EVs from any source; after that, only battling, items, or Pokérus can push it further toward the 252 cap.';

    const trained = totalCap != null && totalEvs(e.evs) >= totalCap;
    this.toggleAttribute('fully-trained', trained);

    this._renderIvs(e, statExp);
    this._updateItemGrid();
    const aids = store.effectiveAids(e);
    const pokerusActive = !!e.pokerus;
    this.$pokerusToggle.toggleAttribute('active', pokerusActive);
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
    const expShareActive = !!e.expShare;
    this.$expShareToggle.toggleAttribute('active', expShareActive);
    this.$vitaminStatus.textContent = '';
    this._updateVitaminGrid(e);
    const wingsAvailable = store.wingsAvailable();
    this.$wingsSection.hidden = !wingsAvailable;
    this.$wingStatus.textContent = '';
    if (wingsAvailable) this._updateWingGrid(e);
    const berriesAvailable = store.berriesAvailable();
    this.$berriesSection.hidden = !berriesAvailable;
    this.$berryStatus.textContent = '';
    if (berriesAvailable) this._updateBerryGrid(e);
    this.$evoChain.entry = e;
    this.$histLog.entry = e;
    this._renderCompetitive(e);
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
   * it's ready the instant the menu opens it.
   * @param {RosterEntry} e @param {boolean} statExp
   */
  _renderIvs(e, statExp) {
    // The stat-formula calculator below is only implemented for the
    // modern (Gen III+) IV system so far — Gen I/II's Stat Experience
    // rounding is a distinct, less-documented formula (see store.js's
    // possibleIvsForStat doc comment).
    this.$ivCalc.hidden = statExp;

    const { max, legacy } = store.ivRange();
    // Sp. Def's row is dropped entirely in Gen I/II — it isn't a second
    // input, it's the same stored value as Sp. Atk (ivRange()'s doc
    // comment), so showing both would look editable when only one is.
    const rows = STATS.filter(({ key }) => !(legacy && key === 'spd'));
    this.$ivGrid.innerHTML = rows
      .map(({ key, label }) => {
        const value = e.ivs[key];
        const derived = legacy && key === 'hp';
        const displayLabel = legacy && key === 'spa' ? 'SPA/SPD' : label;
        const perfect = value === max;
        const control = derived
          ? `<span class="iv-row-derived">${value == null ? 'unknown' : value} (derived)</span>`
          : `<input type="number" inputmode="numeric" class="ds-field" data-stat="${key}" min="0" max="${max}" value="${value == null ? '' : value}" placeholder="?" aria-label="${escapeHtml(displayLabel)} IV" />`;
        return `<div class="iv-row${perfect ? ' iv-row--perfect' : ''}"><span class="iv-row-label">${escapeHtml(displayLabel)}</span>${control}</div>`;
      })
      .join('');

    const knownValues = rows.map(({ key }) => e.ivs[key]);
    const knownCount = knownValues.filter((v) => v != null).length;
    const perfectCount = knownValues.filter((v) => v === max).length;
    this.$ivSummary.hidden = false;
    this.$ivSummary.textContent =
      knownCount === 0
        ? `Enter what you know — 0-${max} per stat.`
        : `${knownCount}/${rows.length} known${perfectCount > 0 ? `, ${perfectCount} perfect (${max})` : ''}.`;

    this._updateIvCalcHint();
  }

  _updateIvCalcHint() {
    const stat = STATS.find((s) => s.key === this.$ivCalcStat.value);
    this.$ivCalcStatName.textContent = stat ? stat.label : '';
  }

  /**
   * Runs store.possibleIvsForStat against the typed observed stat and
   * renders every candidate as a clickable chip — click one to actually
   * set it as this stat's IV. A low level often can't distinguish
   * several adjacent IVs at all (the stat formula's floor() rounds them
   * to the same displayed number), so more than one chip is the normal
   * case, not a bug — $ivCalcNote spells that out instead of leaving a
   * bare wall of numbers to interpret, since a raw candidate list read
   * as confusing/broken in testing without an explanation attached.
   */
  _runIvCalculator() {
    const e = this._entry;
    const statKey = /** @type {StatKey} */ (this.$ivCalcStat.value);
    const observed = Number(this.$ivCalcObserved.value);
    this.$ivCalcResults.innerHTML = '';
    this.$ivCalcNote.hidden = true;
    if (!observed || !e.baseStats) return;
    const matches = store.possibleIvsForStat(e, statKey, observed, e.baseStats[statKey]);
    this.$ivCalcNote.hidden = false;
    if (matches.length === 0) {
      this.$ivCalcNote.textContent =
        "No IV 0-31 reproduces that stat at its current level/EVs — double check the number, and that you checked it just now (not from an earlier level).";
    } else if (matches.length === 1) {
      this.$ivCalcNote.textContent = 'Only one IV fits — tap it to fill it in.';
      this.$ivCalcResults.innerHTML = `<button type="button" class="iv-calc-chip" data-iv="${matches[0]}">${matches[0]}</button>`;
    } else {
      this.$ivCalcNote.textContent = `${matches.length} IVs all produce this exact stat at the current level — that's normal, not an error. Leveling up (more EVs) narrows it; tap one below if you already know which from elsewhere (breeding, the IV Judge).`;
      this.$ivCalcResults.innerHTML = matches
        .map((iv) => `<button type="button" class="iv-calc-chip" data-iv="${iv}">${iv}</button>`)
        .join('');
    }
  }

  // The nature badge sits under the sprite, always visible (not tucked
  // in the More dialog) since it's a fixed trait worth seeing at a
  // glance, phrased the way the games do: "Adamant Slowpoke". Unset
  // natures show nothing here — the More dialog's Nature select is
  // where absence reads as a fact rather than a mystery word.
  _renderNatureBadge(nature, natureAvailable) {
    const show = natureAvailable && Boolean(nature);
    this.$naturePrefix.hidden = !show;
    if (!show) return;
    this.$naturePrefix.textContent = nature.label;
    this.$naturePrefix.title = `${nature.label} nature — ${natureEffectHint(nature)}`;
  }

  // Badges next to the identity fields so the currently-held training
  // item and Pokérus status are visible on the page itself, not just
  // buried in the More dialog that hides them. Mirrors the modal's own
  // item-button style — a sprite plus which EV it's boosting — so the
  // same item reads the same way in both places. Reads through
  // store.effectiveAids, so an item the party's rules don't support
  // (e.g. a Macho Brace left over from before the game version was
  // edited) shows as "No item" — matching the fact that it no longer
  // applies — rather than claiming a bonus that isn't granted.
  _renderStatusBadges(e) {
    const aids = store.effectiveAids(e);
    const badges = [];
    if (aids.machoBrace) {
      badges.push({ sprite: MACHO_BRACE_SPRITE, label: `Macho Brace — ×${MACHO_BRACE_MULTIPLIER} EVs`, kind: 'item' });
    } else if (aids.powerItem) {
      const item = POWER_ITEMS.find((p) => p.id === aids.powerItem);
      if (item) {
        const bonus = store.powerItemBonus();
        badges.push({ sprite: item.sprite, label: `${item.label} — +${bonus} ${STAT_LABEL[item.stat]}`, kind: 'item' });
      }
    } else {
      const availability = store.trainingItemAvailability();
      if (availability.machoBrace || availability.powerItems) {
        badges.push({ sprite: null, label: 'No item', kind: 'empty' });
      }
    }
    // Not mutually exclusive with the item badge above — a Pokémon can
    // hold a power item and also passively earn EVs from other battles.
    if (e.expShare) {
      badges.push({ sprite: EXP_SHARE_SPRITE, label: 'Exp. Share', kind: 'item' });
    }
    this.$statusRow.hidden = badges.length === 0;
    this.$statusRow.innerHTML = badges
      .map(
        (b) =>
          `<span class="ds-pill-badge status-pill status-pill--${b.kind}">${
            b.sprite ? `<img src="${b.sprite}" alt="" ${FALLBACK_ONERROR} />` : ''
          }${escapeHtml(b.label)}</span>`
      )
      .join('');
  }

  // Same template as the training item buttons — sprite, name, and the
  // stat it feeds in a lighter line underneath — so there's no need to
  // remember which vitamin maps to which stat. Marks a button dim before
  // it's even clicked when this game's rules mean it wouldn't gain
  // anything — the Gen III-VII 100-EV vitamin cutoff, the Gen I-II
  // 25,600-Stat-Experience ceiling, or the stat already sitting at its
  // cap. Also badges each button with how many times it's already been
  // fed, since that's otherwise invisible once EVs mix in with battle
  // EVs. On Gen I, Zinc is dropped entirely — Special hasn't split into
  // SpA/SpD yet.
  _updateVitaminGrid(e) {
    const statExp = store.usesStatExpSystem();
    const mergedSpecial = store.specialStatMerged();
    const cutoffApplies = !statExp && store.vitaminCutoffApplies();
    const bonus = statExp ? STAT_EXP_VITAMIN_BONUS : VITAMIN_BONUS;
    const statCap = store.statCap();
    this.$vitaminGrid.items = SORTED_VITAMINS.filter((v) => !(mergedSpecial && v.id === 'zinc')).map((v) => {
      const statLabel = mergedSpecial && v.stat === 'spa' ? 'SPC' : STAT_LABEL[v.stat];
      const stat = e.evs[v.stat];
      const cappedByCutoff = cutoffApplies && stat >= VITAMIN_STAT_CUTOFF;
      const cappedByStatCap = stat >= statCap;
      const cappedByCeiling = statExp && stat >= STAT_EXP_VITAMIN_CEILING;
      const count = e.history.filter((h) => h.kind === 'vitamin' && h.vitaminId === v.id).length;
      const capped = cappedByCutoff || cappedByCeiling || cappedByStatCap;
      const fedNote = count ? ` — fed ${count}×` : '';
      const title = capped
        ? (cappedByCutoff
            ? `This game stops vitamins once ${statLabel} has ${VITAMIN_STAT_CUTOFF}+ EVs`
            : cappedByCeiling
              ? `Vitamins stop working once ${statLabel} has ${STAT_EXP_VITAMIN_CEILING}+ Stat Experience`
              : `${statLabel} is already at the ${statCap} cap`) + fedNote
        : `Feed ${v.label} — raises ${statLabel} by up to ${bonus}` + fedNote;
      return { id: v.id, label: v.label, sprite: v.sprite, boost: `+${bonus} ${statLabel}`, title, capped, count };
    });
  }

  // Same shape as vitamins, minus the 100-EV-cutoff framing — Wings
  // never have one.
  _updateWingGrid(e) {
    this.$wingGrid.items = SORTED_FEATHERS.map((f) => {
      const stat = e.evs[f.stat];
      const capped = stat >= 252;
      const count = e.history.filter((h) => h.kind === 'feather' && h.featherId === f.id).length;
      const fedNote = count ? ` — fed ${count}×` : '';
      const title = capped
        ? `${STAT_LABEL[f.stat]} is already at the 252 cap` + fedNote
        : `Feed ${f.label} — raises ${STAT_LABEL[f.stat]} EVs by ${FEATHER_BONUS}` + fedNote;
      return { id: f.id, label: f.label, sprite: f.sprite, boost: `+${FEATHER_BONUS} ${STAT_LABEL[f.stat]}`, title, capped, count };
    });
  }

  // Mirrors _updateWingGrid, but "capped" here means nothing left to
  // remove (the stat is already at 0) rather than at the ceiling, and
  // the boost reads as a reduction — these subtract EVs rather than add
  // them.
  _updateBerryGrid(e) {
    this.$berryGrid.items = SORTED_EV_BERRIES.map((b) => {
      const stat = e.evs[b.stat];
      const capped = stat <= 0;
      const count = e.history.filter((h) => h.kind === 'berry' && h.berryId === b.id).length;
      const fedNote = count ? ` — fed ${count}×` : '';
      const title = capped
        ? `${STAT_LABEL[b.stat]} is already at 0` + fedNote
        : `Feed ${b.label} — removes up to ${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]} EVs` + fedNote;
      return { id: b.id, label: b.label, sprite: b.sprite, boost: `−${EV_BERRY_REDUCTION} ${STAT_LABEL[b.stat]}`, title, capped, count };
    });
  }
}
customElements.define('caught-pokemon-detail', CaughtPokemonDetail);
