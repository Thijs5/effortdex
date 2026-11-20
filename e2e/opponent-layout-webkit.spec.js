import { test, devices } from '@playwright/test';
import { assertStableOpponentCards } from './support/opponent-layout.js';

test.use({ ...devices['iPhone 13'], browserName: 'webkit' });
test.skip(!process.env.EFFORTDEX_WEBKIT, 'Opt in with EFFORTDEX_WEBKIT=1 in an environment with WebKit dependencies.');

test('recent opponent cards keep their exact geometry in iPhone 13 WebKit', async ({ page }) => {
  await assertStableOpponentCards(page);
});

import { assertNoLingeringOpponentTouch } from './support/opponent-pointer.js';
test('opponent touch feedback clears in iPhone WebKit while keyboard focus stays visible', async ({ page }) => {
  await assertNoLingeringOpponentTouch(page);
});
