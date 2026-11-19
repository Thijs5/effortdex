import { categoryGuide, moveOptions, trainingPlan, specialTypes } from '../../../molecules/training-plan.ts';
import { matchGameVersion } from '../../../../lib/game-versions.ts';
import type { DomainPokemon } from '../../../../lib/pokeapi-client.ts';
import { learnsetGroup, type LevelMove } from '../../../../lib/training-reference.ts';
import { availableSpeciesFor } from '../../../../lib/species-availability.ts';
import { defensiveMatchups, speciesTypes, strongAgainst } from '../../../../lib/type-matchups.ts';
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
  private referenceKey = '';
  private referenceRequest = 0;

  constructor() {
    super('training-guide-dialog', 'training-guide-dialog-title');

    const style = document.createElement('style');
    style.textContent = `
      @media (min-width:641px) {
        .training-guide-dialog .ds-dialog-header { position:sticky; top:0; z-index:1; background:var(--surface); }
      }
      @media (min-width:760px) {
        dialog.training-guide-dialog { width:min(810px,94vw); max-width:94vw; }
        .plan { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); column-gap:24px; align-items:start; }
        .species-card,.projection,.restore,.dex-status { grid-column:1/-1; }
        .training { grid-column:1; }
        .reference { grid-column:2; }
        .species-card { display:grid; grid-template-columns:1fr auto; align-items:center; }
        .species-card .dex-nav { grid-column:2; grid-row:1; }
        .species-card .dex-nav h3 { display:none; }
        .species-card .species-face { grid-column:1; grid-row:1; }
        .species-card .species-face img { width:80px; }
      }
      .training h3 { margin:14px 0 8px; }
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
      .battle-facts { border-block:1px solid var(--lcd-line); padding-block:8px; }
      .battle-facts p { margin-block:6px; }
      .battle-facts strong { font-weight:650; }
      .matchups { margin-top:var(--space-3); }
      .base-values { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; }
      .base-values span { background:var(--lcd); padding:6px; text-align:center; border-radius:var(--radius-sm); font-variant-numeric:tabular-nums; }
      summary { cursor:pointer; padding-block:10px; font-weight:600; }
      .plan { font-size:var(--font-size-xs); line-height:1.4; }
      .result > strong { display:block; padding:8px 10px; border-left:3px solid var(--teal); background:var(--lcd); }
      .learnset ul { list-style:none; padding:0; margin:0; }
      .learnset li { display:grid; grid-template-columns:4.5em 1fr; padding:5px 8px; gap:8px; }
      .learnset li:nth-child(odd) { background:var(--lcd); }
      .learnset li span:first-child { font-variant-numeric:tabular-nums; color:var(--ink-soft); }
      summary { min-height:44px; box-sizing:border-box; }
      .plan-stats table th,.plan-stats table td { padding-block:4px; }
      .plan-stats tbody tr:nth-child(odd) { background:var(--lcd); }
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
      <p class="projection" hidden></p>
      <button type="button" class="restore" hidden></button>
      <div class="dex-status" role="status"></div><section class="training"><h3>Suggested training</h3>
      <label>Training focus<select></select></label>
      <details><summary>Which moves are physical or special?</summary><div class="categories"></div></details>
      <div class="result" aria-live="polite"></div></section>
      <div class="reference">      <section class="matchups"><h4>Type weaknesses</h4><div class="match-list weaknesses"></div>
      <details class="resistances"><summary>Resistances and immunities</summary><div class="match-list reduced"></div></details></section>
      <p><strong>Base stats</strong></p><p class="base-values"></p>
      <section class="battle-facts"><h4>Battle and training</h4>
      <p class="stab"></p><details><summary>Super-effective targets for same-type attacks</summary><div class="coverage"></div></details><p class="yield"></p><p class="evolution"></p>
      <p class="next-move"></p><details class="learnset" hidden><summary>Level-up moves</summary><ul></ul></details></section>
</div></section>
      <section class="spots"><h3>Where to train</h3><ev-training-guide></ev-training-guide>
      <p class="training-guide-attribution">Locations via Bulbapedia &amp; Marriland's EV training guides</p></section>`;
    this.spriteFallback = wireSpriteFallback(this.$body.querySelector('.dex-sprite')!);
    this.$body.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.target as Element).matches('summary, select')) event.stopPropagation();
    });
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

  open(): void {
    super.open();
    this.renderPlan();
  }

  _onClose(): void {
    this.referenceKey = '';
    this.referenceRequest++;
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

  private loadReference(name: string, level: number, game: string): void {
    if (!this.isOpen()) return;
    const key = [name, level, game, store.activeParty?.overrides?.availableGeneration].join('|');
    if (this.referenceKey === key) return;
    this.referenceKey = key;
    const token = ++this.referenceRequest;
    const evolution = this.$body.querySelector('.evolution')!;
    const nextMove = this.$body.querySelector('.next-move')!;
    const list = this.$body.querySelector<HTMLDetailsElement>('.learnset')!;
    list.hidden = true;
    list.open = false;
    nextMove.textContent = 'Loading level-up moves…';
    evolution.textContent = 'Loading evolutions…';
    const group = learnsetGroup(game);
    const moves: Promise<LevelMove[]> = group ? api.getLevelMoves(name, group) : Promise.resolve([]);
    moves.then(rows => {
      if (token !== this.referenceRequest) return;
      const upcoming = rows.filter(move => move.level > level);
      const first = upcoming[0];
      nextMove.textContent = first
        ? 'Next at Lv. ' + first.level + ' · ' + upcoming.filter(m => m.level === first.level).map(m => titleCase(m.name)).join(', ')
        : rows.length ? 'No further level-up moves after Lv. ' + level + '.' : 'No level-up moves listed for this game.';
      list.hidden = !rows.length;
      list.querySelector('ul')!.replaceChildren(...rows.map(move => {
        const item = document.createElement('li');
        const atLevel = document.createElement('span');
        atLevel.textContent = 'Lv. ' + move.level;
        const name = document.createElement('span');
        name.textContent = titleCase(move.name);
        item.append(atLevel, name);
        return item;
      }));
    }).catch(() => { if (token === this.referenceRequest) nextMove.textContent = 'Level-up moves unavailable.'; });

    Promise.all([api.getEvolutionChain(name), availableSpeciesFor(store.activeParty, api)]).then(([chain, allowed]) => {
      if (token !== this.referenceRequest) return;
      const next = chain.filter(node => node.parent === name && (!allowed || allowed.has(node.name)));
      evolution.textContent = next.length ? 'Next evolution · ' + next.map(node =>
        titleCase(node.name) + (node.minLevel ? ' (Lv. ' + node.minLevel + '+)' : '')).join(', ')
        : 'No further evolution listed for this game.';
    }).catch(() => { if (token === this.referenceRequest) evolution.textContent = 'Evolution data unavailable.'; });
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
    const profile = mon ?? api.peekCached(entry.speciesName);
    const damageStat = (type: string) => specialTypes.includes(typeLabel(type)) ? (gen === 1 ? 'Special' : 'Special Attack') : 'Attack';
    this.$body.querySelector('.stab')!.textContent = !types.length ? '' : gen <= 3
      ? 'Same-type bonus · ' + types.map(type => typeLabel(type) + ' attacks use ' + damageStat(type)).join(' · ')
      : 'Same-type bonus · ' + types.map(typeLabel).join(' and ') + ' attacks. Physical moves use Attack and special moves use Special Attack.';
    this.$body.querySelector('.coverage')!.replaceChildren(...types.map(type => {
      const line = document.createElement('p');
      const targets = strongAgainst(type, gen);
      line.textContent = typeLabel(type) + ' → ' + (targets.length ? targets.map(typeLabel).join(', ') : 'No single-type targets');
      return line;
    }));
    const yieldText = profile && STATS.filter(s => profile.evYield?.[s.key] > 0).map(s => '+' + profile.evYield[s.key] + ' ' + s.label).join(', ');
    this.$body.querySelector('.yield')!.textContent = store.usesStatExpSystem()
      ? 'Defeating this species builds Stat Experience across stats.'
      : 'Base EV yield when defeated · ' + (yieldText || 'Unavailable');
    this.loadReference(mon?.name ?? entry.speciesName, entry.level, store.activeParty?.baseGame ?? '');
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
