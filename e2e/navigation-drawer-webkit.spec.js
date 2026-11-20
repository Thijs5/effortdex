import { test, expect, devices } from '@playwright/test';
import { createParty } from './support/party.js';
import { mockPokeApi } from './support/pokeapi-mock.js';
test.use({ ...devices['iPhone 13'], browserName:'webkit' });
test.skip(!process.env.EFFORTDEX_WEBKIT, 'Opt in where WebKit dependencies are available.');
test('iPhone drawer supports touch navigation without shifting content', async ({ page }, info) => {
  await mockPokeApi(page);
  await page.goto('/');
  await createParty(page, { name:'FireRed adventure', baseGame:'FireRed' });
  for (const width of [390,320]) {
    await page.setViewportSize({ width,height:844 });
    const before = await page.locator('.party-identity-row').boundingBox();
    await page.getByRole('button', { name:'Menu', exact:true }).tap();
    const drawer = page.getByRole('dialog', { name:'Navigation', exact:true });
    await expect(drawer).toBeVisible();
    const panel = await drawer.boundingBox();
    if (!panel) throw new Error('Drawer must be visible');
    expect(panel.x + panel.width).toBe(width);
    expect(await page.locator('.party-identity-row').boundingBox()).toEqual(before);
    await page.screenshot({ path:info.outputPath(`drawer-${width}.png`) });
    await drawer.getByRole('button', { name:/Training guide/ }).tap();
    await expect(drawer).not.toBeVisible();
    const input = page.locator('#guide-search').getByRole('combobox', { name:'Search a species…' });
    await expect(input).toBeVisible();
    await expect(input).not.toBeFocused();
    await page.locator('#guide-search').getByRole('button', { name:'Close search' }).tap();
  }
});
