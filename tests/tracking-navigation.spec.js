import { test, expect } from './audit-fixture.js';

test('the tracking page has a direct link and browser history returns to the previous editor view', async ({page}) => {
  const tab = mode => page.locator(`header [data-action="${mode}"]`);
  await page.goto('/?lang=en');
  await tab('simple').click();
  const data = await page.evaluate(() => localStorage.getItem('drag.draft'));
  await tab('tracking').click();
  await expect(page).toHaveURL(/\?lang=en#tracking$/);
  await expect(page.locator('#tracking-page')).toBeVisible();
  await expect(page.locator('.project-sidebar')).toBeHidden();
  await page.goBack();
  await expect(tab('simple')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.picture-canvas svg')).toBeVisible();
  await page.goForward();
  await expect(tab('tracking')).toHaveAttribute('aria-selected','true');
  await page.reload();
  await expect(page.locator('#tracking-page')).toBeVisible();
  await tab('timeline').click();
  await expect(page).toHaveURL(/\?lang=en$/);
  await expect(page.locator('#gantt svg.gantt')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('drag.draft'))).toBe(data);
});

test('opening the tracking address directly displays the tracking page in a new browser session', async ({page}) => {
  await page.goto('/#tracking');
  await expect(page.locator('#tracking-page')).toBeVisible();
  await expect(page.locator('[data-action=tracking]')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#tree')).toBeHidden();
});
