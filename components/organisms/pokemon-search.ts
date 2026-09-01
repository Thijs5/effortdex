import { api } from '../../lib/services.ts';
import { titleCase, formatEvYield } from '../../lib/utils.ts';
import { FALLBACK_SPRITE, FALLBACK_ONERROR } from '../../lib/constants.ts';
import { BaseElement } from '../base-element.ts';
import { attachPointerSelection, syncActiveDescendant } from '../../lib/combobox.ts';
import type { SpeciesListEntry, DomainPokemon } from '../../lib/pokeapi-client.ts';
import type { EvMap } from '../../lib/constants.ts';

// Narrow + coarse-pointer only, so a resized desktop window (narrow but
// mouse-driven) keeps the inline dropdown, and a touch laptop at full
// width doesn't get forced into the full-screen sheet.
const MOBILE_QUERY = '(max-width: 640px) and (pointer: coarse)';

// How many recently-picked species (via the `recent` property) show up
// when the field is focused with nothing typed yet.
const RECENT_LIMIT = 5;

type EvModifier = (mon: DomainPokemon) => EvMap | undefined;

/**
 * <pokemon-search placeholder="…" show-ev-yield>
 * Autocomplete text input over the full PokeAPI species list, styled to
 * match <game-version-picker> (sprite/swatch + label rows, same tap
 * targets and dropdown chrome). Dispatches a `pokemon-pick` CustomEvent
 * (detail: { name }) when a species is chosen.
 *
 * On narrow touch viewports, focusing the input opens a full-screen
 * sheet instead of an inline dropdown: a header, then the input, then
 * results filling the rest — same top-anchored layout as a native app's
 * search (iOS Spotlight, Android search). A dropdown anchored to the
 * input doesn't work well there — the keyboard eats most of the screen,
 * and anchoring is fighting the viewport instead of using it. Anchoring
 * the input to the *bottom*, next to the keyboard, was tried first, but
 * it strands the input far from a still-loading or empty results list
 * with a dead gap between them (and permanently so wherever no software
 * keyboard appears — an external keyboard, a foldable, a tablet).
 *
 * `show-ev-yield` shows each result's EV yield (fetched lazily, per
 * visible row — cached, so repeat lookups anywhere are free). Set only
 * where that number matters to the choice (battle logging), not where a
 * species is picked to add it.
 *
 * `evModifier` (a settable property, function or null) — when set, each
 * row's shown yield is `evModifier(mon)` instead of `mon.evYield`, so a
 * caller can fold in whatever the actual applied gain would be (held
 * item, Pokérus, EV caps already reached) rather than the opponent's raw
 * base yield. Falls back to the raw yield when unset.
 *
 * `recent` (a settable property, not an attribute — it's data, not a
 * string) is a `{ name, sprite }[]`, most-recent-first. Assign it to
 * offer quick reselection of recently-picked species before typing.
 *
 * `allowedSpecies` (a settable property, `Set<string>|null`) restricts
 * suggestions/direct-pick to that set of species names when set; `null`
 * (default) is unrestricted. See `lib/species-availability.js`.
 */
export class PokemonSearch extends BaseElement {
  static template = `
      <style>
        :host { display: block; position: relative; min-width: 180px; flex: 1; }
        /* Shadow hosts need this spelled out explicitly — the UA default
           hidden-attribute rule loses to this component's own :host
           display: block otherwise. Lets a caller that owns a standalone
           force-sheet instance (no wrapping dialog of its own) fully hide
           it between uses via the plain hidden attribute, the same way
           every other optional element in this app already works. */
        :host([hidden]) { display: none; }
        .wrap { position: relative; }
        ul {
          position: fixed;
          z-index: 20;
          margin: 0;
          padding: var(--space-1);
          list-style: none;
          background: var(--surface);
          border: 1px solid var(--lcd-line);
          border-radius: var(--radius-sm);
          box-shadow: var(--shadow-suggestions);
          max-height: 260px;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        li.option {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          min-height: 44px;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-md);
          text-transform: capitalize;
          cursor: pointer;
        }
        li.option.active, li.option:hover { background: var(--lcd); }
        .option-num {
          flex: 0 0 auto;
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--ink-soft);
        }
        .option-name {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .option-ev-yield {
          flex: 0 0 auto;
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--teal);
          white-space: nowrap;
        }
        .thumb {
          flex: 0 0 auto;
          width: 28px;
          height: 28px;
          image-rendering: pixelated;
          background: var(--sprite-bg);
          border-radius: var(--radius-sm);
          object-fit: contain;
        }
        li.status {
          padding: var(--space-2) var(--space-3);
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--ink-soft);
          cursor: default;
        }

        .sheet-header { display: none; }
        .wrap.sheet {
          position: fixed;
          left: 0;
          right: 0;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          background: var(--surface);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .wrap.sheet .sheet-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          order: 0;
          flex: 0 0 auto;
          padding: var(--space-3);
          border-bottom: 1px solid var(--lcd-line);
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
        }
        .sheet-close {
          border: none; background: transparent; cursor: pointer;
          font-size: var(--font-size-lg); line-height: 1;
          color: var(--ink-soft); padding: var(--space-1);
        }
        .sheet-close:hover { color: var(--ink); }
        /* A caller can project extra sheet-only content (e.g. a help
           note) via slot="sheet-extra" — hidden outside the sheet, since
           it has nowhere sensible to render in the inline-dropdown mode. */
        slot[name="sheet-extra"] { display: none; }
        .wrap.sheet slot[name="sheet-extra"] {
          display: block;
          order: 1;
          flex: 0 0 auto;
          padding: 0 var(--space-3);
        }
        .wrap.sheet input.ds-field {
          order: 2;
          flex: 0 0 auto;
          /* .ds-field's shared width: 100% is relative to the flex
             container, same as the margin below — combined they'd
             overflow past the sheet's edges. width: auto instead
             stretches to fill the space the margin leaves. */
          width: auto;
          margin: var(--space-2) var(--space-3);
        }
        .wrap.sheet ul.suggestions {
          order: 3;
          position: static;
          flex: 1 1 auto;
          min-height: 0;
          width: auto;
          max-height: none;
          margin: 0;
          border: none;
          border-radius: 0;
          box-shadow: none;
        }
      </style>
      <div class="wrap">
        <div class="sheet-header">
          <span class="sheet-title"></span>
          <button type="button" class="sheet-close" aria-label="Close search">&#10005;</button>
        </div>
        <slot name="sheet-extra"></slot>
        <input class="ds-field" type="text" role="combobox" aria-expanded="false"
               aria-controls="ps-list" aria-autocomplete="list"
               autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
               inputmode="search" enterkeyhint="go" />
        <ul id="ps-list" class="suggestions" hidden role="listbox"></ul>
      </div>
    `;

  _species: SpeciesListEntry[] | null = null; // loaded lazily on first focus
  _loadingSpecies: Promise<SpeciesListEntry[]> | null = null; // in-flight load promise, so a fast typist isn't lost
  _matches: SpeciesListEntry[] = [];
  _activeIndex = -1;
  _sheetOpen = false;
  _recent: SpeciesListEntry[] = [];
  _showingRecent = false;
  _evModifier: EvModifier | null = null;
  _allowedSpecies: Set<string> | null = null; // null means unrestricted, see `allowedSpecies` setter
  _prevBodyOverflow = '';
  _onViewportChange: () => void = () => {};
  $wrap: HTMLElement;
  $input: HTMLInputElement;
  $list: HTMLUListElement;
  $sheetTitle: HTMLElement;
  $sheetClose: HTMLButtonElement;

  constructor() {
    super();
    this.$wrap = this.$('.wrap');
    this.$input = this.$<HTMLInputElement>('input');
    this.$list = this.$<HTMLUListElement>('.suggestions');
    this.$sheetTitle = this.$('.sheet-title');
    this.$sheetClose = this.$<HTMLButtonElement>('.sheet-close');
  }

  connectedCallback(): void {
    this.$input.placeholder = this.getAttribute('placeholder') || 'Search Pokémon…';
    // Some browser/AT combinations don't compute a placeholder as an
    // accessible name at all — every caller here omits a wrapping
    // <label>, so mirror the placeholder into aria-label explicitly
    // (or an explicit aria-label the caller set, if more descriptive).
    this.$input.setAttribute('aria-label', this.getAttribute('aria-label') || this.$input.placeholder);
    this.$sheetTitle.textContent = this.getAttribute('sheet-title') || 'Search Pokémon';
    this.$input.addEventListener('focus', () => {
      this._ensureSpecies();
      if (this._isMobile() && !this._sheetOpen) this._openSheet();
      if (!this.$input.value.trim()) this._showRecentOrHide();
    });
    this.$input.addEventListener('input', () => this._onInput());
    this.$input.addEventListener('keydown', (e) => this._onKeydown(e));
    // pointerdown on a suggestion fires before this blur, so picking by
    // mouse wins the race against the hide.
    this.$input.addEventListener('blur', () =>
      setTimeout(() => {
        // A blur can be immediately followed by a refocus — e.g. the
        // add dialog opening (blurs this input) then closing (a
        // native <dialog> restores focus to whatever was focused when
        // it opened). Without this check, that stale timeout fires
        // after the refocus and wrongly hides the list it just showed.
        if (this.shadow.activeElement === this.$input) return;
        this._hideList();
        this._closeSheet();
      }, 120)
    );
    this.$sheetClose.addEventListener('click', () => this.$input.blur());
    // Selection on pointerup with a movement threshold (not pointerdown +
    // preventDefault, which breaks touch scrolling on iOS) — shared with
    // <game-version-picker> via lib/combobox.js.
    attachPointerSelection(this.$list, (li) => this._pick(li.dataset.name ?? ''));
    // Both the inline dropdown and the full-screen sheet anchor themselves
    // to the input's on-screen position / the visual viewport, so both
    // need repositioning whenever either can change (scroll, resize, or
    // the on-screen keyboard opening/closing).
    this._onViewportChange = () => this._reposition();
    window.addEventListener('scroll', this._onViewportChange, true);
    window.addEventListener('resize', this._onViewportChange);
    window.visualViewport?.addEventListener('resize', this._onViewportChange);
    window.visualViewport?.addEventListener('scroll', this._onViewportChange);
  }

  disconnectedCallback(): void {
    this._closeSheet();
    window.removeEventListener('scroll', this._onViewportChange, true);
    window.removeEventListener('resize', this._onViewportChange);
    window.visualViewport?.removeEventListener('resize', this._onViewportChange);
    window.visualViewport?.removeEventListener('scroll', this._onViewportChange);
  }

  get recent(): SpeciesListEntry[] {
    return this._recent;
  }

  get evModifier(): EvModifier | null {
    return this._evModifier;
  }

  set evModifier(fn: EvModifier | null) {
    this._evModifier = typeof fn === 'function' ? fn : null;
  }

  get allowedSpecies(): Set<string> | null {
    return this._allowedSpecies;
  }

  /**
   * Restricts suggestions/direct-pick to this set of species names —
   * e.g. a party's own generation-scoped dex (GitHub issue #31,
   * `lib/species-availability.js`). `null` (the default) means
   * unrestricted: per docs/adr/0024, a caller that couldn't resolve the
   * restriction (offline, a failed fetch) should pass `null` rather than
   * an empty set, so a lookup failure never hides species that are
   * actually fine to pick.
   */
  set allowedSpecies(set: Set<string> | null) {
    this._allowedSpecies = set instanceof Set ? set : null;
    // Live-refresh an already-open list (e.g. the party's game resolves
    // shortly after this field opens) the same way a species-list load
    // completing mid-type already does below.
    if (this.$input.value.trim()) this._onInput();
  }

  set recent(list: Array<{ name: string; sprite?: string | null; id?: number | null }> | null | undefined) {
    const seen = new Set<string>();
    this._recent = (list || [])
      .filter((r) => r && r.name && !seen.has(r.name) && seen.add(r.name))
      .slice(0, RECENT_LIMIT)
      .map((r) => ({ name: r.name, sprite: r.sprite || null, id: r.id || null }));
    // Already showing recents with nothing typed — refresh in place so
    // a newly-logged pick shows up without needing a re-focus. Checking
    // actual focus (not just the _showingRecent flag) matters: any
    // store-driven re-render calls this setter, including ones from
    // totally unrelated UI the user clicked after last leaving this
    // field — without the focus check, the recent list could pop back
    // open on its own while the input sits unfocused.
    if (
      this._showingRecent &&
      !this.$input.value.trim() &&
      this.shadow.activeElement === this.$input
    ) {
      this._showRecentOrHide();
    }
  }

  // `force-sheet`: always use the full-screen sheet, regardless of
  // viewport/pointer — for a caller that already lives inside its own
  // modal (the detail page's "Log a battle" dialog). The inline dropdown
  // is `position: fixed`, so it never contributes to that modal's own
  // fit-content sizing — on any device, a longer suggestions/recents list
  // simply hangs off the bottom of the small dialog card past its edge,
  // detached from it, rather than actually being contained by it. The
  // sheet is the one layout here that's actually built to hold the whole
  // list (in-flow, not floating), so it's the only fit for "inside
  // another dialog", not just a narrow-viewport nicety.
  _isMobile(): boolean {
    return this.hasAttribute('force-sheet') || window.matchMedia(MOBILE_QUERY).matches;
  }

  _openSheet(): void {
    this._sheetOpen = true;
    this.$wrap.classList.add('sheet');
    this._prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this._reposition();
  }

  _closeSheet(): void {
    if (!this._sheetOpen) return;
    this._sheetOpen = false;
    this.$wrap.classList.remove('sheet');
    this.$wrap.style.top = '';
    this.$wrap.style.height = '';
    document.body.style.overflow = this._prevBodyOverflow || '';
    // Lets a caller that owns this element's `hidden` attribute (a
    // standalone force-sheet instance with no wrapping <dialog> of its
    // own) re-hide it the moment the sheet closes for any reason — a
    // pick, Escape, or blurring away — without needing its own close
    // affordance duplicated outside this component.
    this.dispatchEvent(new CustomEvent('sheet-close', { bubbles: true, composed: true }));
  }

  _reposition(): void {
    if (this._sheetOpen) this._positionSheet();
    else this._positionDropdown();
  }

  _positionSheet(): void {
    const vv = window.visualViewport;
    this.$wrap.style.top = `${vv?.offsetTop ?? 0}px`;
    this.$wrap.style.height = `${vv?.height ?? window.innerHeight}px`;
  }

  _positionDropdown(): void {
    if (this.$list.hidden) return;
    const vv = window.visualViewport;
    const viewportH = vv?.height ?? window.innerHeight;
    const viewportTop = vv?.offsetTop ?? 0;
    const rect = this.$input.getBoundingClientRect();
    const maxHeight = 260;
    const gap = 4;
    const spaceBelow = viewportTop + viewportH - rect.bottom;
    const openAbove = spaceBelow < Math.min(maxHeight, 120) && rect.top - viewportTop > spaceBelow;

    this.$list.style.left = `${rect.left}px`;
    this.$list.style.width = `${rect.width}px`;
    if (openAbove) {
      this.$list.style.bottom = `${viewportTop + viewportH - rect.top + gap}px`;
      this.$list.style.top = 'auto';
      this.$list.style.maxHeight = `${Math.max(120, rect.top - viewportTop - gap)}px`;
    } else {
      this.$list.style.top = `${rect.bottom + gap}px`;
      this.$list.style.bottom = 'auto';
      this.$list.style.maxHeight = `${Math.max(120, Math.min(maxHeight, spaceBelow - gap))}px`;
    }
  }

  async _ensureSpecies(): Promise<void> {
    if (this._species) return;
    if (!this._loadingSpecies) {
      this._loadingSpecies = api.getAllSpecies().catch(() => []);
    }
    this._species = await this._loadingSpecies;
    // The list can finish loading after the user already started typing —
    // without this, suggestions silently never appear until the *next*
    // keystroke, which read as "autocomplete doesn't work."
    if (this.$input.value.trim()) this._onInput();
  }

  _onInput(): void {
    const q = this.$input.value.trim().toLowerCase();
    this._activeIndex = -1;
    this._showingRecent = false;
    if (!q) {
      this._showRecentOrHide();
      return;
    }
    if (!this._species) {
      this._showLoading();
      return;
    }
    // Matches by name, or by National Dex number as it's displayed —
    // "79", "079" and "#79" all find Slowpoke.
    const qNum = q.replace(/^#/, '').replace(/^0+(?=\d)/, '');
    const byNumber = /^\d+$/.test(qNum);
    this._matches = this._species
      .filter((s) => s.name.includes(q) || (byNumber && String(s.id).startsWith(qNum)))
      .filter((s) => !this._allowedSpecies || this._allowedSpecies.has(s.name))
      .slice(0, 8);
    this._renderList();
  }

  /** With nothing typed, offer recently-picked species instead of an empty field. */
  _showRecentOrHide(): void {
    if (!this._recent.length) {
      this._hideList();
      return;
    }
    this._matches = this._recent;
    this._showingRecent = true;
    this._renderList();
  }

  _showLoading(): void {
    this.$list.innerHTML = '<li class="status" role="presentation">Loading species…</li>';
    this.$list.hidden = false;
    this.$input.setAttribute('aria-expanded', 'true');
    this._reposition();
  }

  _renderList(): void {
    if (!this._matches.length) {
      this.$list.innerHTML = '<li class="status" role="presentation">No matching Pok&eacute;mon.</li>';
      this.$list.hidden = false;
      this.$input.setAttribute('aria-expanded', 'true');
      this._reposition();
      return;
    }
    const showEv = this.hasAttribute('show-ev-yield');
    const header = this._showingRecent ? '<li class="status" role="presentation">Recent</li>' : '';
    this.$list.innerHTML =
      header +
      this._matches
        .map(
          (s) => `<li class="option" role="option" data-name="${s.name}">
            <img class="thumb" src="${s.sprite || FALLBACK_SPRITE}" alt="" loading="lazy" ${FALLBACK_ONERROR} />
            ${s.id ? `<span class="option-num">#${String(s.id).padStart(3, '0')}</span>` : ''}
            <span class="option-name">${titleCase(s.name)}</span>
            ${showEv ? '<span class="option-ev-yield"></span>' : ''}
          </li>`
        )
        .join('');
    this.$list.hidden = false;
    this.$input.setAttribute('aria-expanded', 'true');
    syncActiveDescendant(this.$input, [...this.$list.querySelectorAll<HTMLElement>('li.option')], -1, 'ps-opt');
    this._reposition();
    if (showEv) this._loadEvYields();
  }

  /**
   * Fills in each visible row's EV yield once its full data resolves —
   * cached, so cheap after the first lookup anywhere. With `evModifier`
   * set, shows what would actually be applied (item/Pokérus/caps folded
   * in) rather than the opponent's raw base yield; if that comes out to
   * nothing while the base yield wasn't zero, that's the EV caps already
   * being maxed out, not a data gap, so it's labeled "Capped" instead of
   * left blank.
   */
  _loadEvYields(): void {
    for (const li of this.$list.querySelectorAll<HTMLElement>('li.option')) {
      const name = li.dataset.name ?? '';
      api
        .getPokemon(name)
        .then((mon) => {
          const span = li.querySelector('.option-ev-yield');
          if (!span) return;
          const evs = this._evModifier ? this._evModifier(mon) : mon.evYield;
          const formatted = evs ? formatEvYield(evs) : '';
          const baseHadYield = formatEvYield(mon.evYield) !== '';
          span.textContent = formatted || (this._evModifier && baseHadYield ? 'Capped' : '');
        })
        .catch(() => {});
    }
  }

  _hideList(): void {
    this.$list.hidden = true;
    this.$list.innerHTML = '';
    this.$input.setAttribute('aria-expanded', 'false');
    this.$input.removeAttribute('aria-activedescendant');
    this._showingRecent = false;
  }

  _onKeydown(e: KeyboardEvent): void {
    if (this.$list.hidden) {
      if (e.key === 'Enter') this._tryDirectPick();
      else if (e.key === 'Escape' && this._sheetOpen) this.$input.blur();
      return;
    }
    const items = [...this.$list.querySelectorAll<HTMLElement>('li.option')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, items.length - 1);
      this._highlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._highlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._activeIndex >= 0) this._pick(this._matches[this._activeIndex].name);
      // Nothing arrowed to yet — take the top suggestion rather than
      // requiring an exact name match. Species like Giratina, Deoxys,
      // Wormadam, Basculin and Minior have no PokeAPI entry named
      // exactly after the species (only "giratina-altered" etc.), so
      // typing the species name and hitting Enter would otherwise never
      // match anything, even with matching suggestions right there.
      else if (this._matches.length) this._pick(this._matches[0].name);
      else this._tryDirectPick();
    } else if (e.key === 'Escape') {
      // Consume the key: with the list open, Escape means "close the
      // list" — without preventDefault it would also cancel a
      // surrounding <dialog> (the battle search lives inside the detail
      // card's More dialog) in the same press.
      e.preventDefault();
      this._hideList();
      if (this._sheetOpen) this.$input.blur();
    }
  }

  _highlight(items: HTMLElement[]): void {
    items.forEach((li, i) => li.classList.toggle('active', i === this._activeIndex));
    syncActiveDescendant(this.$input, items, this._activeIndex, 'ps-opt');
    items[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  _tryDirectPick(): void {
    const q = this.$input.value.trim().toLowerCase();
    if (this._species?.some((s) => s.name === q) && (!this._allowedSpecies || this._allowedSpecies.has(q)))
      this._pick(q);
  }

  _pick(name: string): void {
    this.$input.value = '';
    this._hideList();
    const wasSheet = this._sheetOpen;
    this.dispatchEvent(
      new CustomEvent('pokemon-pick', { detail: { name }, bubbles: true, composed: true })
    );
    if (wasSheet) {
      this.$input.blur();
    } else if (this.shadow.activeElement === this.$input) {
      // The input stays focused after a mouse pick (see the pointerdown
      // handler above) — without this, re-picking another recent option
      // needs a full blur-then-refocus, since clicking an already-focused
      // input doesn't fire a new 'focus' event to bring the list back.
      this._showRecentOrHide();
    }
  }

  clear(): void {
    this.$input.value = '';
    this._hideList();
  }

  // Overrides HTMLElement's no-op focus() (the shadow input is the real
  // focusable element, not the host) — callers use this to jump straight
  // into the field (and, via the 'focus' listener above, its full-screen
  // sheet on mobile with recents already showing) without the user
  // needing an extra tap on the input itself.
  focus(): void {
    this.$input.focus();
  }

  // Overrides HTMLElement's no-op blur() — the host itself is never the
  // focused element, the shadow input is. Callers use this to defocus
  // after e.g. a dialog closes, since a <dialog> closing restores focus
  // to whatever was focused when it opened, which re-focuses this input
  // and (via the 'focus' listener above) pops the suggestions/sheet
  // straight back open.
  blur(): void {
    this.$input.blur();
  }
}
customElements.define('pokemon-search', PokemonSearch);
