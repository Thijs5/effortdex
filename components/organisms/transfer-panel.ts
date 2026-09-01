import { store } from '../../lib/services.ts';
import { encodeTransferPayload } from '../../lib/transfer.ts';
import { importPath } from '../../lib/router.ts';
import { BaseElement } from '../base-element.ts';

// Not a hard browser limit (modern browsers handle hash-fragment URLs far
// longer than this) — it's a heuristic for "some third-party app this
// link gets pasted into might mangle it": SMS gateways, older embedded/
// in-app browsers, and some clipboard-limited text fields have a history
// of choking well before any real browser would. Past this, a plain hint
// points at the (always-available) "Save as file" button as an escape
// hatch — nothing is hidden or gated on it.
const LONG_LINK_WARNING_CHARS = 8000;

const COPY_FEEDBACK_MS = 2000;

const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/**
 * <transfer-panel> — Settings' "Transfer to another device" screen.
 * Encodes the current device's full roster into a shareable link
 * (compressed + base64url, see lib/transfer.js) and offers to copy it,
 * save it as a plain-text file (no length limit at all — for whatever
 * channel, email/cloud drive/USB/AirDrop, the user ends up moving it
 * through), or hand it to the OS share sheet via the Web Share API where
 * supported (which is also how nearby-device transfer works — AirDrop,
 * Nearby Share, etc. all show up as share-sheet targets there, so no
 * separate proximity mechanism is needed).
 *
 * `refresh()` (re)generates the link from current state — call it
 * whenever this view becomes visible, rather than once at page load, so
 * an idle tab never pays the encode cost for a screen no one is looking
 * at. app.js does this on every #/transfer/export render.
 */
export class TransferPanel extends BaseElement {
  static template = `
      <style>
        :host { display: block; }

        .hint { margin: 0 0 var(--space-3); color: var(--ink-soft); }
        .intro { color: var(--ink); }
        .link-row { margin-bottom: var(--space-3); }
        .link-field { font-size: var(--font-size-sm); }
        .actions { display: flex; gap: var(--space-3); flex-wrap: wrap; }
        .actions .ds-btn { display: inline-flex; align-items: center; gap: var(--space-2); }
        .actions .ds-btn svg { flex: 0 0 auto; width: 16px; height: 16px; }
        .status { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .long-link-note { margin: var(--space-3) 0 0; color: var(--ink-soft); }
        [data-action="copy"].is-copied { background: var(--teal-soft); border-color: var(--teal); color: var(--teal-strong); }
      </style>
      <p class="hint intro">
        This link carries a copy of every party and roster Pok&eacute;mon on
        this device. Opening it on another device lets you pick exactly
        which ones to bring in &mdash; nothing changes here until then.
      </p>
      <div class="link-row">
        <input class="ds-field link-field" type="text" readonly aria-label="Shareable transfer link" />
      </div>
      <div class="actions">
        <button type="button" class="ds-btn ds-btn--primary" data-action="share" hidden>${ICON_SHARE}<span>Share&hellip;</span></button>
        <button type="button" class="ds-btn ds-btn--outline" data-action="copy">${ICON_COPY}<span>Copy link</span></button>
        <button type="button" class="ds-btn ds-btn--outline" data-action="download">${ICON_DOWNLOAD}<span>Save as file</span></button>
      </div>
      <p class="status" aria-live="polite"></p>
      <p class="long-link-note hint" hidden>
        This link is long &mdash; some apps cut off very long links when
        pasted. If sharing it directly doesn't work, use "Save as file"
        above instead and send that file however you like.
      </p>
    `;

  $link: HTMLInputElement;
  $shareBtn: HTMLButtonElement;
  $copyBtn: HTMLButtonElement;
  $downloadBtn: HTMLButtonElement;
  $status: HTMLElement;
  $longLinkNote: HTMLElement;
  _url = '';
  _payload = '';
  _copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.$link = this.$<HTMLInputElement>('.link-field');
    this.$shareBtn = this.$<HTMLButtonElement>('[data-action="share"]');
    this.$copyBtn = this.$<HTMLButtonElement>('[data-action="copy"]');
    this.$downloadBtn = this.$<HTMLButtonElement>('[data-action="download"]');
    this.$status = this.$('.status');
    this.$longLinkNote = this.$('.long-link-note');
  }

  connectedCallback(): void {
    this.$shareBtn.hidden = typeof navigator.share !== 'function';
    this.$shareBtn.addEventListener('click', () => this._share());
    this.$copyBtn.addEventListener('click', () => this._copy());
    this.$downloadBtn.addEventListener('click', () => this._download());
  }

  async refresh(): Promise<void> {
    this._url = '';
    this._payload = '';
    this.$link.value = '';
    this.$status.textContent = 'Generating link…';
    this.$copyBtn.disabled = true;
    this.$shareBtn.disabled = true;
    this.$downloadBtn.disabled = true;
    this.$longLinkNote.hidden = true;

    const parties = store.exportPayload();
    this._payload = await encodeTransferPayload(parties);
    this._url = `${location.origin}${location.pathname}${importPath(this._payload)}`;

    this.$link.value = this._url;
    this.$copyBtn.disabled = false;
    this.$shareBtn.disabled = false;
    this.$downloadBtn.disabled = false;
    this.$status.textContent = '';
    this.$longLinkNote.hidden = this._url.length <= LONG_LINK_WARNING_CHARS;
  }

  async _copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this._url);
      this._flashCopied();
    } catch {
      this.$link.select();
      this.$status.textContent = 'Could not copy automatically — select and copy the link above.';
    }
  }

  _flashCopied(): void {
    clearTimeout(this._copyResetTimer);
    this.$copyBtn.innerHTML = `${ICON_CHECK}<span>Copied</span>`;
    this.$copyBtn.classList.add('is-copied');
    this._copyResetTimer = setTimeout(() => {
      this.$copyBtn.innerHTML = `${ICON_COPY}<span>Copy link</span>`;
      this.$copyBtn.classList.remove('is-copied');
    }, COPY_FEEDBACK_MS);
  }

  _download(): void {
    const blob = new Blob([this._payload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `effortdex-transfer-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async _share(): Promise<void> {
    try {
      await navigator.share({ url: this._url, title: 'Effortdex transfer link' });
    } catch {
      /* the user cancelled the share sheet, or it failed — nothing to report */
    }
  }
}
customElements.define('transfer-panel', TransferPanel);
