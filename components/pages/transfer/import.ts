// Import review ("/transfer/import/<payload>") — the screen a shared
// transfer link opens to. Thin: all the rendering lives in
// <import-review> itself.
//
// Still uses lib/dom.js's wireUtilityBackLink (unlike its sibling
// export.js) — a shared link opens this page directly, with no prior
// visit to the Transfer hub, so its back link needs the same "wherever
// you came from" flexibility as Settings.

import { wireUtilityBackLink } from '../../../lib/dom.ts';
import '../../organisms/import-review.ts';

export const view = document.getElementById('import-view')!;
const backFromImport = document.getElementById('back-from-import') as HTMLAnchorElement;
const importReview = view.querySelector('import-review')!;

const syncBackLink = wireUtilityBackLink(backFromImport);

export function render(payload: string | null): void {
  syncBackLink();
  importReview.payload = payload;
}
