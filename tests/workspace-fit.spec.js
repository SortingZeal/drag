import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { selectTimelineScale, globalClick } from './global-actions.js';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
async function ready(page) {
  // Eight-year fixtures can finish first render after the normal UI wait on Windows.
  await expect(page.locator('[data-action="global-menu"]')).toBeVisible({ timeout: 20_000 });
}
async function mount(page, model) {
  await page.addInitScript(data => localStorage.setItem('drag.draft', JSON.stringify(data)), model);
  await page.goto('/');
  await ready(page);
}

test('studio application menu works with hover, keyboard and click', async ({ page }, info) => {
  const model = structuredClone(seed);
  await mount(page, model);
  const trigger = page.locator('[data-action="global-menu"]');
  const menu = page.locator('#global-action-menu');
  // Studio adds a workspace breadcrumb above the canvas controls.
  expect((await page.locator('header').boundingBox()).height).toBeLessThanOrEqual(72);
  await expect(menu).toBeHidden();
  await trigger.hover();
  await expect(menu).toBeVisible();
  await page.mouse.move(220, 250);
  await page.mouse.click(220, 250);
  await expect(menu).toBeHidden();
  await trigger.focus();
  await expect(menu).toBeVisible();
  await trigger.press('ArrowDown');
  await expect(page.locator('[data-action="save"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await globalClick(page, 'settings');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await draft(page)).toEqual(model);
  await page.screenshot({ path: info.outputPath('compact-workspace.png'), fullPage: true });
});

test('fit content follows task deletion, reduces the canvas and leaves records untouched', async ({ page }) => {
  test.setTimeout(60_000);
  const model = structuredClone(seed);
  model.projects = model.projects.slice(0, 2);
  model.projects[0].phases = model.projects[0].phases.slice(0, 2);
  model.projects[1].phases = model.projects[1].phases.slice(0, 2);
  for (const phase of model.projects[0].phases) { phase.start = '2026-10-01'; phase.end = '2026-10-30'; phase.locks = { start: true, end: true }; }
  for (const phase of model.projects[1].phases) { phase.start = '2034-10-01'; phase.end = '2034-10-30'; phase.locks = { start: true, end: true }; }
  await mount(page, model);
  await globalClick(page, 'fit-content');
  await expect(page.locator('[data-action="fit-content"]')).toHaveAttribute('aria-pressed', 'true');
  const before = await page.locator('#gantt').evaluate(node => node.getBoundingClientRect().width);
  await page.locator('[data-select-p="1"]').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete"]').click();
  await expect(page.locator('.bar-wrapper')).toHaveCount(2);
  const after = await page.locator('#gantt').evaluate(node => node.getBoundingClientRect().width);
  expect(after).toBeLessThan(before);
  const visible = await page.evaluate(() => {
    const bar = document.querySelector('.bar-wrapper .bar').getBoundingClientRect();
    const viewport = document.querySelector('.preview').getBoundingClientRect();
    return bar.right > viewport.left && bar.left < viewport.right;
  });
  expect(visible).toBe(true);
  expect(await draft(page)).toEqual({ ...model, projects: [model.projects[0]] });
  await globalClick(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await page.setViewportSize({ width: 1080, height: 760 });
  await expect(page.locator('[data-action="fit-content"]')).toHaveAttribute('aria-pressed', 'true');
  await selectTimelineScale(page, 'Month');
  await expect(page.locator('[data-action="fit-content"]')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await ready(page);
  await expect(page.locator('[data-action="fit-content"]')).toHaveAttribute('aria-pressed', 'false');
  expect(await draft(page)).toEqual(model);
});

test('deleting a distant task restores the remaining canvas even when fit mode is off', async ({ page }) => {
  test.setTimeout(60_000);
  const model = structuredClone(seed);
  model.projects = model.projects.slice(0, 2);
  model.projects[0].phases = model.projects[0].phases.slice(0, 1);
  model.projects[1].phases = model.projects[1].phases.slice(0, 1);
  Object.assign(model.projects[0].phases[0], { start: '2026-10-01', end: '2026-10-30' });
  Object.assign(model.projects[1].phases[0], { start: '2034-10-01', end: '2034-10-30' });
  await mount(page, model);
  await expect(page.locator('[data-action="fit-content"]')).toHaveAttribute('aria-pressed', 'false');
  const before = await page.locator('#gantt').evaluate(node => node.getBoundingClientRect().width);
  await page.locator('.preview').evaluate(preview => {
    const far = document.querySelectorAll('.bar-wrapper .bar')[1];
    preview.scrollLeft = far.getBoundingClientRect().left - preview.getBoundingClientRect().left + preview.scrollLeft - 200;
  });
  await page.locator('[data-select-f="1:0"]').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete"]').click();
  await expect(page.locator('.bar-wrapper')).toHaveCount(1);
  const after = await page.locator('#gantt').evaluate(node => node.getBoundingClientRect().width);
  expect(after).toBeLessThan(before);
  const visible = await page.evaluate(() => {
    const bar = document.querySelector('.bar-wrapper .bar').getBoundingClientRect();
    const viewport = document.querySelector('.preview').getBoundingClientRect();
    return bar.right > viewport.left && bar.left < viewport.right;
  });
  expect(visible).toBe(true);
  expect((await draft(page)).projects[0].phases[0]).toEqual(model.projects[0].phases[0]);
});

test('a saved timeline fit preserves picture zoom, fit-to-window and the exported SVG', async ({ page }) => {
  const model = structuredClone(seed);
  model.locks = { title: true };
  await page.addInitScript(() => {
    if (localStorage.getItem('drag.workspace') !== null) return;
    localStorage.setItem('drag.preferences', JSON.stringify({
      version: 1, values: { startupMode: 'last', rememberPictures: true }
    }));
    localStorage.setItem('drag.workspace', JSON.stringify({
      mode: 'simple', fitContent: true, pictures: { simple: { zoom: 0.5, center: { x: 0.5, y: 0.5 } } }
    }));
  });
  await mount(page, model);
  const viewport = page.locator('.picture-viewport');
  const timelineFit = page.locator('[data-action="fit-content"]');
  await expect(viewport).toHaveAttribute('data-zoom', '0.5');
  await expect(timelineFit).toBeDisabled();

  async function exportSvg() {
    const download = page.waitForEvent('download');
    await globalClick(page, 'svg');
    return readFileSync(await (await download).path());
  }
  const original = await exportSvg();
  await page.locator('[data-picture-action="reset"]').click();
  await expect(viewport).not.toHaveAttribute('data-zoom', '0.5');
  await page.locator('[data-picture-action="zoom-in"]').click();
  const zoom = await viewport.getAttribute('data-zoom');
  await page.setViewportSize({ width: 1080, height: 760 });
  await expect(viewport).toHaveAttribute('data-zoom', zoom);
  expect((await exportSvg()).equals(original)).toBe(true);

  await page.locator('[data-action="timeline"]').click();
  await expect(timelineFit).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="simple"]').click();
  await page.reload();
  await expect(viewport).toHaveAttribute('data-zoom', zoom);
  await expect(timelineFit).toBeDisabled();
  expect(await draft(page)).toEqual(model);
});
