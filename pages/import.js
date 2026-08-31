// @ts-check
// Import review ("/import/<payload>") — the screen a shared transfer
// link opens to. Thin: all the rendering lives in <import-review> itself.

import { wireUtilityBackLink, requireElementById, requireQuery } from '../lib/dom.js';
import '../components/import-review.js';

export const view = requireElementById('import-view');
const backFromImport = /** @type {HTMLAnchorElement} */ (requireElementById('back-from-import'));
const importReview = /** @type {import('../components/import-review.js').ImportReview} */ (requireQuery('import-review', view));

const setBackLinkPath = wireUtilityBackLink(backFromImport);

/** @param {string|null} payload @param {string|null} contentPath */
export function render(payload, contentPath) {
  setBackLinkPath(contentPath);
  importReview.payload = payload;
}
