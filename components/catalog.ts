import { attachDesignSystem } from '../lib/design-system.ts';
import { escapeHtml } from '../lib/utils.ts';
import { BaseDialog } from './atoms/base-dialog.ts';
import './atoms/type-label.ts';
import './atoms/ev-gain.ts';
import './atoms/ds-item-button.ts';
import './atoms/item-button-grid.ts';
import './atoms/level-input.ts';
import './atoms/game-ball.ts';
import './molecules/ev-summary.ts';
import './molecules/game-version-picker.ts';

// Deliberately independent of the application/store: previews never save data.
attachDesignSystem(document);
const theme = document.querySelector<HTMLSelectElement>('#theme')!;
theme.value = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const applyTheme = () => { document.documentElement.dataset.theme = theme.value; };
theme.addEventListener('change', applyTheme);
applyTheme();

function example(title: string, source: string, description: string, markup: string, usage = markup): string {
  return `<article><h3>${title}</h3><p>${description}</p><p class="note"><code>${source}</code></p><div class="preview">${markup}</div><details class="ds-disclosure"><summary>Usage</summary><pre><code>${escapeHtml(usage)}</code></pre></details></article>`;
}
function section(id: string, title: string, content: string): string {
  return `<section id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${title}</h2><div class="examples">${content}</div></section>`;
}

document.querySelector('#examples')!.innerHTML = [
  section('foundations', 'Foundations', `
    <article><h3>Semantic color & typography</h3><p>Consume tokens instead of introducing a local palette. Switch the theme to compare both appearances.</p><div class="swatches">${['paper', 'paper-panel', 'ink', 'teal', 'accent', 'good', 'meter-max'].map(token => `<div class="swatch"><span style="background:var(--${token})"></span><code>--${token}</code></div>`).join('')}</div><p>Display headings · Body text · <code>Numeric / code text</code></p></article>
    <article><h3>Spacing & composition</h3><p>Use <code>--space-1</code> through <code>--space-5</code>, the shared type scale and radius tokens in <code>tokens.css</code>. Keep grouping shallow; spacing and aligned rows usually need fewer boxes.</p><p>Extend <code>BaseElement</code> for shadow components; it adopts the shared sheet. Native elements in a new document need <code>attachDesignSystem(document)</code>.</p></article>`),
  section('controls', 'Controls', [
    example('Buttons', 'lib/design-system.ts', 'Use native buttons with shared variants. Disabled actions remain visibly unavailable.', `<div class="row"><button type="button" class="ds-btn ds-btn--primary">Primary</button><button type="button" class="ds-btn ds-btn--solid">Save</button><button type="button" class="ds-btn ds-btn--outline">Secondary</button><button type="button" class="ds-btn ds-btn--plain">Plain navigation</button><button type="button" class="ds-btn ds-btn--ghost ds-btn--danger">Delete</button><button type="button" class="ds-btn ds-btn--solid" disabled>Disabled</button></div>`),
    example('Fields & level entry', 'lib/design-system.ts · components/atoms/level-input.ts', 'Labels name each input. Level entry filters digits; callers still validate and clamp the value.', `<div class="stack"><label for="sample-name">Nickname</label><input class="ds-field" id="sample-name" placeholder="e.g. Bulbasaur" /><span>Level</span><level-input id="sample-level" aria-label="Level"></level-input><label for="sample-select">Nature</label><select class="ds-field" id="sample-select"><option>Modest</option><option>Adamant</option></select></div>`),
    example('Status & disclosure', 'lib/design-system.ts', 'Badges communicate state; disclosures use native keyboard behavior.', `<div class="stack"><span class="ds-pill-badge">Fully trained</span><details class="ds-disclosure"><summary>Training details</summary><p>Use disclosures for secondary information that can wait.</p></details></div>`),
    example('Item choices', 'components/atoms/ds-item-button.ts · item-button-grid.ts', 'Choose an item to see its event. Active, disabled, capped and repeat-count states share one implementation.', `<div class="stack"><item-button-grid id="sample-items"></item-button-grid><ds-item-button icon="icons/brand-mark.svg" label="Unavailable" boost="Cannot apply" disabled></ds-item-button><ds-item-button icon="icons/brand-mark.svg" label="At cap" capped count="2"></ds-item-button><output id="item-result" role="status">Choose an item above.</output></div>`, `import './components/atoms/item-button-grid.ts';\nconst grid = document.createElement('item-button-grid');\ngrid.items = [{ id: 'sample', label: 'Sample', sprite: 'icons/brand-mark.svg', boost: 'Preview', title: 'Choose sample' }];\ngrid.addEventListener('item-pick', event => { /* event.detail.id */ });`),
    example('Game picker', 'components/molecules/game-version-picker.ts', 'Search official base-game titles. Invalid free text reverts on blur; version-change reports input and picks.', '<game-version-picker id="sample-game" aria-label="Base game"></game-version-picker>', `import './components/molecules/game-version-picker.ts';\nconst picker = document.createElement('game-version-picker');\npicker.setAttribute('aria-label', 'Base game');\npicker.value = 'Emerald';`),
  ].join('')),
  section('pokemon', 'Pokémon presentation', [
    example('Type labels', 'components/atoms/type-label.ts', 'Type colors, multipliers and historical move categories use one component. Gen III uses type-based categories; modern categories can be explicit.', '<div class="row"><type-label type="water" multiplier="2" generation="3"></type-label><type-label type="grass" generation="3"></type-label><type-label type="normal" category="status"></type-label><type-label type="fire" multiplier="0.5"></type-label></div>'),
    example('EV gains', 'components/atoms/ev-gain.ts', 'Informational gain values use one readable treatment. Callers supply game-aware text and label base yield versus applied gains. No interaction or selected state.', '<div class="row"><ev-gain>+1 HP EVs</ev-gain><ev-gain>+2 ATK, +1 SPE</ev-gain><ev-gain>0 EVs · capped</ev-gain></div>'),
    example('EV progress', 'components/atoms/ev-bar.ts · components/molecules/ev-summary.ts', 'Set properties for values, caps, actual stats and nature effects. This sample uses Gen III+ caps; preserve historical rules in real callers.', '<ev-summary id="sample-evs"></ev-summary>', `import './components/molecules/ev-summary.ts';\nconst summary = document.createElement('ev-summary');\nsummary.evs = { hp: 6, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };\nsummary.nature = { boost: 'atk', hinder: 'spa' };`),
    example('Game artwork', 'components/atoms/game-ball.ts', 'Game and generation colors belong to game-ball. Pair the decorative artwork with a readable game name.', '<div class="row"><game-ball id="sample-ball"></game-ball><span>Emerald</span><game-ball id="empty-ball"></game-ball><span>No game selected</span></div>', `import './components/atoms/game-ball.ts';\nconst ball = document.createElement('game-ball');\nball.name = 'Emerald';`),
  ].join('')),
  section('dialogs', 'Dialogs & sheets', example('Shared dialog behavior', 'components/atoms/base-dialog.ts', 'Full-height mobile sheets support long forms. Compact sheets fit a short choice. Both share close, Escape, backdrop, focus and footer behavior.', '<div class="row"><button type="button" id="open-full" class="ds-btn ds-btn--outline">Open full sheet</button><button type="button" id="open-compact" class="ds-btn ds-btn--solid">Open compact sheet</button></div><catalog-dialog></catalog-dialog><output id="dialog-result" role="status"></output>', `class MyDialog extends BaseDialog {\n  constructor() {\n    super('my-dialog', 'my-dialog-title');\n    this.$title.textContent = 'Choose a value';\n    // Fill $body; populate $footer and unhide it for actions.\n  }\n}\ncustomElements.define('my-dialog', MyDialog);`)),
  section('compositions', 'Feature compositions', '<article><h3>Reuse the complete flow</h3><p>Search, evolution, training references, stat observations, history and transfer have existing compositions. Consult their contracts before building another widget.</p><p>Store-aware components need real feature context; use their app flows for review rather than giving previews access to saved parties.</p><ul><li><code>pokemon-search</code> / <code>evolution-chain</code></li><li><code>ev-training-guide</code> / <code>stat-reading-grid</code></li><li><code>pokemon-detail</code> / <code>ev-history-log</code></li><li><code>transfer-panel</code> / <code>import-review</code></li></ul></article><article><h3>Contribution checklist</h3><p>Reuse, compose, then extend. If a component is missing, explain the gap before creating it. Keep one-off layout local.</p><p>Document inputs, events, supported states and examples in <code>docs/components.md</code>; update this page when a reusable visual contract changes.</p><p>Check keyboard use, long content, state transitions, both themes and actual mobile flows.</p></article>'),
].join('');

document.querySelector('level-input')!.value = 50;
document.querySelector('game-version-picker')!.value = 'Emerald';
(document.querySelector('#sample-ball') as HTMLElementTagNameMap['game-ball']).name = 'Emerald';
(document.querySelector('#empty-ball') as HTMLElementTagNameMap['game-ball']).name = '';
const summary = document.querySelector('ev-summary')!;
summary.evs = { hp: 6, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };
summary.nature = { boost: 'atk', hinder: 'spa' };
const grid = document.querySelector('item-button-grid')!;
grid.items = ['Protein', 'Carbos', 'HP Up'].map((label, i) => ({ id: label, label, sprite: 'icons/brand-mark.svg', boost: 'Preview choice', title: `Choose ${label}`, active: i === 0 }));
grid.addEventListener('item-pick', event => {
  const { id } = (event as CustomEvent<{ id: string }>).detail;
  grid.items = grid.items.map(item => ({ ...item, active: item.id === id }));
  document.querySelector('#item-result')!.textContent = `Selected ${id}. Preview only; nothing was saved.`;
});

class CatalogDialog extends BaseDialog {
  constructor() {
    super('catalog-dialog', 'catalog-dialog-title');
    this.$title.textContent = 'Example choice';
    this.$body.innerHTML = '<label for="choice">Nature</label><select id="choice" class="ds-field"><option>Modest</option><option>Adamant</option></select><p>Try keyboard navigation, Escape, or Save. This preview does not change application data.</p>';
    this.$footer.innerHTML = '<button type="button" class="ds-btn ds-btn--solid">Save choice</button>';
    this.$footer.hidden = false;
    this.$footer.querySelector('button')!.addEventListener('click', () => {
      document.querySelector('#dialog-result')!.textContent = `Preview saved: ${this.$body.querySelector('select')!.value}.`;
      this.close();
    });
  }
  _onEnter(): void { this.$footer.querySelector('button')!.click(); }
  showPreview(compact: boolean): void {
    this.$dialog.classList.toggle('ds-dialog--compact', compact);
    this.open();
  }
}
declare global {
  interface HTMLElementTagNameMap {
    'catalog-dialog': CatalogDialog;
  }
}
customElements.define('catalog-dialog', CatalogDialog);
const dialog = document.querySelector('catalog-dialog')!;
document.querySelector('#open-full')!.addEventListener('click', () => dialog.showPreview(false));
document.querySelector('#open-compact')!.addEventListener('click', () => dialog.showPreview(true));
