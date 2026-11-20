import { test, expect } from './audit-fixture.js';
import { openViewOptions } from './global-actions.js';

test('global language dropdown remembers the explicit choice and keeps the project intact', async ({ page }) => {
  await page.goto('/');
  const language = page.locator('header').getByRole('combobox', {name:/Language/});
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  await expect(language).toBeVisible();
  const initial = await draft();
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(language).toBeFocused();
  expect(await draft()).toEqual(initial);
  await page.reload();
  await expect(language).toHaveValue('en');
  await language.selectOption('zh-TW');
  await expect(page.locator('html')).toHaveAttribute('lang','zh-Hant');
  expect(await draft()).toEqual(initial);
});

test('one header row exposes the timeline and image controls at 320px and on desktop', async ({ page }, info) => {
  await page.goto('/');
  for (const width of [320, 1440]) {
    await page.setViewportSize({width,height:820});
    const timeline=page.locator('header [data-action=timeline]');
    await timeline.click();
    const bounds=await page.locator('header').boundingBox();
    for (const selector of ['.workspace-heading','.tabs','.view-settings > summary','.toolbar-language','.global-actions']) {
      const box=await page.locator('header '+selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(width+1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y+box.height).toBeLessThanOrEqual(bounds.y+bounds.height+1);
    }
    const options=await openViewOptions(page);
    await expect(page.locator('[data-action="toggle-inspector"]')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'符合內容'})).toBeInViewport();
    await expect(page.locator('#view')).toBeInViewport();
    await expect(page.locator('#snap')).toBeInViewport();
    await options.locator(':scope > summary').press('Escape');
    await expect(options).not.toHaveAttribute('open','');
    await page.locator('header [data-action=simple]').click();
    await openViewOptions(page);
    await expect(page.locator('[data-action="toggle-inspector"]')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'符合內容'})).toHaveCount(0);
    await expect(page.locator('header #report-start')).toBeInViewport();
    await page.locator('header [data-action=global-menu]').hover();
    await expect(page.locator('#global-action-menu')).toBeHidden();
    await page.locator('.align-start > summary').click();
    await expect(page.locator('#align-start-apply')).toBeInViewport();
    await page.locator('#align-start-apply').press('Escape');
    await expect(page.locator('#align-start-apply')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(options.locator(':scope > summary')).toBeFocused();
    await page.screenshot({path:info.outputPath('header-'+width+'.png')});
  }
});
