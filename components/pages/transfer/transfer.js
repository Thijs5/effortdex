// @ts-check
// Transfer hub ("/transfer") — entry points to Export and Import, the
// same "root page holds a couple of buttons" shape as Settings itself.
// Reachable from Settings' "Transfer to another device" button, and
// itself the parent both Export and Import nest under in the URL.

import { wireUtilityBackLink } from '../../../lib/dom.js';
import * as router from '../../../lib/router.js';

export const view = document.getElementById('transfer-hub-view');
const backFromHub = document.getElementById('back-from-transfer-hub');
const exportBtn = document.getElementById('transfer-export-btn');
const importBtn = document.getElementById('transfer-import-btn');

const setBackLinkPath = wireUtilityBackLink(backFromHub);
exportBtn.addEventListener('click', () => router.navigateToTransferExport());
importBtn.addEventListener('click', () => router.navigateToImport());

/** @param {string|null} contentPath */
export function render(contentPath) {
  setBackLinkPath(contentPath);
}
