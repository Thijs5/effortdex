// @ts-check
// Export ("/transfer/export") — export this device's roster as a
// shareable link. Thin: all the rendering lives in <transfer-panel>
// itself.
//
// Nested under the Transfer hub, and *not* using lib/dom.js's
// wireUtilityBackLink like Import does: that helper returns to whatever
// party/roster content was last open, which is right for pages reachable
// from arbitrary places — this page has exactly one entry point (the
// Transfer hub's "Export" button), so its back link always targets the
// hub specifically, a fixed destination, not "wherever you came from"
// (same reasoning as components/pages/settings/cache.js's own back
// link). Still carries the hub's own "?returnTo=" through as passthrough
// baggage (router.navigateToTransferExport() embeds it,
// router.transferReturnPath()/navigateToTransfer() read it back out) —
// otherwise a hub -> Export -> back round trip would silently drop
// where the user was before they ever opened the hub.

import { interceptLinkClick } from '../../../lib/dom.js';
import * as router from '../../../lib/router.js';
import '../../organisms/transfer-panel.js';

export const view = document.getElementById('transfer-view');
const backFromTransfer = /** @type {HTMLAnchorElement} */ (document.getElementById('back-from-transfer'));
const transferPanel = view.querySelector('transfer-panel');

backFromTransfer.href = router.transferReturnPath();
interceptLinkClick(backFromTransfer, () => router.navigateToTransfer());

export function render() {
  backFromTransfer.href = router.transferReturnPath();
  transferPanel.refresh();
}
