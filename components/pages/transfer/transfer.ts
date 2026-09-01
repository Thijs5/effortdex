// Transfer hub ("/transfer") — entry points to Export and Import, the
// same "root page holds a couple of buttons" shape as Settings itself.

import { wireUtilityBackLink } from '../../../lib/dom.ts';
import * as router from '../../../lib/router.ts';

export const view = document.getElementById('transfer-hub-view')!;
const backFromHub = document.getElementById('back-from-transfer-hub') as HTMLAnchorElement;
const exportBtn = document.getElementById('transfer-export-btn')!;
const importBtn = document.getElementById('transfer-import-btn')!;

const syncBackLink = wireUtilityBackLink(backFromHub);
exportBtn.addEventListener('click', () => router.navigateToTransferExport());
importBtn.addEventListener('click', () => router.navigateToImport());

export function render(): void {
  syncBackLink();
}
