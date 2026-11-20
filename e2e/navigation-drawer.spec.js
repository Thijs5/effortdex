// @ts-check
import { test, expect } from '@playwright/test';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { createParty } from './support/party.js';

for (const [width, height, theme] of [[390,844,'light'], [390,844,'dark'], [320,640,'light'], [1280,800,'dark']]) {
  test(`drawer navigation ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: Number(width), height: Number(height) });
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
    await mockPokeApi(page);
    await page.goto('/');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    const trigger = await menu.boundingBox();
    if (!trigger) throw new Error('Menu must be visible');
    await menu.click();
    const panel = await drawer.boundingBox();
    if (!panel) throw new Error('Drawer must be visible');
    expect(trigger.x).toBeGreaterThan(Number(width) / 2);
    expect(panel.x + panel.width).toBe(Number(width));
    await expect(drawer.getByRole('button', { name: /Training guide/ })).toBeDisabled();
    await expect(drawer.locator('#drawer-context')).toContainText('Choose or create');
    await expect(drawer.getByRole('link', { name: 'Parties', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path:info.outputPath('drawer-parties.png'), animations:'disabled' });
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await createParty(page, { name: 'My FireRed adventure', baseGame: 'FireRed' });
    await expect(page.locator('.party-identity-row')).toBeVisible();
    const contentBefore = await page.locator('.party-identity-row').boundingBox();
    await menu.click();
    expect(await page.locator('.party-identity-row').boundingBox()).toEqual(contentBefore);
    await expect(drawer.locator('#drawer-party')).toHaveAttribute('aria-current', 'page');
    await expect(drawer.locator('#drawer-context')).toContainText('FireRed');
    const textEdges = await drawer.locator('h2, .drawer-copy, #drawer-context, #theme-group-label').evaluateAll(els => els.filter(el => el.getBoundingClientRect().width > 0).map(el => el.getBoundingClientRect().left));
    expect(Math.max(...textEdges) - Math.min(...textEdges)).toBeLessThanOrEqual(1);
    await expect(drawer.locator('[aria-current="page"] .drawer-current')).toBeVisible();
    await expect(drawer.locator('#drawer-party-name')).toHaveText('My FireRed adventure');
    await drawer.locator('h2').hover();
    await page.screenshot({ path: info.outputPath('drawer-resting.png'), animations:'disabled' });
    await drawer.getByRole('button', { name: 'Settings', exact: true }).hover();
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const box of await drawer.locator('nav .ds-btn:visible').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath('drawer.png'), animations: 'disabled' });
    await drawer.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.locator('#settings-view')).toBeVisible();
    await page.reload();
    await menu.click();
    await expect(drawer.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
    await drawer.locator('h2').hover();
    await page.screenshot({ path:info.outputPath('drawer-settings.png'), animations:'disabled' });
    await drawer.getByRole('button', { name: /Training guide/ }).click();
    const search = page.locator('#guide-search');
    await expect(search.getByRole('combobox', { name: 'Search a species…' })).toBeVisible();
    await expect(search.getByRole('combobox', { name: 'Search a species…' })).not.toBeFocused();
    await expect(page.locator('#roster .roster-card')).toHaveCount(0);
    await search.getByRole('button', { name: 'Close search' }).click();
    await menu.click();
    await drawer.getByRole('button', { name: 'Transfer', exact: true }).click();
    await expect(page).toHaveURL(/#\/transfer/);
    await menu.click();
    await drawer.getByRole('link', { name: 'Parties', exact: true }).click();
    await expect(page).toHaveURL(/#\/parties$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/transfer/);
    await menu.click();
    await page.mouse.click(5, Number(height)/2);
    await expect(drawer).not.toBeVisible();
    await expect(menu).toBeFocused();
  });
}

test('drawer keyboard stays contained and sticky Menu remains available after scrolling', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
  for (let i=0; i<15; i++) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate(el => document.activeElement === document.body || el.contains(document.activeElement))).toBe(true);
  }
  await drawer.getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(menu).toBeInViewport({ ratio:1 });
  await menu.click();
  await drawer.getByRole('radio', { name:'Dark', exact:true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(drawer.getByRole('radio', { name:'Light', exact:true })).toBeFocused();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
});

test('large text and a short phone keep drawer controls reachable', async ({ page }, info) => {
  await page.setViewportSize({ width:320,height:480 });
  await page.goto('/');
  await page.evaluate(() => document.documentElement.style.fontSize = '150%');
  await page.getByRole('button', { name:'Menu', exact:true }).click();
  const drawer = page.getByRole('dialog', { name:'Navigation', exact:true });
  await expect(drawer.getByRole('button', { name:'Close navigation' })).toBeInViewport({ ratio:1 });
  const theme = drawer.getByRole('radio', { name:'Light', exact:true });
  await theme.scrollIntoViewIfNeeded();
  expect(await drawer.locator('.dialog-body').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const bounds = await drawer.boundingBox();
  if (!bounds) throw new Error('Navigation drawer must have visible bounds');
  for (const row of await drawer.locator('[role="radio"]').evaluateAll(els => els.map(el => ({ x:el.getBoundingClientRect().x, right:el.getBoundingClientRect().right })))) {
    expect(row.x).toBeGreaterThanOrEqual(bounds.x);
    expect(row.right).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  await page.screenshot({ path:info.outputPath('drawer-large-text.png') });
  await theme.click();
  await expect(drawer).not.toBeVisible();
});


test('a party named Settings remains distinct from the Settings destination', async ({ page }) => {
  await page.goto('/');
  await createParty(page, { name:'Settings', baseGame:'FireRed' });
  await page.getByRole('button', { name:'Menu', exact:true }).click();
  const drawer = page.getByRole('dialog', { name:'Navigation' });
  await expect(drawer.getByRole('link', { name:'Current party Settings', exact:true })).toBeVisible();
  await expect(drawer.getByRole('button', { name:'Settings', exact:true })).toBeVisible();
});
