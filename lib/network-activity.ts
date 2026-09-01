// Drives the header's power LED as a network activity indicator, styled
// after a router's link light rather than a plain on/off dot: "ready"
// (blue) while online and idle, "sending" (orange) while a request is
// in flight, a brief "receiving" (green) flash once one completes, and
// "off" (dark, no glow) whenever the browser reports offline.
//
// `attach()` wraps the global `fetch` exactly once, so every network
// call anywhere in the app — PokeApiClient's (ADR 0001), version-check's
// — is observed automatically. No call site needs to import this or
// know it exists; lib/shell.js is the only place that constructs and
// wires it, alongside the app's other chrome-only setup.
//
// One deliberate exception: `lib/prefetch-service.js`'s *automatic*,
// idle-time background scan (ADR 0011) wraps its own fetches in
// `withoutNetworkActivity` below. That scan's whole design point is to
// never be visible around anything the user is doing — a LED that lit
// up and kept flickering right after the app loads, driven entirely by
// silent background maintenance the user never asked for, would
// contradict that (see ADR 0012's addendum). Manually-triggered work —
// a search, adding a Pokémon, the sprite cache manager's own Cache/Clear buttons
// — is deliberately *not* suppressed: the user asked for that traffic,
// so the LED responding to it is exactly the point.
const RECEIVING_FLASH_MS = 250;

// Depth counter, not a boolean: nested/concurrent suppressed calls
// (the prefetch queue runs several species at once) must not have an
// early one's `finally` re-enable tracking while a later one is still
// running.
let suppressDepth = 0;

/** Runs `fn` (which performs some `fetch()` calls, directly or several
 * layers deep) without those calls driving the power LED. Safe to nest. */
export async function withoutNetworkActivity<T>(fn: () => Promise<T>): Promise<T> {
  suppressDepth++;
  try {
    return await fn();
  } finally {
    suppressDepth--;
  }
}

export type NetworkStatus = 'off' | 'ready' | 'sending' | 'receiving';

interface NetworkActivityDeps {
  isOnline?: () => boolean;
  onOnlineChange?: (notify: () => void) => void;
  flashMs?: number;
}

export class NetworkActivity extends EventTarget {
  private _isOnline: () => boolean;
  private _flashMs: number;
  private _pending = 0;
  private _flashTimer: ReturnType<typeof setTimeout> | null = null;
  private _attached = false;

  /**
   * `isOnline`/`onOnlineChange` are injectable (defaulting to the real
   * `navigator`/`window`) purely so tests can drive online/offline
   * transitions without touching global state.
   */
  constructor({ isOnline = () => navigator.onLine, onOnlineChange, flashMs = RECEIVING_FLASH_MS }: NetworkActivityDeps = {}) {
    super();
    this._isOnline = isOnline;
    this._flashMs = flashMs;

    const notify = () => this._notify();
    if (onOnlineChange) {
      onOnlineChange(notify);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('online', notify);
      window.addEventListener('offline', notify);
    }
  }

  get status(): NetworkStatus {
    if (!this._isOnline()) return 'off';
    // "Sending" wins over a "receiving" flash from an already-finished
    // sibling request — with several requests in flight at once, the
    // light should read as busy for as long as *any* of them is still
    // out, not flicker to green because one happened to land first.
    if (this._pending > 0) return 'sending';
    return this._flashTimer ? 'receiving' : 'ready';
  }

  _notify(): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { status: this.status } }));
  }

  /** Marks one request as started — call before it goes out. */
  begin(): void {
    this._pending++;
    // A fresh request always reads as "sending", even mid-flash from a
    // just-finished one — the light shouldn't sit on green while new
    // work is actually going out.
    if (this._flashTimer) {
      clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    this._notify();
  }

  /** Marks one request as settled (success or failure) — call once it resolves/rejects. */
  end(): void {
    this._pending = Math.max(0, this._pending - 1);
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._flashTimer = null;
      this._notify();
    }, this._flashMs);
    this._notify();
  }

  /** Wraps `window.fetch` in place so every call anywhere in the app is tracked. Safe to call more than once — only the first call does anything. */
  attach(): void {
    if (this._attached) return;
    this._attached = true;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      if (suppressDepth > 0) return realFetch(...args);
      this.begin();
      try {
        return await realFetch(...args);
      } finally {
        this.end();
      }
    };
  }
}

export const networkActivity = new NetworkActivity();
