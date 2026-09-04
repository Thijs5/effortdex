import { STATS, STAT_LABEL } from '../../../../lib/constants.ts';
import { gen1SpecialStat } from '../../../../lib/gen1-special-stats.ts';
import { escapeHtml } from '../../../../lib/utils.ts';
import { store, smogon } from '../../../../lib/services.ts';
import { toShowdownId, smogonSetsKey, TIER_DESCRIPTIONS } from '../../../../lib/smogon-client.ts';
import { matchGameVersion } from '../../../../lib/game-versions.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import type { RosterEntry, StatKey } from '../../../../lib/store.ts';

// Tier badge color grouping — see .tier-badge's own CSS comment for why
// this is three loose groups, not a per-tier rainbow.
const TIER_DANGER = new Set(['Uber', 'AG']);
const TIER_SPECIAL = new Set(['LC', 'NFE']);

/**
 * <competitive-dialog> — a roster Pokémon's competitive-reference
 * dialog: base stats, its Pokémon Showdown tier, and a few common
 * Smogon sets. Extracted out of pokemon-detail.js (docs/adr/0008's
 * own note that it was still oversized even after item-button-grid.js)
 * — same "own dialog, own store calls" shape as ivs.js/
 * items.js, minus any pending/Save state: this dialog is pure
 * reference, nothing here ever writes to the store.
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment
 * (mirrors pokemon-detail's own "rebuild is cheap" render, ADR
 * 0002 point 5) so the content is already correct the instant `open()`
 * shows it, and stays correct if the species changes while it's open.
 * Call `open()` to show it.
 *
 * Routed under "#/parties/<slug>/<uid>/competitive" (docs/adr/0023) —
 * still instantiated and owned by pokemon-detail.js's own shadow DOM,
 * same as before; the route only decides when `open()`/`close()` get
 * called.
 */
export class CompetitiveDialog extends BaseDialog {
  _entry: RosterEntry | null = null;
  _token = 0; // guards against a stale async response landing after a fast species switch
  $baseStats: HTMLElement;
  $tierBadge: HTMLElement;
  $sets: HTMLElement;
  $empty: HTMLElement;

  constructor() {
    super('competitive-dialog', 'competitive-dialog-title');

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
        .competitive-panel { display: grid; gap: var(--space-2); }
        /* Base stats: a fixed reference for min-maxing a build (which
           stats are worth EVs against a species' own ceiling) — not tied
           to this specific Pokémon's own current progress, unlike its
           EV bars on the main card. */
        .competitive-base-stats { display: grid; gap: var(--space-1); }
        .base-stat-row {
          display: grid; grid-template-columns: 3.5em 1fr; align-items: center; gap: var(--space-2);
          font-size: var(--font-size-xs); color: var(--ink-soft);
        }
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
           rather than a color that implies it belongs on the same scale. */
        .tier-badge--illegal { color: var(--ink-soft); background: var(--lcd); border: 1px dashed var(--lcd-line); }
        .competitive-sets { display: grid; gap: var(--space-3); }
        .competitive-set {
          display: grid; gap: 0.2em; padding: var(--space-3); background: var(--lcd);
          border-radius: var(--radius-sm); font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .competitive-set-title { margin: 0; font-weight: 600; color: var(--ink); }
        .competitive-set-format { font-weight: 400; color: var(--ink-soft); text-transform: uppercase; }
        .competitive-set-line { margin: 0; font-size: var(--font-size-2xs); }
        .competitive-set-line:empty { display: none; }
        .competitive-set-moves { margin: 0; font-size: var(--font-size-2xs); }
        .competitive-empty { margin: 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .competitive-attribution { margin: 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .competitive-attribution a { color: inherit; }
    `;
    this.shadow.appendChild(style);

    this.$title.textContent = 'Competitive';
    this.$body.innerHTML = `
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
    `;

    this.$baseStats = this.shadow.querySelector<HTMLElement>('.competitive-base-stats')!;
    this.$tierBadge = this.shadow.querySelector<HTMLElement>('.tier-badge')!;
    this.$sets = this.shadow.querySelector<HTMLElement>('.competitive-sets')!;
    this.$empty = this.shadow.querySelector<HTMLElement>('.competitive-empty')!;

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
  }

  set entry(e: RosterEntry | null) {
    this._entry = e;
    if (!e) return;
    const mergedSpecial = store.specialStatMerged();
    this._renderBaseStats(e, mergedSpecial);
    this._renderCompetitive(e);
  }
  get entry(): RosterEntry | null {
    return this._entry;
  }

  /**
   * Species base stats — a fixed number that's the same for every one of
   * this species, the relevant reference when planning which stats to
   * invest EVs into against their own ceiling.
   */
  _renderBaseStats(e: RosterEntry, mergedSpecial: boolean): void {
    if (!e.baseStats) {
      this.$baseStats.innerHTML = '';
      return;
    }
    // Same Gen I real-Special-stat substitution as the EV bars used to
    // show (gen1-special-stats.js) — the modern spa/spd split isn't a
    // 50/50 divide of the real historical value.
    const bs = mergedSpecial
      ? { ...e.baseStats, spa: gen1SpecialStat(e.speciesId, e.baseStats.spa, e.baseStats.spd), spd: gen1SpecialStat(e.speciesId, e.baseStats.spa, e.baseStats.spd) }
      : e.baseStats;
    this.$baseStats.innerHTML = STATS.filter(({ key }) => !(mergedSpecial && key === 'spd'))
      .map(({ key, label }) => {
        const shownLabel = mergedSpecial && key === 'spa' ? 'SPC' : label;
        return `<div class="base-stat-row"><span class="base-stat-label">${escapeHtml(shownLabel)}</span><span class="base-stat-value">${bs[key]}</span></div>`;
      })
      .join('');
  }

  /**
   * Fetches (or reads from lib/smogon-client.ts's own cache) this
   * species' current tier and common competitive sets, scoped to the
   * active party's own generation — clamped to Smogon's covered range
   * (1-9), defaulting to the current generation for an unrecognized/ROM
   * hack base game rather than showing nothing. Async and best-effort:
   * offline or a failed fetch just leaves the section showing its empty
   * state, never an error — this is a nice-to-have overlay on top of the
   * app's own offline-first EV tracking, not something it depends on.
   */
  async _renderCompetitive(e: RosterEntry): Promise<void> {
    const token = ++this._token;
    this.$tierBadge.hidden = true;
    this.$tierBadge.classList.remove('tier-badge--danger', 'tier-badge--special', 'tier-badge--illegal');
    // A stale open help-note (from this same badge, on a previous
    // species) would otherwise show that species' tier description
    // after switching — close it rather than let it linger.
    if (this.$tierBadge.getAttribute('aria-expanded') === 'true') {
      const heading = this.$tierBadge.closest('.section-title');
      if (heading?.nextElementSibling?.classList.contains('help-note')) heading.nextElementSibling!.remove();
      this.$tierBadge.setAttribute('aria-expanded', 'false');
    }
    this.$sets.innerHTML = '';
    this.$empty.hidden = true;
    const gen = Math.min(9, Math.max(1, matchGameVersion(store.activeParty?.baseGame)?.gen ?? 9));
    try {
      const [tiers, sets] = await Promise.all([smogon.getTiers(), smogon.getSets(gen)]);
      if (token !== this._token) return; // a newer species/render already owns the UI
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
        this.$empty.hidden = false;
        return;
      }
      const flat: { format: string; setName: string; set: any }[] = [];
      for (const [format, bySet] of Object.entries(speciesSets)) {
        for (const [setName, set] of Object.entries(bySet as Record<string, any>)) flat.push({ format, setName, set });
      }
      // Capped at 3 — this is a quick "is this a competitive spread"
      // glance, not a full strategy-dex mirror; the attribution line
      // points to the real thing for anyone who wants more.
      this.$sets.innerHTML = flat
        .slice(0, 3)
        .map(({ format, setName, set }) => this._setHtml(format, setName, set))
        .join('');
    } catch {
      if (token !== this._token) return;
      this.$empty.hidden = false;
    }
  }

  _setHtml(format: string, setName: string, set: any): string {
    // Several of a set's own fields — moves (per-slot), item, nature, and
    // evs — can each be either one value or an array of viable
    // alternatives (Smogon publishes "or" options within a single set,
    // e.g. Chansey's NU set offering two different EV spreads). Only the
    // first alternative is shown here — this card is a quick glance, not
    // a full options list; the attribution line points to the real dex
    // entry for anyone who wants the rest.
    const first = (v: any) => (Array.isArray(v) ? v[0] : v);
    const moves = (set.moves || []).map(first).slice(0, 4);
    const evs = first(set.evs);
    const evsText = evs
      ? Object.entries(evs)
          .map(([key, value]) => `${value} ${STAT_LABEL[key as StatKey] || key.toUpperCase()}`)
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
}
customElements.define('competitive-dialog', CompetitiveDialog);
