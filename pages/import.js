// @ts-check
// Import review ("/import/<payload>") — the screen a shared transfer
// link opens to. Thin: all the rendering lives in <import-review> itself.

import { wireUtilityBackLink } from '../lib/dom.js';
import '../components/import-review.js';

export const view = document.getElementById('import-view');
const backFromImport = document.getElementById('back-from-import');
const importReview = view.querySelector('import-review');

const setBackLinkPath = wireUtilityBackLink(backFromImport);

/** @param {string|null} payload @param {string|null} contentPath */
export function render(payload, contentPath) {
  setBackLinkPath(contentPath);
  importReview.payload = payload;
}
