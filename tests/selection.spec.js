import { globalClick } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
// A full-height compact tree needs an explicitly overflowing fixture.
const selectionFixture=structuredClone(seed);
for(let index=0;index<12;index++)selectionFixture.projects[0].phases.push({...structuredClone(seed.projects[0].phases[0]),id:`selection-overflow-${index}`,label:`捲動保留驗證 ${index+1}`});
const fixtureTaskCount=selectionFixture.projects.reduce((count,project)=>count+project.phases.length,0);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const positions = page => page.evaluate(() => Object.fromEntries(['aside', '#editor', '.preview'].map(selector => {
  const node = selector === '.preview' ? document.querySelector('.picture-viewport') || document.querySelector(selector) : document.querySelector(selector);
  return [selector, { top: node.scrollTop, left: node.scrollLeft }];
})));

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', error => testInfo.pageErrors.push(error.message));
  await page.addInitScript(value => {
    localStorage.setItem('drag.draft', JSON.stringify(value));
    localStorage.setItem('drag.paneHeight', '65');
  }, selectionFixture);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(fixtureTaskCount);
  await page.locator('[data-select-f="0:0"]').click();
});
test.afterEach(async ({}, testInfo) => { expect(testInfo.pageErrors).toEqual([]); });

async function scrollPanels(page) {
  // Picture modes now own an independent scrollable canvas. Enlarge it before
  // checking that ordinary tree selection preserves the actual image viewport.
  const zoom = page.locator('[data-picture-action="zoom-in"]');
  if (await zoom.count()) for (let i = 0; i < 4; i++) await zoom.click();
  await page.evaluate(() => {
    const tree = document.querySelector('aside'), editor = document.querySelector('#editor'), preview = document.querySelector('.picture-viewport') || document.querySelector('.preview');
    tree.scrollTop = tree.scrollHeight;
    editor.scrollTop = 70;
    preview.scrollTop = 70;
    preview.scrollLeft += 150;
    window.selectionNodes = { tree, editor, preview, chart: document.querySelector('#gantt svg, .infographic-preview svg') };
  });
  return positions(page);
}

test('selecting lower tree tasks preserves every panel scroll and the rendered chart without editing the model', async ({ page }, testInfo) => {
  const model = await draft(page);
  const before = await scrollPanels(page);
  expect(before.aside.top).toBeGreaterThan(0);
  expect(before['#editor'].top).toBeGreaterThan(0);
  expect(before['.preview'].top).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('tree-before-selection.png') });
  await page.locator('[data-select-f="6:2"]').click();
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue(seed.projects[6].phases[2].label);
  expect(await positions(page)).toEqual(before);
  expect(await page.evaluate(() => {
    const nodes = window.selectionNodes;
    return nodes.tree.isConnected && nodes.editor.isConnected && nodes.preview.isConnected && nodes.chart.isConnected;
  })).toBe(true);
  await page.locator('[data-select-f="6:1"]').click();
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue(seed.projects[6].phases[1].label);
  expect(await positions(page)).toEqual(before);
  expect(await draft(page)).toEqual(model);
  await page.screenshot({ path: testInfo.outputPath('tree-after-selection.png') });
});

for(const mode of ['simple']) test(`selecting projects in ${mode} preserves the tree and preview instead of rebuilding the SVG`, async ({ page }) => {
  await page.locator(`[data-action="${mode}"]`).click();
  await expect(page.locator('.infographic-preview svg')).toBeVisible();
  const model = await draft(page);
  const before = await scrollPanels(page);
  expect(before.aside.top).toBeGreaterThan(0);
  expect(before['.preview'].top).toBeGreaterThan(0);
  await page.locator('[data-select-p="6"]').click();
  await expect(page.locator('#editor [data-field="name"]')).toHaveValue(seed.projects[6].name);
  const after = await positions(page);
  expect(after.aside).toEqual(before.aside);
  expect(after['.preview']).toEqual(before['.preview']);
  expect(await page.evaluate(() => window.selectionNodes.chart.isConnected)).toBe(true);
  expect(await draft(page)).toEqual(model);
});

test('property editing, undo and redo keep the lower tree position and selection', async ({ page }) => {
  await scrollPanels(page);
  await page.locator('[data-select-f="6:2"]').click();
  const before = await positions(page);
  const model = await draft(page);
  const field = page.locator('#editor [data-field="label"]');
  await field.fill('使用者明確修改的階段');
  await field.press('Tab');await field.blur();
  await expect(page.locator('[data-select-f="6:2"]')).toHaveClass(/selected/);
  expect((await positions(page)).aside).toEqual(before.aside);
  expect((await positions(page))['.preview']).toEqual(before['.preview']);
  const edited = await draft(page);
  expect(edited.projects[6].phases[2].label).toBe('使用者明確修改的階段');
  expect(edited.projects[6].phases[2].locks.label).toBe(true);
  await globalClick(page,'undo');
  expect(await draft(page)).toEqual(model);
  expect((await positions(page)).aside).toEqual(before.aside);
  await globalClick(page,'redo');
  expect(await draft(page)).toEqual(edited);
  expect((await positions(page)).aside).toEqual(before.aside);
});
