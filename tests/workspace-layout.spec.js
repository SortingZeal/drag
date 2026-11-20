import { clickAction, openViewOptions } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFile } from 'node:fs/promises';

const action = (page, name) => page.locator(`[data-action="${name}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const zoom = async page => Number.parseFloat(await page.locator('[data-picture-zoom]').innerText());
async function svgBytes(page) {
  const pending = page.waitForEvent('download');
  await clickAction(page, 'svg');
  return readFile(await (await pending).path());
}

for (const mode of ['simple']) {
  test(`${mode} slider changes preview size while keeping authored data and exports intact`, async ({ page }) => {
    await page.goto('/');
    await expect(action(page, 'newproject')).toBeEnabled();
    const model = await draft(page);
    await clickAction(page, mode);
    const exported = await svgBytes(page);
    const slider = page.getByRole('slider', { name: '圖片縮放拉桿' });
    await expect(slider).toBeVisible();
    const image = page.locator('.picture-canvas > svg');
    const baseline = await image.boundingBox();
    const rect = await slider.boundingBox();
    await page.mouse.click(rect.x + rect.width * .7, rect.y + rect.height / 2);
    await expect.poll(() => zoom(page)).toBeGreaterThan(150);
    expect(await zoom(page)).toBeLessThan(350);
    expect((await image.boundingBox()).width).toBeGreaterThan(baseline.width * 1.5);
    await expect(slider).toHaveAttribute('aria-valuetext', `${await zoom(page)}%`);
    await slider.focus();
    await slider.press('Home');
    await expect.poll(() => zoom(page)).toBe(10);
    await slider.press('End');
    await expect.poll(() => zoom(page)).toBe(800);
    await page.locator('[data-picture-action="reset"]').click();
    expect(await zoom(page)).toBeLessThan(100);
    expect(await draft(page)).toEqual(model);
    expect((await svgBytes(page)).equals(exported)).toBe(true);
    await expect(action(page, 'undo')).toBeDisabled();
  });
}

test('picture controls occupy the upper toolbar and leave the preview to the image', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(action(page, 'newproject')).toBeEnabled();
  const model = await draft(page);
  await clickAction(page, 'simple');
  await openViewOptions(page);
  const controls = page.locator('.report-controls');
  await expect(controls).toBeVisible();
  expect(await controls.evaluate(node => node.closest('.toolbar') !== null)).toBe(true);
  const toolbar = await page.locator('header').boundingBox();
  const preview = await page.locator('.preview').boundingBox();
  const workspace = await page.locator('.picture-workspace').boundingBox();
  expect(toolbar.y + toolbar.height).toBeCloseTo(preview.y, 0);
  expect(workspace.y).toBeCloseTo(preview.y, 0);
  expect(toolbar.height).toBeLessThan(75);
  await page.screenshot({ path: info.outputPath('picture-workspace-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 1024, height: 700 });
  for (const id of ['report-title', 'report-start', 'report-end', 'report-shape']) await expect(page.locator(`#${id}`)).toBeInViewport();
  await page.locator('.align-start summary').click();
  await expect(page.locator('#align-start-apply')).toBeInViewport();
  await page.locator('.align-start summary').click();
  await page.screenshot({ path: info.outputPath('picture-workspace-1024.png'), fullPage: true });
  expect(await draft(page)).toEqual(model);
});

test('three inspector sections fold independently and keep edits undoable', async ({ page }, info) => {
  await page.goto('/');
  await expect(action(page, 'newproject')).toBeEnabled();
  const model = await draft(page);
  await page.locator('[data-select-f="0:0"]').click();
  const groups = page.locator('[data-editor-section]');
  await expect(groups).toHaveCount(3);
  for (const group of await groups.all()) await expect(group).toHaveAttribute('open', '');
  await groups.nth(1).locator('summary').click();
  await expect(page.locator('[data-field="start"]')).toBeHidden();
  await expect(page.locator('[data-field="label"]')).toBeVisible();
  await expect(page.locator('[data-field="icon"]')).toBeVisible();
  await groups.nth(1).locator('summary').click();
  await page.locator('[data-editor-collapse]').click();
  for (const group of await groups.all()) await expect(group).not.toHaveAttribute('open', '');
  await page.screenshot({ path: info.outputPath('inspector-folded.png'), fullPage: true });
  await page.locator('[data-editor-collapse]').click();
  await page.locator('[data-field="label"]').fill('測試任務名稱');
  await page.locator('[data-field="label"]').press('Tab');
  expect((await draft(page)).projects[0].phases[0].label).toBe('測試任務名稱');
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await clickAction(page, 'newproject');
  await expect(groups).toHaveCount(3);
  await expect(page.locator('[data-field="name"]')).toBeVisible();
  await expect(page.locator('[data-field="color"]')).toBeVisible();
});
