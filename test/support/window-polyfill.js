// Minimal window stub so lib/router.js (which reads window.location.hash
// and registers a hashchange listener at import time) can run under
// `node:test` without a DOM. Assigning to location.hash here does NOT
// fire hashchange — tests exercise the parsing/formatting logic and the
// same-hash notify branch, not the browser's event plumbing.
globalThis.window = /** @type {Window & typeof globalThis} */ (/** @type {unknown} */ ({
  location: { hash: '' },
  addEventListener() {},
  removeEventListener() {},
}));
