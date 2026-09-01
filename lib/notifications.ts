// Opt-in desktop/mobile notification (the real Notification API, not an
// in-page toast) for when a manual sprite-cache run
// (components/pages/settings/cache.js's per-row "Cache" or per-generation
// "Cache all" buttons, docs/adr/0012) finishes — caching a whole
// generation is 100+ species at concurrency 2, easily a couple of
// minutes, so someone who switches tabs or apps to wait it out has no
// other way to know it's done. The automatic idle-time background scan
// (docs/adr/0011) deliberately never notifies — it's meant to be
// invisible, nobody asked to watch it (ADR 0012's own Consequences), and
// notifying on every background page load would just be noise.
//
// Off by default (`isCacheDoneNotifyEnabled`) — flipping it on
// (components/pages/settings/cache.js's checkbox) is what actually
// prompts for permission, never done unprompted on page load.

const ENABLED_KEY = 'effortdex:notify-on-cache-done';

export function isNotificationSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function isCacheDoneNotifyEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export function setCacheDoneNotifyEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (enabled) localStorage.setItem(ENABLED_KEY, '1');
  else localStorage.removeItem(ENABLED_KEY);
}

/**
 * Prompts for permission if it hasn't been decided yet, and reports
 * whether a notification could actually be shown right now. Never
 * throws — `requestPermission` can be dismissed, blocked by browser/OS
 * policy, or simply unsupported (e.g. Safari on iOS outside a installed
 * PWA), none of which should break the caller's own flow.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Shows a notification if — and only if — the user opted in
 * (`setCacheDoneNotifyEnabled`) and permission is currently granted;
 * a silent no-op otherwise, e.g. permission was revoked from outside
 * the app since the checkbox was last ticked, so a stale "enabled" flag
 * alone is never enough to actually fire one.
 */
export function notifyCacheDone(title: string, options?: NotificationOptions): void {
  if (!isCacheDoneNotifyEnabled()) return;
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, options);
  } catch {
    // best-effort — some contexts throw on the plain constructor (e.g.
    // browsers that require going through a service worker registration
    // instead); nothing worth recovering into here
  }
}
