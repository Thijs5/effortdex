// Export ("/transfer/export") — export this device's roster as a
// shareable link. Thin: all the rendering lives in <transfer-panel>
// itself.
//
// Nested under the Transfer hub, and *not* using lib/dom.js's
// wireUtilityBackLink like Import does: this page has exactly one entry
// point (the hub's "Export" button), so its back link always targets
// the hub specifically. Still carries the hub's own "?returnTo="
// through as passthrough baggage.

import { interceptLinkClick } from '../../../lib/dom.ts';
import * as router from '../../../lib/router.ts';
import '../../organisms/transfer-panel.ts';

export const view = document.getElementById('transfer-view')!;
const backFromTransfer = document.getElementById('back-from-transfer') as HTMLAnchorElement;
const transferPanel = view.querySelector('transfer-panel')!;

backFromTransfer.href = router.transferReturnPath();
interceptLinkClick(backFromTransfer, () => router.navigateToTransfer());

export function render(): void {
  backFromTransfer.href = router.transferReturnPath();
  transferPanel.refresh();
}
