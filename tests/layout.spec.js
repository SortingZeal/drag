import { clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, value) => page.locator(`[data-action="${value}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const regions = ['#app', 'header', 'main', '.preview', 'aside'];

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { source: 'layout-regression', nested: ['保留', { value: 19 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `layout-project-${pi}`;
    project.locks = { name: true, color: true };
    project.metadata = { retained: ['project', pi] };
    project.phases.forEach((phase, fi) => {
      phase.id = `layout-phase-${pi}-${fi}`;
      phase.locks = { label: true, start: true };
      phase.metadata = { retained: ['phase', pi, fi] };
    });
  });
  return model;
}

async function mount(page, width, pane, model = fixture()) {
  await page.setViewportSize({ width, height: 952 });
  await page.clock.setFixedTime(new Date('2026-10-22T04:00:00Z'));
  await page.addInitScript(({ model, pane }) => {
    localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.paneHeight', String(pane));
    localStorage.setItem('drag.leftPaddingMonths', '3');
    localStorage.setItem('drag.rightPaddingMonths', '3');
  }, { model, pane });
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(model);
  await settle(page);
  return model;
}

async function rectangles(page) {
  await settle(page);
  return page.evaluate(selectors => Object.fromEntries(selectors.map(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return [selector, { x: box.x, y: box.y, width: box.width, height: box.height }];
  })), regions);
}

async function expectSameLayout(page, before) {
  const after = await rectangles(page);
  for (const selector of regions) for (const property of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(after[selector][property] - before[selector][property]), `${selector}.${property} remains stable`).toBeLessThanOrEqual(1);
  }
  const frame = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: window.innerHeight,
    bottom: document.querySelector('.bottom').getBoundingClientRect().bottom,
  }));
  expect(frame.scrollWidth).toBeLessThanOrEqual(frame.width + 1);
  expect(frame.bottom).toBeLessThanOrEqual(frame.height + 1);
  const drawer=await page.locator('.bottom').boundingBox();
  if(drawer){
    const tree=await page.locator('.project-sidebar').boundingBox();
    expect(drawer.x).toBeCloseTo(tree.x+tree.width+4,0);
    expect(drawer.width).toBeGreaterThanOrEqual(250);
    expect(drawer.y).toBeGreaterThanOrEqual(tree.y);
  }
}

async function expectNoHelperCopy(page) {
  await expect(page.locator('.hint, .save-state, .action-status')).toHaveCount(0);
  await expect(page.locator('button[title]:not([aria-label]), input[title], select[title]')).toHaveCount(0);
  expect(await page.locator('#app').innerText()).not.toMatch(/拖曳移動|拉動兩端調整日期|尚未匯出 JSON|已匯出 JSON|已送出下載|已載入|日期精準微調|貼上圖示或從下方選擇/);
}

function expectOriginalData(current, original) {
  expect(current.projects.slice(0, original.projects.length)).toEqual(original.projects);
  const { projects: _currentProjects, ...currentRest } = current;
  const { projects: _originalProjects, ...originalRest } = original;
  expect(currentRest).toEqual(originalRest);
}

async function saveJson(page) {
  const pending = page.waitForEvent('download');
  await clickAction(page, 'save');
  const file = await pending;
  expect(file.suggestedFilename()).toBe((await page.locator('#document-select option:checked').innerText()) + '.json');
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}

test.beforeEach(async ({ page }, info) => {
  info.layoutPageErrors = [];
  page.on('pageerror', error => info.layoutPageErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.layoutPageErrors).toEqual([]); });

for (const width of [1024, 1166, 1280, 1440]) for (const pane of [55, 78]) {
  test(`adding projects and tasks keeps panel bounds at ${width}px with ${pane}% preview`, async ({ page }, info) => {
    const original = await mount(page, width, pane);
    const initial = await rectangles(page);
    await expectNoHelperCopy(page);
    if (width === 1166 && pane === 78) await page.screenshot({ path: info.outputPath('layout-before-add.png'), fullPage: true });

    for (let count = 1; count <= 2; count++) {
      await clickAction(page, 'newproject');
      await expect(page.locator('#editor [data-field="name"]')).toHaveValue('新專案');
      const current = await draft(page);
      expect(current.projects).toHaveLength(original.projects.length + count);
      expectOriginalData(current, original);
      expect(current.projects.at(-1).phases).toEqual([]);
      expect(current.projects.at(-1).id).toEqual(expect.any(String));
      await expectSameLayout(page, initial);
      await expectNoHelperCopy(page);
    }

    if (width === 1166 && pane === 78) {
      const name = '新增專案名稱與完整內容保留—'.repeat(12);
      await page.locator('#editor [data-field="name"]').fill(name);
      await page.locator('#editor [data-field="name"]').press('Tab');await page.locator('#editor [data-field="name"]').blur();
      expect((await draft(page)).projects.at(-1).name).toBe(name);
      expect((await draft(page)).projects.at(-1).locks.name).toBe(true);
      await expectSameLayout(page, initial);
    }

    const projectsAdded = await draft(page);
    await clickAction(page, 'newphase');
    const taskAdded = await draft(page);
    expectOriginalData(taskAdded, original);
    expect(taskAdded.projects.at(-1).phases).toHaveLength(1);
    const task = taskAdded.projects.at(-1).phases[0];
    expect(task.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(task.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(task.start <= task.end).toBe(true);
    await expectSameLayout(page, initial);
    await clickAction(page, 'undo');
    expect(await draft(page)).toEqual(projectsAdded);
    await expectSameLayout(page, initial);
    await clickAction(page, 'redo');
    expect(await draft(page)).toEqual(taskAdded);
    await expectSameLayout(page, initial);
    await expectNoHelperCopy(page);

    if (width === 1166 && pane === 78) {
      expect(await saveJson(page)).toEqual(taskAdded);
      await expectSameLayout(page, initial);
      await expectNoHelperCopy(page);
      await page.screenshot({ path: info.outputPath('layout-after-add.png'), fullPage: true });
    }
  });
}

test('both modes keep their layout and stay free of helper text during creation, history and JSON download', async ({ page }, info) => {
  const original = await mount(page, 1166, 78);
  for (const mode of ['timeline', 'simple']) {
    await clickAction(page, mode);
    if (mode !== 'timeline') await expect(page.locator('.infographic-preview svg')).toBeVisible();
    const before = await rectangles(page);
    const modelBefore = await draft(page);
    await expectNoHelperCopy(page);
    await clickAction(page, 'newproject');
    const projectCreated = await draft(page);
    expect(projectCreated.projects).toHaveLength(modelBefore.projects.length + 1);
    expectOriginalData(projectCreated, original);
    await expectSameLayout(page, before);
    await clickAction(page, 'newphase');
    const taskCreated = await draft(page);
    expect(taskCreated.projects.at(-1).phases).toHaveLength(1);
    expectOriginalData(taskCreated, original);
    await expectSameLayout(page, before);
    await clickAction(page, 'undo');
    expect(await draft(page)).toEqual(projectCreated);
    await expectSameLayout(page, before);
    await clickAction(page, 'redo');
    expect(await draft(page)).toEqual(taskCreated);
    await expectSameLayout(page, before);
    expect(await saveJson(page)).toEqual(taskCreated);
    expect(await draft(page)).toEqual(taskCreated);
    await expectSameLayout(page, before);
    await expectNoHelperCopy(page);
    await page.screenshot({ path: info.outputPath(`${mode}-no-helper-layout.png`), fullPage: true });
  }
});
