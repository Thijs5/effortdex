import { POWER_ITEMS, MACHO_BRACE_SPRITE, EXP_SHARE_SPRITE, VITAMINS, FEATHERS, FEATHER_BONUS, EV_BERRIES, EV_BERRY_REDUCTION, NATURES, STAT_LABEL, MACHO_BRACE_MULTIPLIER, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, TOTAL_CAP, FALLBACK_SPRITE, FALLBACK_ONERROR, MIN_LEVEL, MAX_LEVEL } from '../lib/constants.js';
import { titleCase, totalEvs, natureEffectHint, natureOptionsHtml, dayLabel, escapeHtml, sortByLabel } from '../lib/utils.js';
import { api, store } from '../lib/services.js';
import { versionedSpriteUrl } from '../lib/pokeapi-client.js';
import { attachDesignSystem } from '../lib/design-system.js';
import { wireSpriteFallback } from '../lib/sprite-fallback.js';
import { POKERUS_ICON_SVG } from '../lib/icons.js';
import './ev-summary.js';
import './ev-history-log.js';
import './evolution-chain.js';
import './pokemon-search.js';
import './item-button-grid.js';

// Sorted once — these tables are static, so re-sorting them on every
// render (this card's entire point) would be pure waste.
const SORTED_VITAMINS = sortByLabel(VITAMINS);
const SORTED_FEATHERS = sortByLabel(FEATHERS);
const SORTED_EV_BERRIES = sortByLabel(EV_BERRIES);

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
        .more-btn { grid-area: more; align-self: start; display: inline-flex; align-items: center; gap: 0.3em; white-space: nowrap; }
        .more-btn svg { width: 14px; height: 14px; }
        /* The number+nature prefix (added ahead of the editable name)
           leaves less room for a long nickname on a phone-width card —
           drop the "More" label and keep just its icon, freeing that
           width back up. The dialog's own title still says "More
           options" for anyone who lands there another way. */
        @media (max-width: 420px) {
          .more-btn-label { display: none; }
        }

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

        .aids { display: grid; gap: var(--space-2); }

        .vitamins, .wings, .berries { display: grid; gap: var(--space-2); }
        .vitamin-status, .wing-status, .berry-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }

        .pokerus-section { display: grid; gap: var(--space-2); justify-items: start; }
        .pokerus-toggle-btn { width: auto; }
        .pokerus-toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .pokerus-icon { width: 22px; height: 22px; flex: 0 0 auto; display: inline-flex; color: var(--pokerus-purple); }
        .pokerus-icon svg { width: 100%; height: 100%; }

        .exp-share-section { display: grid; gap: var(--space-2); justify-items: start; }
        .exp-share-toggle-btn { width: auto; }
        .pokerus-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }

        .evolve-panel { display: grid; gap: var(--space-2); }

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
          <button class="more-btn ds-btn ds-btn--outline ds-btn--sm" type="button" title="More options" aria-label="More options" aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="17.5" r="1.7"/></svg>
            <span class="more-btn-label">More</span>
          </button>
        </header>

        <dialog class="more-dialog ds-dialog">
          <header class="ds-dialog-header">
            <h2>More options</h2>
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
              <input type="number" class="level-input ds-field" min="${MIN_LEVEL}" max="${MAX_LEVEL}" aria-label="Level" />
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

          <section class="exp-share-section">
            <h3 class="section-title">Exp. Share
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What does Exp. Share do?" title="While holding an Exp. Share, this Pokémon also earns EVs whenever any other Pokémon in this party has a battle logged — the same base amount that Pokémon got, doubled by this Pokémon's own Pokérus if it has any. It never inherits the other Pokémon's held item bonus.">?</button>
            </h3>
            <button type="button" class="ds-item-btn exp-share-toggle-btn" aria-pressed="false">
              <img class="ds-item-icon" src="${EXP_SHARE_SPRITE}" alt="" ${FALLBACK_ONERROR} />
              <span class="ds-item-btn-text">
                <span class="ds-item-btn-label">Exp. Share</span>
                <span class="ds-item-btn-boost">Gets EVs from other battles</span>
              </span>
            </button>
          </section>

          <section class="pokerus-section">
            <h3 class="section-title">Pokérus
              <button type="button" class="help-btn" aria-expanded="false" aria-label="What is Pokérus?" title="A rare, harmless in-game virus. While infected, every EV your Pokémon earns from battling is doubled — pure bonus, no downside. It can also spread to other party members over time. Once it cures (after a few days), the ×2 EV bonus stays forever — no need to toggle this off.">?</button>
            </h3>
            <button type="button" class="ds-item-btn pokerus-toggle-btn" aria-pressed="false">
              <span class="pokerus-icon" aria-hidden="true">${POKERUS_ICON_SVG}</span>
              <span class="ds-item-btn-text">
                <span class="ds-item-btn-label">Pokérus</span>
                <span class="ds-item-btn-boost">×2 EVs</span>
              </span>
            </button>
            <p class="pokerus-note" hidden>Pokérus doesn't double EVs in this game.</p>
          </section>

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
    this.$statusRow = shadow.querySelector('.status-row');
    this.$moreBtn = shadow.querySelector('.more-btn');
    this.$moreDialog = shadow.querySelector('.more-dialog');
    this.$moreDialogClose = shadow.querySelector('.more-dialog-close');
    this.$release = shadow.querySelector('.release');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$itemGrid = shadow.querySelector('.item-grid');
    this.$pokerusToggle = shadow.querySelector('.pokerus-toggle-btn');
    this.$pokerusNote = shadow.querySelector('.pokerus-note');
    this.$expShareToggle = shadow.querySelector('.exp-share-toggle-btn');
    this.$vitaminGrid = shadow.querySelector('.vitamin-grid');
    this.$vitaminStatus = shadow.querySelector('.vitamin-status');
    this.$wingsSection = shadow.querySelector('.wings');
    this.$wingGrid = shadow.querySelector('.wing-grid');
    this.$wingStatus = shadow.querySelector('.wing-status');
    this.$berriesSection = shadow.querySelector('.berries');
    this.$berryGrid = shadow.querySelector('.berry-grid');
    this.$berryStatus = shadow.querySelector('.berry-status');
    this.$evoChain = shadow.querySelector('evolution-chain');
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
    this.$moreBtn.addEventListener('click', () => {
      this.$moreDialog.showModal();
      // styles.css's html:has(dialog[open]) scroll lock can't see into
      // this shadow root, so flag the open state on <html> ourselves.
      document.documentElement.dataset.modalOpen = '';
      this.$evoChain.load();
    });
    // 'close' catches every path: the ✕, Esc, and backdrop clicks.
    this.$moreDialog.addEventListener('close', () => {
      delete document.documentElement.dataset.modalOpen;
    });
    this.$moreDialogClose.addEventListener('click', () => this.$moreDialog.close());
    this.$moreDialog.addEventListener('click', (e) => {
      if (e.target === this.$moreDialog) this.$moreDialog.close();
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
    this.$pokerusToggle.addEventListener('click', () => {
      store.setPokerus(this._entry.uid, this.$pokerusToggle.getAttribute('aria-pressed') !== 'true');
    });
    this.$expShareToggle.addEventListener('click', () => {
      store.setExpShare(this._entry.uid, this.$expShareToggle.getAttribute('aria-pressed') !== 'true');
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
    if (result.applied) {
      this.$vitaminStatus.textContent = `${vitamin.label}: +${result.applied} ${STAT_LABEL[vitamin.stat]}`;
    } else if (result.blockedByCutoff) {
      this.$vitaminStatus.textContent = `${vitamin.label}: no EVs gained — this game stops vitamins once ${STAT_LABEL[vitamin.stat]} has ${VITAMIN_STAT_CUTOFF}+ EVs`;
    } else {
      this.$vitaminStatus.textContent = `${vitamin.label}: no EVs gained — ${STAT_LABEL[vitamin.stat]} is already maxed out`;
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
    this.$evSummary.evs = e.evs;
    this.$evSummary.baseStats = e.baseStats;
    this.$evSummary.nature = nature;

    const trained = totalEvs(e.evs) >= TOTAL_CAP;
    this.toggleAttribute('fully-trained', trained);

    this._updateItemGrid();
    const aids = store.effectiveAids(e);
    const pokerusActive = !!e.pokerus;
    this.$pokerusToggle.setAttribute('aria-pressed', String(pokerusActive));
    this.$pokerusToggle.classList.toggle('ds-item-btn--active', pokerusActive);
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
    this.$pokerusToggle.disabled = !pokerusAvailable;
    this.$pokerusNote.hidden = pokerusAvailable;
    const expShareActive = !!e.expShare;
    this.$expShareToggle.setAttribute('aria-pressed', String(expShareActive));
    this.$expShareToggle.classList.toggle('ds-item-btn--active', expShareActive);
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
  }

  // Shows the selected nature's stat effect right under the picker, so
  // beginners don't have to memorize what e.g. "Adamant" does.
  _renderNatureHint() {
    const nature = NATURES.find((n) => n.id === this.$nature.value);
    this.$natureHint.textContent = nature ? natureEffectHint(nature) : '';
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
  // anything — the Gen III-VII 100-EV vitamin cutoff, or the stat
  // already sitting at the 252 cap. Also badges each button with how
  // many times it's already been fed, since that's otherwise invisible
  // once EVs from vitamins mix in with battle EVs.
  _updateVitaminGrid(e) {
    const cutoffApplies = store.vitaminCutoffApplies();
    this.$vitaminGrid.items = SORTED_VITAMINS.map((v) => {
      const stat = e.evs[v.stat];
      const cappedByCutoff = cutoffApplies && stat >= VITAMIN_STAT_CUTOFF;
      const cappedByStatCap = stat >= 252;
      const capped = cappedByCutoff || cappedByStatCap;
      const count = e.history.filter((h) => h.kind === 'vitamin' && h.vitaminId === v.id).length;
      const fedNote = count ? ` — fed ${count}×` : '';
      const title = capped
        ? (cappedByCutoff
            ? `This game stops vitamins once ${STAT_LABEL[v.stat]} has ${VITAMIN_STAT_CUTOFF}+ EVs`
            : `${STAT_LABEL[v.stat]} is already at the 252 cap`) + fedNote
        : `Feed ${v.label} — raises ${STAT_LABEL[v.stat]} EVs by up to ${VITAMIN_BONUS}` + fedNote;
      return { id: v.id, label: v.label, sprite: v.sprite, boost: `+${VITAMIN_BONUS} ${STAT_LABEL[v.stat]}`, title, capped, count };
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
