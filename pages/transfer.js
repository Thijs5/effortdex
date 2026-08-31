// @ts-check
// Transfer ("/transfer") — export this device's roster as a shareable
// link. Thin: all the rendering lives in <transfer-panel> itself.

import { wireUtilityBackLink, requireElementById, requireQuery } from '../lib/dom.js';
import '../components/transfer-panel.js';

export const view = requireElementById('transfer-view');
const backFromTransfer = /** @type {HTMLAnchorElement} */ (requireElementById('back-from-transfer'));
const transferPanel = /** @type {import('../components/transfer-panel.js').TransferPanel} */ (requireQuery('transfer-panel', view));

const setBackLinkPath = wireUtilityBackLink(backFromTransfer);

/** @param {string|null} contentPath */
export function render(contentPath) {
  setBackLinkPath(contentPath);
  transferPanel.refresh();
}
