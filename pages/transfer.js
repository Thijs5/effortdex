// @ts-check
// Transfer ("/transfer") — export this device's roster as a shareable
// link. Thin: all the rendering lives in <transfer-panel> itself.

import { wireUtilityBackLink } from '../lib/dom.js';
import '../components/transfer-panel.js';

export const view = document.getElementById('transfer-view');
const backFromTransfer = document.getElementById('back-from-transfer');
const transferPanel = view.querySelector('transfer-panel');

const setBackLinkPath = wireUtilityBackLink(backFromTransfer);

/** @param {string|null} contentPath */
export function render(contentPath) {
  setBackLinkPath(contentPath);
  transferPanel.refresh();
}
