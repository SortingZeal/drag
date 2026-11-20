import { test, expect } from '@playwright/test';
import { clickAction } from './global-actions.js';

test('view dock moves, fades, stays inside the resized canvas and keeps project JSON intact', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('drag.onboarding', JSON.stringify({version:1,status:'completed'})));
  await page.goto('/');
  await clickAction(page,'simple');
  const grip = page.locator('.picture-tool-grip');
  const dock = page.locator('.picture-tools');
  const data = () => page.evaluate(() => localStorage.getItem('drag.draft'));
  await expect(grip).toBeVisible();
  const original = await data();
  const start = await grip.boundingBox();
  const before = await dock.boundingBox();
  await page.mouse.move(start.x + 8, start.y + 12);
  await page.mouse.down();
  await page.mouse.move(start.x - 110, start.y - 35,{steps:6});
  await expect(dock).toHaveCSS('opacity','1');
  await page.mouse.up();
  const after = await dock.boundingBox();
  expect(after.x).toBeLessThan(before.x - 85);
  expect(after.y).toBeLessThan(before.y - 20);
  await page.mouse.move(0,0);
  await expect.poll(async () => Number(await dock.evaluate(node => getComputedStyle(node).opacity))).toBeLessThan(.6);
  await grip.focus();
  await grip.press('ArrowRight');
  expect((await dock.boundingBox()).x).toBeGreaterThan(after.x);
  await page.setViewportSize({width:390,height:844});
  await expect.poll(() => page.evaluate(() => {
    const tools = document.querySelector('.picture-tools').getBoundingClientRect();
    const host = document.querySelector('.picture-workspace').getBoundingClientRect();
    return tools.left >= host.left && tools.top >= host.top && tools.right <= host.right+1 && tools.bottom <= host.bottom+1;
  })).toBe(true);
  expect(await data()).toBe(original);
});
