import { categoryGuide, moveOptions, trainingPlan } from '../../../molecules/training-plan.ts';
import { matchGameVersion } from '../../../../lib/game-versions.ts';
import type { DomainPokemon } from '../../../../lib/pokeapi-client.ts';
import { learnsetGroup, type LevelMove } from '../../../../lib/training-reference.ts';
import { availableSpeciesFor } from '../../../../lib/species-availability.ts';
import { defensiveMatchups, speciesTypes, strongAgainst } from '../../../../lib/type-matchups.ts';
import { versionedSpriteUrl, modernSpriteUrl } from '../../../../lib/pokeapi-client.ts';
import { wireSpriteFallback } from '../../../../lib/sprite-fallback.ts';
import { STATS, TYPE_COLORS, typeLabel, FALLBACK_SPRITE } from '../../../../lib/constants.ts';
import { titleCase } from '../../../../lib/utils.ts';
import { speciesBaseStats } from '../../../../lib/species-base-stats.ts';
import { typeBasedMoveCategory, usesTypeBasedMoveCategories } from '../../../../lib/move-category.ts';
import { api, store } from '../../../../lib/services.ts';
import { evTrainingLocations } from '../../../../lib/ev-training-locations.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import { createTypeLabel } from '../../../atoms/type-label.ts';
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
        .plan { grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); align-items:start; }
        .species-card,.projection,.restore,.dex-status { grid-column:1/-1; }
        .training { grid-column:1; }
        .reference { grid-column:2; }
        .species-card .dex-nav { flex-direction:row; }
      }
      .plan { display:grid; gap:var(--space-4); font-size:var(--font-size-xs); line-height:1.5; }
      .plan > *, .training, .reference { min-width:0; }
      .section-title { margin:0 0 var(--space-3); font-size:var(--font-size-2xs); font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-soft); }
      .training,.reference-panel { padding:var(--space-4); border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface); }
      .reference { display:grid; gap:var(--space-4); }
      .training label { display:grid; gap:var(--space-2); color:var(--ink-soft); }
      .training select { min-width:0; }
      .categories p { margin:var(--space-2) 0 var(--space-3); }
      .category-types { display:flex; flex-wrap:wrap; gap:var(--space-2) var(--space-3); margin-top:var(--space-2); }
      .plan-stats { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; margin-block:12px; }
      .plan-stats svg { display:block; width:100%; max-height:165px; }
      @media (max-width:640px) {
        .plan-stats { grid-template-columns:minmax(0,1fr); }
        .plan-stats table { width:100%; }
      }
      @media (min-width:641px) {
        .plan-stats .ev-chart { grid-column:1; grid-row:1; }
        .plan-stats table { grid-column:2; grid-row:1; }
      }
      .plan-stats small { display:block; text-align:center; color:var(--ink-soft); }
      .plan-stats table { font:inherit; font-variant-numeric:tabular-nums; border-collapse:collapse; }
      .plan-stats td { white-space:nowrap; }
      .plan-stats td,.plan-stats th { padding:var(--space-2); text-align:right; border-bottom:1px solid var(--lcd-line); }
      .plan-stats thead { color:var(--ink-soft); font-size:var(--font-size-2xs); }
      .plan-stats th:first-child { text-align:left; }
      .dex-nav { display:flex; flex-direction:column; align-items:center; gap:var(--space-1); }
      .dex-nav button,.restore { min-height:44px; min-width:44px; color:var(--ink); background:var(--surface); border:1px solid var(--lcd-line); border-radius:var(--radius-sm); }
      .dex-nav button:disabled { opacity:.45; }
      .species-card { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:var(--space-2); padding:var(--space-3); border-radius:var(--radius-md); border:1px solid var(--lcd-line);
        background:linear-gradient(120deg,color-mix(in srgb,var(--species-color) 10%,var(--surface)),var(--surface)); }
      .dex-nav button { flex:none; }
      .species-face { display:grid; grid-template-columns:64px minmax(0,1fr); align-items:center; gap:var(--space-3); min-width:0; }
      .species-face img { width:64px; height:64px; object-fit:contain; image-rendering:pixelated; }
      .dex-name { display:block; font-family:var(--font-display); font-size:var(--font-size-lg); overflow-wrap:anywhere; }
      .type-list { display:flex; flex-wrap:wrap; gap:var(--space-2); margin-top:var(--space-2); }
      .battle-facts p { margin-block:var(--space-3); }
      .battle-facts strong { font-weight:650; }
      .base-values { display:grid; margin:0; }
      .base-stat-row { display:flex; justify-content:space-between; gap:var(--space-3); padding:var(--space-2) 0; border-bottom:1px solid var(--lcd-line); color:var(--ink-soft); }
      .base-stat-row:last-child { border-bottom:0; }
      .base-stat-row strong { font-family:var(--font-mono); font-weight:500; color:var(--ink); }
      .matchup-heading { display:flex; align-items:baseline; justify-content:space-between; gap:var(--space-2); }
      .matchup-heading small { color:var(--ink-soft); }
      .matchup-subtitle { font-size:var(--font-size-xs); margin:0 0 var(--space-2); }
      .damage-list { list-style:none; margin:0; padding:0; }
      .damage-list > li { border-top:1px solid var(--lcd-line); }
      .damage-list details { display:grid; grid-template-columns:4.4rem minmax(0,1fr); gap:var(--space-2); align-items:center; }
      .damage-list summary { display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); font-family:var(--font-mono); padding-right:var(--space-1); list-style:none; }
      .damage-list summary::-webkit-details-marker { display:none; }
      .matchup-chevron { width:.4rem; height:.4rem; flex:none; border:solid var(--ink-soft); border-width:0 2px 2px 0; transform:rotate(-45deg); }
      .damage-list details[open] .matchup-chevron { transform:rotate(45deg); }
      .matchup-types { display:flex; flex-wrap:wrap; gap:var(--space-2) var(--space-3); padding-block:var(--space-2); }
      .matchup-empty { color:var(--ink-soft); padding-block:var(--space-2); }
      .coverage-row { display:grid; gap:var(--space-2); padding-block:var(--space-3); border-top:1px solid var(--lcd-line); }
      .coverage-label { display:flex; align-items:center; gap:var(--space-2); color:var(--ink-soft); }
      summary { cursor:pointer; min-height:44px; padding-block:var(--space-3); font-weight:600; }
      .result > strong { display:block; padding:var(--space-3); border-left:3px solid var(--teal); border-radius:0 var(--radius-sm) var(--radius-sm) 0; background:var(--lcd); }
      .result p { margin-block:var(--space-3); }
      .learnset ul { list-style:none; padding:0; margin:0; }
      .learnset li { display:grid; grid-template-columns:4.5em minmax(0,1fr); padding:var(--space-2); gap:var(--space-2); border-top:1px solid var(--lcd-line); }
      .learnset li span:first-child { font-variant-numeric:tabular-nums; color:var(--ink-soft); }
      .projection,.dex-status { margin:0; color:var(--ink-soft); }
      .dex-status:empty { display:none; }
      .spots { margin-top:var(--space-5); padding-top:var(--space-4); border-top:1px solid var(--line); }
      .training-guide-attribution { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
    `;
    this.shadow.appendChild(style);

    this.$title.textContent = 'Training guide';
    this.$body.innerHTML = `
      <section class="plan"><div class="species-card">
      <div class="species-face"><img class="dex-sprite" alt=""><div><strong class="dex-name" aria-live="polite"></strong>
      <div class="type-list" aria-label="Pokémon types"></div></div></div>
      <div class="dex-nav" role="group" aria-label="National Pokédex"><button type="button" class="prev" aria-label="Previous Pokédex number">←</button>
      <button type="button" class="next" aria-label="Next Pokédex number">→</button></div></div>
      <p class="projection" hidden></p>
      <button type="button" class="restore" hidden></button>
      <div class="dex-status" role="status"></div><section class="training"><h3 class="section-title">Suggested training</h3>
      <label>Training focus<select class="ds-field"></select></label>
      <details class="ds-disclosure"><summary>Which moves are physical or special?</summary><div class="categories"></div></details>
      <div class="result" aria-live="polite"></div></section>
      <div class="reference"><section class="reference-panel matchups">
      <div class="matchup-heading"><h3 class="section-title">Type matchups</h3><small class="matchup-rules"></small></div>
      <h4 class="matchup-subtitle">Weaknesses</h4><ul class="damage-list weaknesses" aria-label="Incoming damage from weaknesses"></ul>
      <details class="resistances ds-disclosure"><summary>Resistances and immunities</summary><ul class="damage-list reduced" aria-label="Reduced incoming damage"></ul></details></section>
      <section class="reference-panel"><h3 class="section-title">Base stats</h3><div class="base-values"></div></section>
      <section class="reference-panel battle-facts"><h3 class="section-title">Battle and training</h3>
      <p class="stab"></p><details class="ds-disclosure"><summary>Type coverage for same-type attacks</summary><div class="coverage"></div></details><p class="yield"></p><p class="evolution"></p>
      <p class="next-move"></p><details class="learnset ds-disclosure" hidden><summary>Level-up moves</summary><ul></ul></details></section>
</div></section>
      <section class="spots"><h3 class="section-title">Where to train</h3><ev-training-guide></ev-training-guide>
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
      moves.label = usesTypeBasedMoveCategories(gen) ? 'Main damaging move’s type' : 'Main damaging move’s category';
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
        titleCase(node.name) + (node.methods.length ? ' (' + node.methods.join(' or ') + ')' : '')).join(', ')
        : 'No further evolution listed for this game.';
    }).catch(() => { if (token === this.referenceRequest) evolution.textContent = 'Evolution data unavailable.'; });
  }

  private renderPlan(): void {
    const entry = this._entry;
    if (!entry) return;
    const mon = this.preview;
    const id = mon?.id ?? entry.speciesId;
    const name = titleCase(mon?.name ?? entry.speciesName);
    const baseGame = matchGameVersion(store.activeParty?.baseGame);
    const gen = baseGame?.gen ?? 0;
    const profile = mon ?? api.peekCached(entry.speciesName);
    const modernBase = profile?.baseStats ?? entry.baseStats;
    const base = modernBase ? speciesBaseStats(id, modernBase, gen) : null;
    const statExp = store.usesStatExpSystem();
    const effortLevels = baseGame?.name === 'Legends Arceus';
    const candy = baseGame?.name.startsWith("Let's Go") ?? false;
    const trainingNote = statExp ? 'Battle to build Stat Experience. Each stat can reach its maximum independently, so you can train them all.'
      : effortLevels ? 'Use grit items to raise effort levels in the stats your Pokémon relies on.'
      : candy ? 'Use Candies to raise the stats your Pokémon relies on.'
      : '';
    this.$body.querySelector('label')!.hidden = !!trainingNote;
    this.$body.querySelector('.dex-name')!.textContent = (id < 10000 ? '#' + id + ' ' : '') + name;
    const game = store.spriteBaseGame();
    const modern = mon?.sprite || (mon ? modernSpriteUrl(id) : entry.sprite || modernSpriteUrl(id)) || FALLBACK_SPRITE;
    const spriteKey = [id, game, modern].join('|');
    if (spriteKey !== this.spriteKey) {
      this.spriteKey = spriteKey;
      this.spriteFallback.setVersionedSprite(versionedSpriteUrl(game, id), modern);
    }
    const typeGen = gen || 9;
    const types = speciesTypes(id, profile?.types ?? [], typeGen);
    const damageStat = (type: string) => typeBasedMoveCategory(type, gen) === 'special'
      ? (gen === 1 ? 'Special' : 'Special Attack') : 'Attack';
    this.$body.querySelector('.stab')!.textContent = !types.length ? '' : usesTypeBasedMoveCategories(gen)
      ? 'Same-type bonus · ' + types.map(type => typeLabel(type) + ' attacks use ' + damageStat(type)).join(' · ')
      : 'Same-type bonus applies to ' + types.map(typeLabel).join(' and ') + ' moves. Move category usually determines whether Attack or Special Attack applies.';
    this.$body.querySelector('.coverage')!.replaceChildren(...types.map(type => {
      const line = document.createElement('div');
      line.className = 'coverage-row';
      const targets = strongAgainst(type, typeGen);
      const heading = document.createElement('span');
      heading.className = 'coverage-label';
      heading.append(createTypeLabel(type), ' attacks are strong against');
      const labels = document.createElement('div');
      labels.className = 'matchup-types';
      labels.append(...(targets.length ? targets.map(target => createTypeLabel(target)) : ['No single-type targets']));
      line.append(heading, labels);
      return line;
    }));
    const yieldText = profile && STATS.filter(s => profile.evYield?.[s.key] > 0).map(s => '+' + profile.evYield[s.key] + ' ' + s.label).join(', ');
    const yieldLine = this.$body.querySelector<HTMLElement>('.yield')!;
    yieldLine.hidden = effortLevels || candy;
    yieldLine.textContent = statExp
      ? 'Defeating this species builds Stat Experience across stats.'
      : 'Base EV yield when defeated · ' + (yieldText || 'Unavailable');
    this.loadReference(mon?.name ?? entry.speciesName, entry.level, store.activeParty?.baseGame ?? '');
    this.$body.querySelector<HTMLElement>('.species-card')!.style.setProperty('--species-color', TYPE_COLORS[types[0]] ?? 'var(--lcd-line)');
    this.$body.querySelector('.type-list')!.replaceChildren(...types.map(type => createTypeLabel(type)));
    const matchups = defensiveMatchups(types, typeGen, effortLevels);
    const weak = matchups.filter(m => m.factor > 1);
    const reduced = matchups.filter(m => m.factor < 1);
    this.$body.querySelector('.matchup-rules')!.textContent = effortLevels ? 'Legends Arceus' : gen ? `Gen ${gen}` : 'Modern rules';
    this.renderDamageList('.weaknesses', weak, types.length ? 'None' : 'Type data unavailable');
    this.$body.querySelector<HTMLElement>('.resistances')!.hidden = !reduced.length;
    this.renderDamageList('.reduced', reduced);
    this.$body.querySelector('.base-values')!.replaceChildren(...STATS.filter(s => gen !== 1 || s.key !== 'spd').map(({ key, label }) => {
      const stat = document.createElement('span');
      stat.className = 'base-stat-row';
      const value = document.createElement('strong');
      value.textContent = String(base?.[key] ?? '—');
      stat.append((gen === 1 && key === 'spa' ? 'SPC' : label) + ' ', value);
      return stat;
    }));
    this.$body.querySelector<HTMLButtonElement>('.prev')!.disabled = this.loading || id === 1;
    this.$body.querySelector<HTMLButtonElement>('.next')!.disabled = this.loading || (id < 10000 && id >= this.dexLimit);
    const projection = this.$body.querySelector<HTMLElement>('.projection')!;
    projection.hidden = !mon || !!trainingNote;
    projection.textContent = 'Preview uses ' + titleCase(entry.speciesName) + '’s current EVs.';
    const restore = this.$body.querySelector<HTMLButtonElement>('.restore')!;
    restore.hidden = !mon;
    restore.textContent = 'Back to ' + titleCase(entry.speciesName);
    this.$body.querySelector<HTMLElement>('.spots')!.hidden = !!mon || !this.locations() || !!trainingNote;
    const select = this.$body.querySelector('select')!;
    const roles = select.querySelector<HTMLOptGroupElement>('optgroup[label="Defensive role"]');
    if (roles) roles.disabled = id === 292;
    if (id === 292 && select.value.endsWith(' wall')) select.value = '';
    this.$body.querySelector('.result')!.innerHTML = trainingPlan({ ...entry, speciesId: id, baseStats: base }, select.value, gen, trainingNote);
  }

  private renderDamageList(selector: string, matches: { type: string; factor: number }[], empty = ''): void {
    const list = this.$body.querySelector(selector)!;
    const groups = new Map<number, string[]>();
    for (const match of matches) {
      const group = groups.get(match.factor) ?? [];
      group.push(match.type);
      groups.set(match.factor, group);
    }
    const rows = [...groups].map(([factor, types]) => {
      const row = document.createElement('li');
      const disclosure = document.createElement('details');
      disclosure.open = true;
      const summary = document.createElement('summary');
      summary.setAttribute('aria-label', factor === 0 ? '×0 damage, immune' : `×${factor} damage`);
      const multiplier = document.createElement('span');
      multiplier.textContent = `×${factor}`;
      const chevron = document.createElement('span');
      chevron.className = 'matchup-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      summary.append(multiplier, chevron);
      const labels = document.createElement('div');
      labels.className = 'matchup-types';
      labels.append(...types.map(type => createTypeLabel(type)));
      disclosure.append(summary, labels);
      row.append(disclosure);
      return row;
    });
    if (!rows.length && empty) {
      const row = document.createElement('li');
      row.className = 'matchup-empty';
      row.textContent = empty;
      rows.push(row);
    }
    list.replaceChildren(...rows);
  }

  get entry(): RosterEntry | null {
    return this._entry;
  }

  /** Curated battle locations, when available for this game. */
  locations(): GameTrainingSpots | null {
    return evTrainingLocations(store.activeParty?.baseGame);
  }
}
customElements.define('training-guide-dialog', TrainingGuideDialog);
