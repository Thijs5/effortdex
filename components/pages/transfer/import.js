// @ts-check
// Import review ("/transfer/import/<payload>") — the screen a shared
// transfer link opens to. Thin: all the rendering lives in
// <import-review> itself.
//
// Still uses lib/dom.js's wireUtilityBackLink (unlike its sibling
// export.js) — a shared link opens this page directly, with no prior
// visit to the Transfer hub or anywhere else in the app, so its back
// link needs the same "wherever you came from" flexibility as Settings,
// not export.js's fixed-to-parent destination.

import { wireUtilityBackLink } from '../../../lib/dom.js';
import '../../organisms/import-review.js';

export const view = document.getElementById('import-view');
const backFromImport = document.getElementById('back-from-import');
const importReview = view.querySelector('import-review');

const setBackLinkPath = wireUtilityBackLink(backFromImport);

/** @param {string|null} payload @param {string|null} contentPath */
export function render(payload, contentPath) {
  setBackLinkPath(contentPath);
  importReview.payload = payload;
}
