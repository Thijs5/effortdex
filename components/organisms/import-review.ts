import { BaseElement } from '../base-element.ts';
import { store } from '../../lib/services.ts';
import { decodeTransferPayload } from '../../lib/transfer.ts';
import * as router from '../../lib/router.ts';
import { titleCase, totalEvs, escapeHtml } from '../../lib/utils.ts';
import { FALLBACK_SPRITE, FALLBACK_ONERROR } from '../../lib/constants.ts';
import type { ExportedParty } from '../../lib/store.ts';

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
        .file-picker input[type="file"] { display: none; }
        .status { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }

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
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-3);
          margin-bottom: var(--space-3);
        }
        .party-name { margin: 0; font-family: var(--font-display); font-size: var(--font-size-lg); display: inline-flex; gap: var(--space-2); align-items: center; }
        .party-meta {
          margin: var(--space-1) 0 0;
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        .rows { display: grid; gap: var(--space-2); }
        .row-sprite {
          width: 28px;
          height: 28px;
          object-fit: contain;
          image-rendering: pixelated;
          flex: 0 0 auto;
        }
        .row-text { display: grid; gap: 0.15em; min-width: 0; flex: 1; }
        .row-name { font-weight: 600; }
        .row-detail { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .badge-new { background: var(--gold-soft); }

        .footer {
          position: sticky;
          bottom: 0;
          padding-top: var(--space-4);
          margin-top: calc(-1 * var(--space-2));
          background: var(--paper-panel);
          border-top: 1px solid var(--line);
        }
        .footer[hidden] { display: none; }
        .footer-inner { padding-top: var(--space-3); }
      </style>

      <div class="intake">
        <p class="intake-message"></p>
        <form class="paste-row">
          <input class="ds-field" type="text" placeholder="Paste a transfer link here" aria-label="Transfer link" />
          <button type="button" class="ds-btn ds-btn--outline" data-action="paste">Paste</button>
          <button type="submit" class="ds-btn ds-btn--primary">Open</button>
        </form>
        <div class="divider">or</div>
        <div class="file-picker">
          <label class="ds-btn ds-btn--outline" for="transfer-file-input">Choose a transfer file&hellip;</label>
          <input id="transfer-file-input" type="file" accept=".txt,text/plain" />
        </div>
        <p class="status" aria-live="polite"></p>
      </div>

      <div class="parties"></div>
      <div class="footer" hidden>
        <div class="footer-inner">
          <button type="button" class="ds-btn ds-btn--primary" data-action="import" disabled>Import selected (0)</button>
        </div>
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
  _parties: ExportedParty[] | null = null; // decoded payload (Store#exportPayload shape)
  _preview: ImportPreview | null = null; // Store#previewImport output
  _selected = new Set<string>();
  _loadedPayload: string | null = null;

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

  // The URL is the single source of truth for what's loaded: pasting a
  // link/payload or picking a file navigates to #/transfer/import/<payload>
  // rather than loading it in place, so the address bar always matches
  // what's on screen (shareable, bookmarkable, survives a refresh).
  // app.js's route-change handler is what actually calls `_load` below,
  // via the `payload` setter.
  set payload(str: string | null | undefined) {
    if (str === this._loadedPayload) return; // already showing this exact payload
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

  async _loadFromFile(): Promise<void> {
    const file = this.$fileInput.files?.[0];
    this.$fileInput.value = ''; // let picking the same file again re-fire 'change'
    if (!file) return;
    const payload = (await file.text()).trim();
    router.navigateToPath(router.importPath(payload));
  }

  _showIntake(message: string, isError = false): void {
    this._parties = null;
    this._preview = null;
    this._selected = new Set();
    this._loadedPayload = null;
    this.$parties.hidden = true;
    this.$footer.hidden = true;
    this.$intake.hidden = false;
    this.$intakeMessage.textContent = message;
    this.$intakeMessage.classList.toggle('error', isError);
    this.$status.textContent = '';
  }

  async _load(str: string): Promise<void> {
    this._showIntake('Reading transfer data…');

    try {
      this._parties = await decodeTransferPayload(str);
    } catch {
      this._showIntake('That link or file is invalid or corrupted. Try again, or ask for a fresh one.', true);
      return;
    }
    this._loadedPayload = str;

    this._preview = store.previewImport(this._parties);
    for (const party of this._preview) {
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

      const allUids = party.pokemon.map((m) => m.uid);
      const allSelected = allUids.length > 0 && allUids.every((uid) => this._selected.has(uid));

      group.innerHTML = `
        <div class="party-header">
          <div>
            <h3 class="party-name">${escapeHtml(party.name)}${party.isNew ? ' <span class="ds-pill-badge badge-new">New party</span>' : ''}</h3>
            ${party.baseGame ? `<p class="party-meta">${escapeHtml(party.baseGame)}</p>` : ''}
          </div>
          <button type="button" class="ds-btn ds-btn--sm ds-btn--outline" data-select-all>
            ${allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div class="rows"></div>
      `;

      const rows = group.querySelector('.rows')!;
      for (const mon of party.pokemon) {
        const p = mon.preview;
        const displayName = p.nickname || titleCase(p.speciesName);
        const badgeText = mon.isNew ? 'New' : mon.newEventCount > 0 ? `+${mon.newEventCount} events` : 'Up to date';
        const badgeClass = mon.isNew || mon.newEventCount > 0 ? 'ds-pill-badge badge-new' : 'ds-pill-badge';
        const selected = this._selected.has(mon.uid);

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ds-item-btn';
        if (selected) row.classList.add('ds-item-btn--active');
        row.setAttribute('aria-pressed', String(selected));
        row.innerHTML = `
          <img class="row-sprite" src="${p.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
          <div class="row-text">
            <span class="row-name">${escapeHtml(displayName)}</span>
            <span class="row-detail">Lv. ${p.level} &middot; ${totalEvs(p.evs)} EVs &middot; <span class="${badgeClass}">${badgeText}</span></span>
          </div>
        `;
        row.addEventListener('click', () => {
          if (this._selected.has(mon.uid)) this._selected.delete(mon.uid);
          else this._selected.add(mon.uid);
          this.render();
        });
        rows.appendChild(row);
      }

      group.querySelector('[data-select-all]')!.addEventListener('click', () => {
        if (allSelected) for (const uid of allUids) this._selected.delete(uid);
        else for (const uid of allUids) this._selected.add(uid);
        this.render();
      });

      this.$parties.appendChild(group);
    }
    this.$importBtn.disabled = this._selected.size === 0;
    this.$importBtn.textContent = `Import selected (${this._selected.size})`;
  }

  _doImport(): void {
    if (!this._parties || this._selected.size === 0) return;
    store.applyImport(this._parties, this._selected);
    router.navigateHome();
  }
}
customElements.define('import-review', ImportReview);
