import { categoryGuide, moveOptions, trainingPlan } from '../../../molecules/training-plan.ts';
import { matchGameVersion } from '../../../../lib/game-versions.ts';
import type { DomainPokemon } from '../../../../lib/pokeapi-client.ts';
import { defensiveMatchups, speciesTypes } from '../../../../lib/type-matchups.ts';
import { versionedSpriteUrl, modernSpriteUrl } from '../../../../lib/pokeapi-client.ts';
import { wireSpriteFallback } from '../../../../lib/sprite-fallback.ts';
import { STATS, TYPE_COLORS, typeTextColor, typeLabel, FALLBACK_SPRITE } from '../../../../lib/constants.ts';
import { titleCase } from '../../../../lib/utils.ts';
import { gen1SpecialStat } from '../../../../lib/gen1-special-stats.ts';
import { api, store } from '../../../../lib/services.ts';
import { evTrainingLocations } from '../../../../lib/ev-training-locations.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import '../../../molecules/ev-training-guide.ts';
import type { RosterEntry } from '../../../../lib/store.ts';
import type { GameTrainingSpots } from '../../../../lib/ev-training-locations.ts';
import type { EvTrainingGuide } from '../../../molecules/ev-training-guide.ts';

/** Roster-specific training targets and the active game's curated battle locations. */
export class TrainingGuideDialog extends BaseDialog {
  _entry: RosterEntry | null = null;
  $guide: EvTrainingGuide;
  private preview: DomainPokemon | null = null;
  private request = 0;
  private loading = false;
  private spriteFallback: ReturnType<typeof wireSpriteFallback>;
  private spriteKey = '';

  constructor() {
    super('training-guide-dialog', 'training-guide-dialog-title');

    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .plan-stats { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; margin-block:12px; }
      .plan-stats svg { display:block; width:100%; max-height:165px; }
      @media (max-width:380px) {
        .plan-stats { grid-template-columns:1fr; }
        .plan-stats table { width:100%; }
      }
      .plan-stats small { display:block; text-align:center; color:var(--ink-soft); }
      .plan-stats table { font:inherit; font-variant-numeric:tabular-nums; }
      .plan-stats td,.plan-stats th { padding:2px 3px; text-align:right; }
      .plan-stats th:first-child { text-align:left; }
      select { display:block; width:100%; min-height:44px; margin-block:4px;
        padding-inline:10px; background:var(--surface); color:var(--ink); border:1px solid var(--lcd-line);
        border-radius:var(--radius-sm); font:inherit; }
      .dex-nav { display:flex; align-items:center; justify-content:space-between; gap:4px; }
      .dex-nav button,.restore { min-height:44px; min-width:44px; color:var(--ink); background:var(--surface); border:1px solid var(--lcd-line); border-radius:var(--radius-sm); }
      .dex-nav button:disabled { opacity:.45; }
      .species-card { padding:var(--space-3); border-radius:var(--radius-sm); border:1px solid var(--lcd-line);
        background:linear-gradient(120deg,color-mix(in srgb,var(--species-color) 17%,var(--surface)),var(--surface)); }
      .dex-nav { justify-content:flex-start; }
      .dex-nav button { flex:none; }
      .dex-nav .prev { margin-left:auto; }
      .dex-nav h3,.plan h4 { margin:0; font-size:var(--font-size-xs); }
      .species-face { display:flex; align-items:center; gap:var(--space-3); min-width:0; }
      .species-face img { width:clamp(80px,24vw,108px); height:auto; aspect-ratio:1; object-fit:contain; image-rendering:pixelated; }
      .dex-name { display:block; font-size:1.2rem; overflow-wrap:anywhere; }
      .type-list,.match-list { display:flex; flex-wrap:wrap; gap:5px; margin-block:6px; }
      .type-chip { border-radius:var(--radius-pill); padding:3px 8px; font-size:var(--font-size-xs); font-weight:650; }
      .match-list .type-chip { color:var(--ink); background:var(--surface); border:1px solid var(--lcd-line); border-left:4px solid var(--chip); }
      .matchups { margin-top:var(--space-3); }
      .base-values { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
      .base-values span { background:var(--lcd); padding:6px; text-align:center; border-radius:var(--radius-sm); font-variant-numeric:tabular-nums; }
      summary { cursor:pointer; padding-block:10px; font-weight:600; }
      .plan { font-size:var(--font-size-xs); }
      .training-guide-attribution { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
    `;
    this.shadow.appendChild(style);

    this.$title.textContent = 'Training guide';
    this.$body.innerHTML = `
      <section class="plan"><div class="species-card">
      <div class="dex-nav"><h3>National Pokédex</h3><button type="button" class="prev" aria-label="Previous Pokédex number">←</button>
      <button type="button" class="next" aria-label="Next Pokédex number">→</button></div>
      <div class="species-face"><img class="dex-sprite" alt=""><div><strong class="dex-name" aria-live="polite"></strong>
      <div class="type-list" aria-label="Pokémon types"></div></div></div></div>
      <section class="matchups"><h4>Type weaknesses</h4><div class="match-list weaknesses"></div>
      <details class="resistances"><summary>Resistances and immunities</summary><div class="match-list reduced"></div></details></section>
      <p><strong>Base stats</strong></p><p class="base-values"></p>
      <p class="projection" hidden></p>
      <button type="button" class="restore" hidden></button>
      <div class="dex-status" role="status"></div><h3>Suggested training</h3>
      <label>Training focus<select></select></label>
      <details><summary>Which moves are physical or special?</summary><div class="categories"></div></details>
      <div class="result" aria-live="polite"></div></section>
      <section class="spots"><h3>Where to train</h3><ev-training-guide></ev-training-guide>
      <p class="training-guide-attribution">Locations via Bulbapedia &amp; Marriland's EV training guides</p></section>`;
    this.spriteFallback = wireSpriteFallback(this.$body.querySelector('.dex-sprite')!);
    this.$body.querySelector('.prev')!.addEventListener('click', () => void this.browse(-1));
    this.$body.querySelector('.next')!.addEventListener('click', () => void this.browse(1));
    this.$body.querySelector('.restore')!.addEventListener('click', () => this.resetPreview());
    this.$guide = this.shadow.querySelector('ev-training-guide')!;
    this.$body.querySelector('select')!.addEventListener('change', () => this.renderPlan());
    // Already knows the opponent's name — no need to open a search at
    // all. Closes first so it's not left sitting open behind whatever
    // status line the battle log shows. Not re-dispatched: <ev-training-
    // guide>'s own 'spot-pick' is already `{ bubbles: true, composed:
    // true }`, so it reaches pokemon-detail.js's listener on this
    // element by bubbling straight through on its own — re-dispatching
    // it here would fire that listener a second time.
    this.$guide.addEventListener('spot-pick', () => this.close());
  }

  set entry(e: RosterEntry | null) {
    const select = this.$body.querySelector('select')!;
    const gen = matchGameVersion(store.activeParty?.baseGame)?.gen ?? 0;
    if (e?.uid !== this._entry?.uid || e?.speciesId !== this._entry?.speciesId || select.dataset.gen !== String(gen)) {
      this.preview = null;
      this.request++;
      this.loading = false;
      this.$body.querySelector('.dex-status')!.textContent = '';
      select.dataset.gen = String(gen);
      this.$body.querySelector('.categories')!.innerHTML = categoryGuide(gen);
      const moves = document.createElement('optgroup');
      moves.label = gen === 3 ? 'Main damaging move’s type' : 'Main damaging move’s category';
      moves.append(...moveOptions(gen).map(v => new Option(v, v)));
      select.replaceChildren(new Option('Suggest from base stats', ''), moves);
      const roles = document.createElement('optgroup');
      roles.label = 'Defensive role';
      roles.append(new Option('Physical wall'), new Option('Special wall'));
      select.append(roles);
    }
    this._entry = e;
    if (!e) return;
    // Curated per-game data (lib/ev-training-locations.js), not a party
    // rule — no override, so read straight off the party's own baseGame
    // rather than through an effective-aids-style helper.
    this.$body.querySelector('label')!.hidden = store.usesStatExpSystem();
    this.renderPlan();
    this.$guide.spriteGame = store.spriteBaseGame();
    this.$guide.locations = this.locations();
  }
  private resetPreview(): void {
    this.request++;
    this.loading = false;
    this.preview = null;
    this.$body.querySelector('.dex-status')!.textContent = '';
    this.renderPlan();
  }

  _onClose(): void {
    this.resetPreview();
  }

  private get dexLimit(): number {
    const party = store.activeParty;
    const gen = party?.overrides?.availableGeneration ?? matchGameVersion(party?.baseGame)?.gen;
    return [0, 151, 251, 386, 493, 649, 721, 809, 905, 1025][gen ?? 9] ?? 1025;
  }

  private async browse(direction: number): Promise<void> {
    const entry = this._entry;
    if (!entry || this.loading) return;
    const token = ++this.request;
    const status = this.$body.querySelector('.dex-status')!;
    this.loading = true;
    status.textContent = 'Loading species…';
    this.renderPlan();
    try {
      const start = this.preview?.id ?? await api.nationalDexNumber(entry.speciesName, entry.speciesId);
      const next = start + direction;
      if (next < 1 || next > this.dexLimit) throw new Error();
      const mon = await api.getPokemon(String(next));
      if (token !== this.request) return;
      this.preview = mon.id === entry.speciesId ? null : mon;
      status.textContent = '';
    } catch {
      if (token === this.request) status.textContent = 'Could not load that Pokédex entry. Try again.';
    } finally {
      if (token === this.request) {
        this.loading = false;
        this.renderPlan();
      }
    }
  }

  private renderPlan(): void {
    const entry = this._entry;
    if (!entry) return;
    const mon = this.preview;
    const id = mon?.id ?? entry.speciesId;
    const name = titleCase(mon?.name ?? entry.speciesName);
    const base = mon?.baseStats ?? entry.baseStats;
    const merged = store.specialStatMerged();
    this.$body.querySelector('.dex-name')!.textContent = (id < 10000 ? '#' + id + ' ' : '') + name;
    const game = store.spriteBaseGame();
    const modern = mon?.sprite || (mon ? modernSpriteUrl(id) : entry.sprite || modernSpriteUrl(id)) || FALLBACK_SPRITE;
    const spriteKey = [id, game, modern].join('|');
    if (spriteKey !== this.spriteKey) {
      this.spriteKey = spriteKey;
      this.spriteFallback.setVersionedSprite(versionedSpriteUrl(game, id), modern);
    }
    const gen = matchGameVersion(store.activeParty?.baseGame)?.gen ?? 9;
    const types = speciesTypes(id, (mon ?? api.peekCached(entry.speciesName))?.types ?? [], gen);
    const chip = (type: string, factor?: number) => {
      const badge = document.createElement('span');
      badge.className = 'type-chip';
      const color = TYPE_COLORS[type] ?? 'var(--lcd-line)';
      badge.style.setProperty('--chip', color);
      if (factor === undefined) {
        badge.style.backgroundColor = color;
        badge.style.color = typeTextColor(type);
      }
      badge.textContent = typeLabel(type) + (factor === undefined ? '' : ' ×' + factor);
      return badge;
    };
    this.$body.querySelector<HTMLElement>('.species-card')!.style.setProperty('--species-color', TYPE_COLORS[types[0]] ?? 'var(--lcd-line)');
    this.$body.querySelector('.type-list')!.replaceChildren(...types.map(type => chip(type)));
    const matchups = defensiveMatchups(types, gen);
    const weak = matchups.filter(m => m.factor > 1);
    const reduced = matchups.filter(m => m.factor < 1);
    this.$body.querySelector('.weaknesses')!.replaceChildren(...(weak.length ? weak.map(m => chip(m.type, m.factor)) : [types.length ? 'None' : 'Type data unavailable']));
    this.$body.querySelector<HTMLElement>('.resistances')!.hidden = !reduced.length;
    this.$body.querySelector('.reduced')!.replaceChildren(...reduced.map(m => chip(m.type, m.factor)));
    this.$body.querySelector('.base-values')!.replaceChildren(...STATS.filter(s => !merged || s.key !== 'spd').map(({ key, label }) => {
      const stat = document.createElement('span');
      const special = merged && key === 'spa';
      stat.textContent = (special ? 'SPC' : label) + ' ' + (base ? special ? gen1SpecialStat(id, base.spa, base.spd) : base[key] : '—');
      return stat;
    }));
    this.$body.querySelector<HTMLButtonElement>('.prev')!.disabled = this.loading || id === 1;
    this.$body.querySelector<HTMLButtonElement>('.next')!.disabled = this.loading || (id < 10000 && id >= this.dexLimit);
    const projection = this.$body.querySelector<HTMLElement>('.projection')!;
    projection.hidden = !mon || store.usesStatExpSystem();
    projection.textContent = 'Preview uses ' + titleCase(entry.speciesName) + '’s current EVs.';
    const restore = this.$body.querySelector<HTMLButtonElement>('.restore')!;
    restore.hidden = !mon;
    restore.textContent = 'Back to ' + titleCase(entry.speciesName);
    this.$body.querySelector<HTMLElement>('.spots')!.hidden = !!mon || !this.locations() || store.usesStatExpSystem();
    const select = this.$body.querySelector('select')!;
    const roles = select.querySelector<HTMLOptGroupElement>('optgroup[label="Defensive role"]');
    if (roles) roles.disabled = id === 292;
    if (id === 292 && select.value.endsWith(' wall')) select.value = '';
    const result = this.$body.querySelector('.result')!;
    if (store.usesStatExpSystem()) {
      result.textContent = 'Battle to build Stat Experience across all stats. Each stat can reach its maximum independently, so you can train them all.';
      return;
    }
    result.innerHTML = trainingPlan({ ...entry, speciesId: id, baseStats: base }, select.value);
  }

  get entry(): RosterEntry | null {
    return this._entry;
  }

  /** Whether this game has a curated list at all — pokemon-detail.js uses this to hide its own "Where to train" menu entry. */
  locations(): GameTrainingSpots | null {
    return evTrainingLocations(store.activeParty?.baseGame);
  }
}
customElements.define('training-guide-dialog', TrainingGuideDialog);
