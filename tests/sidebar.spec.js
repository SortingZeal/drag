import { clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const modes = ['timeline', 'simple'];
const action = (page, value) => page.locator(`[data-action="${value}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { origin: 'fixed-sidebar', nested: ['保留', { value: 41 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `sidebar-project-${pi}`;
    project.locks = { name: true, color: true };
    project.metadata = { retained: ['project', pi] };
    project.phases.forEach((phase, fi) => {
      phase.id = `sidebar-phase-${pi}-${fi}`;
      phase.locks = { label: true, start: true, icon: true };
      phase.metadata = { retained: ['phase', pi, fi] };
    });
  });
  return model;
}

async function mount(page, model = fixture()) {
  await page.clock.setFixedTime(new Date('2026-10-27T04:00:00Z'));
  await page.addInitScript(value => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft', JSON.stringify(value));
    localStorage.setItem('drag.paneHeight', '65');
    localStorage.setItem('drag.leftPaddingMonths', '3');
    localStorage.setItem('drag.rightPaddingMonths', '3');
  }, model);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(model.projects.reduce((count, project) => count + project.phases.length, 0));
  expect(await draft(page)).toEqual(model);
  return model;
}

async function mode(page, value) {
  await clickAction(page, value);
  if (value === 'timeline') await expect(page.locator('.timeline-date-dock')).toBeVisible();
  else await expect(page.locator('.infographic-preview svg')).toBeVisible();
  await settle(page);
}

async function geometry(page) {
  await settle(page);
  return page.evaluate(() => {
    const rect = node => {
      const b = node.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const sidebar = document.querySelector('aside');
    return {
      main: rect(document.querySelector('main')),
      sidebar: rect(sidebar),
      upper: rect(document.querySelector('.timeline-shell') || document.querySelector('.preview')),
      split: rect(document.querySelector('.split')),
      bottom: rect(document.querySelector('.bottom')),
      editor: rect(document.querySelector('#editor')),
      sidebarDirect: sidebar.parentElement === document.querySelector('main'),
      sidebarScrollWidth: sidebar.scrollWidth,
      sidebarClientWidth: sidebar.clientWidth,
      pageWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      height: innerHeight,
    };
  });
}

function expectFixedLayout(box) {
  expect(box.sidebarDirect).toBe(true);
  expect(box.sidebar.width).toBeCloseTo(224, 0);
  for (const edge of ['left', 'top', 'bottom']) expect(Math.abs(box.sidebar[edge] - box.main[edge]), `sidebar.${edge}`).toBeLessThanOrEqual(1);
  expect(box.upper.left).toBeCloseTo(box.sidebar.right,0);
  expect(box.upper.top).toBeCloseTo(box.main.top,0);
  expect(box.upper.right).toBeCloseTo(box.main.right,0);
  expect(box.upper.bottom).toBeCloseTo(box.main.bottom,0);
  if(box.bottom.width){
    expect(box.bottom.left).toBeCloseTo(box.sidebar.right+4,0);
    expect(box.bottom.right).toBeLessThanOrEqual(box.main.right);
    expect(box.bottom.bottom).toBeLessThanOrEqual(box.main.bottom);
    expect(box.split.left).toBeCloseTo(box.bottom.right-2,0);
  }
  expect(box.sidebarScrollWidth).toBeLessThanOrEqual(box.sidebarClientWidth + 1);
  expect(box.pageScrollWidth).toBeLessThanOrEqual(box.pageWidth + 1);
  expect(box.main.bottom).toBeLessThanOrEqual(box.height + 1);
}

function expectStable(before, after) {
  for (const region of ['main', 'sidebar', 'upper']) {
    for (const property of ['left', 'top', 'width', 'height']) {
      expect(Math.abs(before[region][property] - after[region][property]), `${region}.${property}`).toBeLessThanOrEqual(1);
    }
  }
}

test.beforeEach(async ({ page }, info) => {
  info.sidebarErrors = [];
  page.on('pageerror', error => info.sidebarErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.sidebarErrors).toEqual([]); });

for (const value of modes) test(`${value} keeps a narrow full-height left sidebar across desktop sizes`, async ({ page }, info) => {
  const model = await mount(page);
  await mode(page, value);
  for (const size of [{ width: 1440, height: 1000 }, { width: 1024, height: 700 }, { width: 1280, height: 800 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(size);
    expectFixedLayout(await geometry(page));
    expect(await draft(page)).toEqual(model);
  }
  await expect(action(page, 'undo')).toBeDisabled();
  await page.screenshot({ path: info.outputPath(`${value}-fixed-sidebar.png`), fullPage: true });
});

test('resizing the properties overlay leaves the outline and canvas fixed in both modes',async({page})=>{
 await page.setViewportSize({width:1024,height:700});
 const model=await mount(page);
 await page.locator('[data-select-f="0:0"]').click();
 for(const view of modes){
  await mode(page,view);
  const before=await geometry(page),edge=before.split;
  await page.mouse.move(edge.left+2,edge.top+48);await page.mouse.down();
  await page.mouse.move(edge.left+38,edge.top+48,{steps:8});await page.mouse.up();
  const after=await geometry(page);
  expectFixedLayout(after);expectStable(before,after);
  expect(after.bottom.width).toBeCloseTo(before.bottom.width+36,0);
  expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
 }
});
test('selection, long names and creation preserve sidebar geometry, original data and JSON locks', async ({ page }, info) => {
  const original = await mount(page);
  for (const value of modes) {
    await mode(page, value);
    const before = await geometry(page);
    await page.locator('[data-select-p="0"]').click();
    await expect(page.locator('#editor [data-field="name"]')).toHaveValue(original.projects[0].name);
    expectStable(before, await geometry(page));
    const modelBefore = await draft(page);
    await clickAction(page, 'newproject');
    const created = await draft(page);
    expect(created.projects.slice(0, modelBefore.projects.length)).toEqual(modelBefore.projects);
    expect(created.metadata).toEqual(original.metadata);
    expect(created.locks).toEqual(original.locks);
    expectStable(before, await geometry(page));
    const longName = '固定左側欄完整專案名稱不省略'.repeat(8);
    const field = page.locator('#editor [data-field="name"]');
    await field.fill(longName);
    await field.press('Tab');await field.blur();
    const lastIndex = created.projects.length - 1;
    const label = page.locator(`[data-select-p="${lastIndex}"] b`);
    await expect(label).toHaveText(longName);
    const wrap = await label.evaluate(node => ({
      width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.getBoundingClientRect().height,
      line: Number.parseFloat(getComputedStyle(node).lineHeight),
      overflow: getComputedStyle(node).textOverflow,
    }));
    expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.width + 1);
    expect(wrap.height).toBeGreaterThan(wrap.line * 2);
    expect(wrap.overflow).not.toBe('ellipsis');
    expectFixedLayout(await geometry(page));
    expectStable(before, await geometry(page));
    await clickAction(page, 'newphase');
    const taskCreated = await draft(page);
    expect(taskCreated.projects.slice(0, modelBefore.projects.length)).toEqual(modelBefore.projects);
    expect(taskCreated.projects[lastIndex].name).toBe(longName);
    expect(taskCreated.projects[lastIndex].locks.name).toBe(true);
    expect(taskCreated.projects[lastIndex].phases).toHaveLength(1);
    expectStable(before, await geometry(page));
    const pending = page.waitForEvent('download');
    await clickAction(page, 'save');
    const file = await pending;
    expect(JSON.parse(await readFile(await file.path(), 'utf8'))).toEqual(taskCreated);
    expectStable(before, await geometry(page));
  }
  await page.screenshot({ path: info.outputPath('sidebar-long-names.png'), fullPage: true });
});

test('real cross-project tree dragging retains ids, metadata and locks in the fixed sidebar', async ({ page }) => {
  const original = await mount(page);
  const before = await geometry(page);
  const moved = structuredClone(original.projects[0].phases[0]);
  const source = page.locator('.tree-item.phase[data-p="0"][data-f="0"]');
  const target = page.locator('.project[data-p="1"] > .tree-item[data-select-p="1"]');
  await source.dragTo(target);
  const expected = structuredClone(original);
  expected.projects[0].phases.shift();
  expected.projects[1].phases.push({ ...moved, locks: { ...moved.locks, parent: true } });
  await expect.poll(() => draft(page)).toEqual(expected);
  expectStable(before, await geometry(page));
  const index = expected.projects[1].phases.length - 1;
  await expect(page.locator(`[data-select-f="1:${index}"]`)).toHaveClass(/selected/);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(original);
  expectStable(before, await geometry(page));
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(expected);
  expectStable(before, await geometry(page));
  await page.reload();
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(expected);
  expectFixedLayout(await geometry(page));
});

test('the fixed sidebar scrolls independently with a visible sticky title', async ({ page }, info) => {
  const model = fixture();
  const template = model.projects[6].phases.at(-1);
  for (let index = 0; index < 24; index++) {
    model.projects[6].phases.push({ ...structuredClone(template), id: `sidebar-scroll-${index}`, label: `可捲動任務 ${index + 1}` });
  }
  await mount(page, model);
  const before = await geometry(page);
  const panelPositions = () => page.evaluate(() => Object.fromEntries(['.preview', '#editor'].map(selector => {
    const node = document.querySelector(selector);
    return [selector, { top: node.scrollTop, left: node.scrollLeft }];
  })));
  await page.evaluate(() => {
    document.querySelector('.preview').scrollTop = 100;
    document.querySelector('#editor').scrollTop = 40;
  });
  const rightBefore = await panelPositions();
  const titleBefore = await page.locator('.aside-title').boundingBox();
  await page.mouse.move(before.sidebar.left + 100, before.sidebar.top + before.sidebar.height / 2);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.locator('aside').evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  expect(await panelPositions()).toEqual(rightBefore);
  const titleAfter = await page.locator('.aside-title').boundingBox();
  expect(Math.abs(titleAfter.y - titleBefore.y)).toBeLessThanOrEqual(1);
  expectStable(before, await geometry(page));
  expectFixedLayout(await geometry(page));
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'newproject')).toBeVisible();
  await expect(action(page, 'undo')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('sidebar-independent-scroll.png'), fullPage: true });
});
