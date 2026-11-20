import { BaseElement } from '../base-element.ts';
import { store } from '../../lib/services.ts';
import * as router from '../../lib/router.ts';
import { titleCase, totalEvs, escapeHtml } from '../../lib/utils.ts';
import { FALLBACK_SPRITE, FALLBACK_ONERROR } from '../../lib/constants.ts';
import type { ImportRequest, ImportResponse } from '../../import-worker.ts';

const PROMPT_MESSAGE = 'Paste a transfer link, or choose a saved transfer file.';

type ImportPreview = ReturnType<typeof store.previewImport>;

/**
 * <import-review> — the screen a shared transfer link
 * (#/transfer/import/<payload>) opens to, or that's reached directly
 * (#/transfer/import, no payload) to paste a
 * link's data or load a saved transfer file (the "Save as file" fallback
 * in <transfer-panel> for a link too long to share comfortably). Either
 * way, once a payload is decoded it's compared against local state (via
 * Store#previewImport), then the user picks exactly which Pokémon to
 * bring in, Pokémon by Pokémon (with a per-party "select/deselect all"
 * convenience) — nothing is written to this device until "Import
 * selected" is pressed.
 */
export class ImportReview extends BaseElement {
  static template = `
      <style>
        :host { display: block; }

        .intake { margin-bottom: var(--space-5); }
        .intake-message { margin: 0 0 var(--space-3); color: var(--ink-soft); }
        .intake-message.error { color: var(--poke-red); font-weight: 600; }
        .paste-row { display: flex; gap: var(--space-2); }
        .paste-row input { flex: 1; min-width: 0; }
        .divider { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-4) 0; color: var(--ink-soft); font-size: var(--font-size-2xs); text-transform: uppercase; letter-spacing: 0.08em; }
        .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--lcd-line); }
        .file-picker input[type="file"] { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); }
        .file-picker input:focus-visible + label { outline: 3px solid var(--teal); outline-offset: 2px; }
        .file-picker label { display: inline-flex; align-items: center; min-height: 44px; }
        .status { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .ds-btn, .ds-pill-badge { white-space: nowrap; }

        .party-group {
          padding-bottom: var(--space-4);
          margin-bottom: var(--space-4);
          border-bottom: 1px solid var(--line);
        }
        .party-group:last-child {
          padding-bottom: 0;
          margin-bottom: 0;
          border-bottom: none;
        }
        .party-header {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: var(--space-2);
          margin-bottom: var(--space-3);
          padding-inline-end: var(--space-3);
        }
        .party-name { margin: 0; font-family: var(--font-display); font-size: var(--font-size-lg); overflow-wrap: anywhere; }
        .party-meta {
          margin: var(--space-1) 0 0;
          font-size: var(--font-size-2xs);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        .rows { display: grid; gap: var(--space-2); }
        .row { gap: var(--space-2); }
        .row, .row input { scroll-margin-block-end: calc(44px + 2 * var(--space-3) + env(safe-area-inset-bottom, 0px)); }
        .row:has(input:checked) { border-color: var(--teal); }
        .row:has(input:focus-visible) { outline: 3px solid var(--teal); outline-offset: 2px; }
        .selection { display: grid; place-items: center; min-width: 44px; min-height: 44px; cursor: pointer; }
        input[type="checkbox"] { width: 1rem; height: 1rem; margin: 0; accent-color: var(--teal); cursor: pointer; }
        .row-sprite {
          width: 28px;
          height: 28px;
          object-fit: contain;
          image-rendering: pixelated;
          flex: 0 0 auto;
        }
        .row-text { display: grid; gap: 0.15em; min-width: 0; flex: 1; }
        .row-name { color: var(--ink); font-size: var(--font-size-sm); overflow-wrap: anywhere; }
        .row-detail { font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .badge-current { background: var(--lcd); color: var(--ink-soft); }

        .footer {
          position: sticky;
          bottom: 0;
          padding-block: var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
          margin-top: var(--space-4);
          background: var(--paper-panel);
          border-top: 1px solid var(--line);
        }
        .footer[hidden] { display: none; }
        .footer .ds-btn { width: 100%; min-height: 44px; }
      </style>

      <div class="intake">
        <p class="intake-message" role="status"></p>
        <form class="paste-row">
          <input class="ds-field" type="text" placeholder="Paste a transfer link here" aria-label="Transfer link" />
          <button type="button" class="ds-btn ds-btn--outline" data-action="paste">Paste</button>
          <button type="submit" class="ds-btn ds-btn--primary">Open</button>
        </form>
        <div class="divider">or</div>
        <div class="file-picker">
          <input id="transfer-file-input" type="file" accept=".txt,text/plain" />
          <label class="ds-btn ds-btn--outline" for="transfer-file-input">Choose a transfer file&hellip;</label>
        </div>
        <p class="status" aria-live="polite"></p>
      </div>

      <div class="parties"></div>
      <div class="footer" hidden>
        <button type="button" class="ds-btn ds-btn--primary" data-action="import" disabled>Import selected (0)</button>
      </div>
    `;

  $intake: HTMLElement;
  $intakeMessage: HTMLElement;
  $pasteForm: HTMLFormElement;
  $pasteInput: HTMLInputElement;
  $pasteBtn: HTMLButtonElement;
  $fileInput: HTMLInputElement;
  $status: HTMLElement;
  $parties: HTMLElement;
  $footer: HTMLElement;
  $importBtn: HTMLButtonElement;
  _preview: ImportPreview | null = null; // Store#previewImport output
  _selected = new Set<string>();
  _routePayload: string | null | undefined;
  _worker: Worker | null = null;

  constructor() {
    super();
    this.$intake = this.$('.intake');
    this.$intakeMessage = this.$('.intake-message');
    this.$pasteForm = this.$<HTMLFormElement>('.paste-row');
    this.$pasteInput = this.$<HTMLInputElement>('.paste-row input');
    this.$pasteBtn = this.$<HTMLButtonElement>('[data-action="paste"]');
    this.$fileInput = this.$<HTMLInputElement>('#transfer-file-input');
    this.$status = this.$('.status');
    this.$parties = this.$('.parties');
    this.$footer = this.$('.footer');
    this.$importBtn = this.$<HTMLButtonElement>('[data-action="import"]');

    this.$importBtn.addEventListener('click', () => this._doImport());
    this.$fileInput.addEventListener('change', () => this._loadFromFile());
    this.$pasteBtn.addEventListener('click', () => this._pasteFromClipboard());
    this.$pasteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._loadFromPastedText(this.$pasteInput.value);
    });
    this.$parties.hidden = true;
    this._showIntake(PROMPT_MESSAGE);
  }

  // Shared links are bookmarkable. Local files stay in this review session.
  set payload(str: string | null | undefined) {
    if (str === this._routePayload) return;
    this._routePayload = str;
    if (str) this._load(str);
    else this._showIntake(PROMPT_MESSAGE);
  }

  async _pasteFromClipboard(): Promise<void> {
    this.$status.textContent = '';
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        this.$status.textContent = 'Clipboard is empty.';
        return;
      }
      this.$pasteInput.value = text;
      this._loadFromPastedText(text);
    } catch {
      this.$status.textContent = 'Could not read the clipboard automatically — paste into the field with Ctrl/Cmd+V instead.';
    }
  }

  // Accepts either a full shared link or just its payload substring, in
  // case someone pastes the raw payload (e.g. copied from a file) rather
  // than the whole URL.
  _loadFromPastedText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const marker = '#/transfer/import/';
    const idx = trimmed.indexOf(marker);
    const payload = idx === -1 ? trimmed : trimmed.slice(idx + marker.length);
    router.navigateToPath(router.importPath(payload));
  }

  _loadFromFile(): void {
    const file = this.$fileInput.files?.[0];
    this.$fileInput.value = ''; // let picking the same file again re-fire 'change'
    if (file) this._load(file);
  }

  _showIntake(message: string, isError = false): void {
    this._worker?.terminate();
    this._worker = null;
    this._preview = null;
    this._selected.clear();
    this.$parties.replaceChildren();
    this.$parties.hidden = true;
    this.$parties.inert = false;
    this.$footer.hidden = true;
    this.$intake.hidden = false;
    this.$intakeMessage.textContent = message;
    this.$intakeMessage.classList.toggle('error', isError);
    this.$status.textContent = '';
  }

  _load(source: File | string): void {
    this._showIntake('Reading transfer data…');
    const fail = () => this._showIntake('Could not read this transfer. Try opening the file or link again.', true);

    try {
      const worker = new Worker(new URL('import-worker.js', document.baseURI), { type: 'module' });
      this._worker = worker;
      worker.onmessage = ({ data }: MessageEvent<ImportResponse>) => {
        if (this._worker !== worker) return;
        if (data.type === 'preview') this._showPreview(data.parties);
        else if (data.type === 'apply') {
          store.applyImport(data.parties, new Set(data.selected));
          router.navigateHome();
        } else fail();
      };
      worker.onerror = () => { if (this._worker === worker) fail(); };
      worker.onmessageerror = () => { if (this._worker === worker) fail(); };
      const locals = store.state.parties.map(party => ({
        id: party.id,
        pokemon: party.pokemon.map(entry => ({
          uid: entry.uid,
          events: entry.events.map(({ id }) => ({ id })),
        })),
      }));
      worker.postMessage({ type: 'preview', source, locals } satisfies ImportRequest);
    } catch {
      fail();
    }
  }

  _showPreview(preview: ImportPreview): void {
    this._preview = preview;
    for (const party of preview) {
      for (const mon of party.pokemon) {
        if (mon.isNew || mon.newEventCount > 0) this._selected.add(mon.uid);
      }
    }

    this.$intake.hidden = true;
    this.$parties.hidden = false;
    this.$footer.hidden = false;
    this.render();
  }

  protected render(): void {
    if (!this._preview) return;
    this.$parties.innerHTML = '';
    for (const party of this._preview) {
      const group = document.createElement('div');
      group.className = 'party-group';

      group.innerHTML = `
        <div class="party-header">
          <label class="selection">
            <input type="checkbox" data-select-all aria-label="Select all Pokémon in ${escapeHtml(party.name)}" />
          </label>
          <div>
            <h3 class="party-name">${escapeHtml(party.name)}</h3>
            ${party.baseGame ? `<p class="party-meta">${escapeHtml(party.baseGame)}</p>` : ''}
          </div>
          ${party.isNew ? '<span class="ds-pill-badge">New party</span>' : ''}
        </div>
        <div class="rows"></div>
      `;

      const rows = group.querySelector('.rows')!;
      rows.innerHTML = party.pokemon.map(mon => {
        const p = mon.preview;
        const displayName = p.nickname || titleCase(p.speciesName);
        const badgeText = mon.isNew ? 'New' : mon.newEventCount > 0 ? `+${mon.newEventCount} events` : 'Up to date';
        const badgeClass = mon.isNew || mon.newEventCount > 0 ? 'ds-pill-badge' : 'ds-pill-badge badge-current';
        return `<label class="row ds-item-btn">
          <input type="checkbox" value="${escapeHtml(mon.uid)}" ${this._selected.has(mon.uid) ? 'checked' : ''} />
          <img class="row-sprite" src="${escapeHtml(p.sprite || FALLBACK_SPRITE)}" alt="" loading="lazy" ${FALLBACK_ONERROR} />
          <span class="row-text">
            <span class="row-name">${escapeHtml(displayName)}</span>
            <span class="row-detail">Lv. ${p.level} &middot; ${totalEvs(p.evs)} EVs</span>
          </span>
          <span class="${badgeClass}">${badgeText}</span>
        </label>`;
      }).join('');

      const selectAll = group.querySelector<HTMLInputElement>('[data-select-all]')!;
      const checkboxes = [...rows.querySelectorAll<HTMLInputElement>('input')];
      const syncGroup = () => {
        const checkedCount = checkboxes.filter(input => input.checked).length;
        selectAll.disabled = checkboxes.length === 0;
        selectAll.checked = checkedCount > 0 && checkedCount === checkboxes.length;
        selectAll.indeterminate = checkedCount > 0 && !selectAll.checked;
      };
      const updateSelection = (input: HTMLInputElement) => {
        if (input.checked) this._selected.add(input.value);
        else this._selected.delete(input.value);
      };
      group.addEventListener('change', ({ target }) => {
        if (!(target instanceof HTMLInputElement)) return;
        if (target === selectAll) {
          for (const input of checkboxes) {
            input.checked = selectAll.checked;
            updateSelection(input);
          }
        } else updateSelection(target);
        syncGroup();
        this._updateImportAction();
      });
      syncGroup();
      this.$parties.appendChild(group);
    }
    this._updateImportAction();
  }

  _updateImportAction(): void {
    this.$importBtn.disabled = this._selected.size === 0;
    this.$importBtn.textContent = `Import selected (${this._selected.size})`;
  }

  _doImport(): void {
    if (!this._worker || this.$importBtn.disabled) return;
    this.$importBtn.disabled = true;
    this.$importBtn.textContent = 'Importing…';
    this.$parties.inert = true;
    this._worker.postMessage({ type: 'apply', selected: [...this._selected] } satisfies ImportRequest);
  }
}
customElements.define('import-review', ImportReview);
