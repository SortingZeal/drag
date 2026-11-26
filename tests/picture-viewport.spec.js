import {openVisiblePictureTask} from './picture-selection.js';
import { clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const modeNames = { simple: '圖檔' };
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const control = (page, name) => page.locator(`[data-picture-action="${name}"]`);
const chart = page => page.locator('.picture-canvas > svg');
const viewport = page => page.locator('.picture-viewport');
const tools = page => page.locator('.picture-tools');
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const zoom = async page => Number.parseFloat(await page.locator('output[data-picture-zoom]').innerText());
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { origin: 'picture-viewport-test', keep: ['保留', { value: 59 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `picture-project-${pi}`;
    project.locks = { ...project.locks, color: true, name: true };
    project.metadata = { retained: ['project', pi] };
    project.phases.forEach((phase, fi) => {
      phase.id = `picture-phase-${pi}-${fi}`;
      phase.locks = { ...phase.locks, label: true, start: true };
      phase.metadata = { retained: ['phase', pi, fi] };
    });
  });
  return model;
}

async function mount(page, { width = 1280, pane = 65 } = {}) {
  const model = fixture();
  await page.setViewportSize({ width, height: 1000 });
  await page.addInitScript(({ model, pane }) => {
    if (localStorage.getItem('picture-viewport.seeded')) return;
    localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.paneHeight', String(pane));
    localStorage.setItem('drag.leftPaddingMonths', '3');
    localStorage.setItem('drag.rightPaddingMonths', '3');
    localStorage.setItem('picture-viewport.seeded', 'true');
  }, { model, pane });
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(model);
  return model;
}

async function show(page, mode) {
  await clickAction(page, mode);
  await expect(chart(page)).toBeVisible();
  await expect(viewport(page)).toBeVisible();
  await expect(tools(page)).toBeVisible();
  await settle(page);
}

async function setZoom(page, target) {
  for (let attempts = 0; attempts < 30 && await zoom(page) !== target; attempts++) {
    await control(page, await zoom(page) < target ? 'zoom-in' : 'zoom-out').click();
  }
  await expect.poll(() => zoom(page)).toBe(target);
  await settle(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.picture-viewport');
    const bounds = viewport.getBoundingClientRect();
    const image = document.querySelector('.picture-canvas > svg').getBoundingClientRect();
    const box = node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { x: bounds.x + viewport.clientLeft, y: bounds.y + viewport.clientTop, width: viewport.clientWidth, height: viewport.clientHeight },
      image: { x: image.x, y: image.y, width: image.width, height: image.height },
      scroll: { left: viewport.scrollLeft, top: viewport.scrollTop, maxLeft: viewport.scrollWidth - viewport.clientWidth, maxTop: viewport.scrollHeight - viewport.clientHeight },
      tools: box(document.querySelector('.picture-tools')),
      preview: box(document.querySelector('.preview')),
      split: box(document.querySelector('.split')),
    };
  });
}

async function expectCentered(page) {
  await settle(page);
  await expect.poll(async () => {
    const { image, viewport } = await geometry(page);
    return Math.max(Math.abs(image.x + image.width / 2 - viewport.x - viewport.width / 2), Math.abs(image.y + image.height / 2 - viewport.y - viewport.height / 2));
  }).toBeLessThanOrEqual(2);
}

async function expectControlsContained(page) {
  const state = await geometry(page);
  expect(state.tools.x).toBeGreaterThanOrEqual(state.preview.x);
  expect(state.tools.y).toBeGreaterThanOrEqual(state.preview.y);
  expect(state.tools.x + state.tools.width).toBeLessThanOrEqual(state.preview.x + state.preview.width + 1);
  expect(state.tools.y + state.tools.height).toBeLessThanOrEqual(state.preview.y + state.preview.height + 1);
  expect(state.viewport.height).toBeGreaterThan(0);
  expect(state.viewport.y + state.viewport.height).toBeLessThanOrEqual(state.preview.y + state.preview.height + 1);
  expect(await tools(page).evaluate(node => {
    const button = node.querySelector('button');
    const rect = button.getBoundingClientRect();
    return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.picture-tools');
  })).toBe(true);
}

async function expectNoHelpOrModelChanges(page, model) {
  await expect(page.locator('.hint, .save-state, .action-status, button[title]:not([aria-label]), input[title], select[title]')).toHaveCount(0);
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await expect(action(page, 'redo')).toBeDisabled();
}

async function panelBounds(page) {
  await settle(page);
  return page.evaluate(() => Object.fromEntries(['header', '.toolbar', 'main', '.preview', '.picture-workspace', '.picture-tools'].map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
    return [selector, { x, y, width, height }];
  })));
}

async function saveFile(page, name) {
  const pending = page.waitForEvent('download');
  await clickAction(page, name);
  const file = await pending;
  return { file, body: await readFile(await file.path()) };
}

test.beforeEach(async ({ page }, info) => {
  info.pictureViewportErrors = [];
  page.on('pageerror', error => info.pictureViewportErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.pictureViewportErrors).toEqual([]); });

test('mode names are 圖檔 and only picture modes expose accessible floating controls', async ({ page }) => {
  const model = await mount(page);
  await expect(action(page, 'timeline')).toHaveText('時間軸');
  await expect(page.getByRole('button', {name:'簡報',exact:true})).toHaveCount(0);
  await expect(action(page, 'simple')).toHaveText('圖檔');
  await expect(page.getByRole('button', { name: /^(簡報圖片|簡報圖檔|簡易格式)$/ })).toHaveCount(0);
  await expect(tools(page)).toHaveCount(0);
  for (const mode of Object.keys(modeNames)) {
    await show(page, mode);
    await expect(tools(page)).toHaveAttribute('role', 'group');
    await expect(tools(page)).toHaveAttribute('aria-label', '檢視操作');
    for (const name of ['放大', '縮小', '原尺寸', '適合視窗', '置中']) await expect(tools(page).getByRole('button', { name, exact: true })).toBeVisible();
    expect(await zoom(page)).toBeLessThan(100);
    const picker = tools(page).getByRole('button', { name: '選擇縮放比例' });
    await picker.click();
    const menu = tools(page).getByRole('menu', { name: '縮放比例' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(24);
    await menu.getByRole('menuitemradio', { name: '33%' }).click();
    expect(await zoom(page)).toBe(33);
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await picker.click();
    await menu.getByRole('menuitemradio', { name: '100%' }).click();
    expect(await zoom(page)).toBe(100);
    await expectControlsContained(page);
    await expectNoHelpOrModelChanges(page, model);
  }
  await clickAction(page, 'timeline');
  await expect(tools(page)).toHaveCount(0);
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  await expectNoHelpOrModelChanges(page, model);
});

for (const [mode, label] of Object.entries(modeNames)) {
  test(`${label} zoom changes actual image size, respects bounds, and reset fits and centers without edits`, async ({ page }, info) => {
    const model = await mount(page);
    await show(page, mode);
    await control(page, 'actual').click();
    const baseline = await geometry(page);
    const design = await chart(page).evaluate(node => ({ width: node.viewBox.baseVal.width, height: node.viewBox.baseVal.height }));
    expect(baseline.image.width).toBeCloseTo(design.width, 1);
    expect(baseline.image.height).toBeCloseTo(design.height, 1);
    await control(page, 'zoom-in').click();
    await expect.poll(() => zoom(page)).toBe(110);
    await settle(page);
    const larger = await geometry(page);
    expect(larger.image.width / baseline.image.width).toBeCloseTo(1.1, 2);
    expect(larger.image.height / baseline.image.height).toBeCloseTo(1.1, 2);
    await setZoom(page, 800);
    await expect(control(page, 'zoom-in')).toBeDisabled();
    await expect(control(page, 'zoom-out')).toBeEnabled();
    const enlarged = await geometry(page);
    expect(enlarged.image.width / baseline.image.width).toBeCloseTo(8, 2);
    await setZoom(page, 10);
    await expect(control(page, 'zoom-out')).toBeDisabled();
    await expect(control(page, 'zoom-in')).toBeEnabled();
    await control(page, 'reset').click();
    await expectCentered(page);
    const fitted = await geometry(page);
    expect(fitted.image.width).toBeLessThanOrEqual(fitted.viewport.width + 2);
    expect(fitted.image.height).toBeLessThanOrEqual(fitted.viewport.height + 2);
    expect(await zoom(page)).toBeCloseTo(fitted.image.width / design.width * 100, 0);
    await control(page, 'actual').click();
    expect(await zoom(page)).toBe(100);
    await expectCentered(page);
    const reset = await geometry(page);
    expect(Math.abs(reset.image.width - baseline.image.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(reset.image.height - baseline.image.height)).toBeLessThanOrEqual(2);
    await expectNoHelpOrModelChanges(page, model);
    await page.screenshot({ path: info.outputPath(`${mode}-reset.png`), fullPage: true });
  });

  test(`${label} controls remain floating during image scrolling and center preserves zoom`, async ({ page }, info) => {
    const model = await mount(page);
    await show(page, mode);
    await setZoom(page, 400);
    const before = await geometry(page);
    expect(before.scroll.maxLeft).toBeGreaterThan(100);
    expect(before.scroll.maxTop).toBeGreaterThan(100);
    await viewport(page).evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) * 0.81; node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.74; });
    await settle(page);
    const scrolled = await geometry(page);
    expect(scrolled.scroll.left).toBeGreaterThan(before.scroll.maxLeft * 0.7);
    for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(scrolled.tools[key] - before.tools[key])).toBeLessThanOrEqual(1);
    await expectControlsContained(page);
    await control(page, 'center').click();
    expect(await zoom(page)).toBe(400);
    await expectCentered(page);
    await expectNoHelpOrModelChanges(page, model);
    await page.screenshot({ path: info.outputPath(`${mode}-floating-centered.png`), fullPage: true });
  });

  test(`${label} zoomed preview still exports full 4K SVG and PNG and the exact editable JSON`, async ({ page }, info) => {
    const model = await mount(page);
    await show(page, mode);
    await setZoom(page, 400);
    await viewport(page).evaluate(node => { node.scrollLeft = 0; node.scrollTop = 0; });
    const vector = await saveFile(page, 'svg');
    expect(vector.file.suggestedFilename()).toBe(`drag-simple.svg`);
    await vector.file.saveAs(info.outputPath(`${mode}-zoomed.svg`));
    const parsed = await page.evaluate(xml => {
      const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
      return { errors: document.querySelectorAll('parsererror').length, width: document.documentElement.getAttribute('width'), height: document.documentElement.getAttribute('height'), projects: document.querySelectorAll('g[data-project-id]').length, phases: document.querySelectorAll('g[data-phase-id]').length };
    }, vector.body.toString());
    expect(parsed).toEqual({ errors: 0, width: '3840', height: '2160', projects: 7, phases: 15 });
    await setZoom(page, 25);
    const bitmap = await saveFile(page, 'png');
    expect(bitmap.file.suggestedFilename()).toBe(`drag-simple.png`);
    await bitmap.file.saveAs(info.outputPath(`${mode}-zoomed.png`));
    expect(bitmap.body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bitmap.body.readUInt32BE(16)).toBe(3840);
    expect(bitmap.body.readUInt32BE(20)).toBe(2160);
    const colored = await page.evaluate(async body => {
      const image = new Image(); image.src = `data:image/png;base64,${body}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 960, 540);
      const bytes = context.getImageData(0, 0, 960, 540).data;
      let count = 0;
      for (let index = 0; index < bytes.length; index += 4) if (bytes[index + 3] > 250 && Math.max(bytes[index], bytes[index + 1], bytes[index + 2]) - Math.min(bytes[index], bytes[index + 1], bytes[index + 2]) > 45) count++;
      return count;
    }, bitmap.body.toString('base64'));
    expect(colored).toBeGreaterThan(1000);
    const json = await saveFile(page, 'save');
    expect(JSON.parse(json.body)).toEqual(model);
    await expectNoHelpOrModelChanges(page, model);
  });
}

test('picture position and zoom survive timeline switches, manual edits and undo', async ({ page }) => {
  const model = await mount(page);
  await show(page, 'simple');
  await setZoom(page, 300);
  await viewport(page).evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) * 0.6; node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.7; });
  await settle(page);
  const simpleScroll = (await geometry(page)).scroll;
  await clickAction(page, 'timeline');
  await show(page, 'simple');
  expect(await zoom(page)).toBe(300);
  const restored = (await geometry(page)).scroll;
  expect(Math.abs(restored.left - simpleScroll.left)).toBeLessThanOrEqual(2);
  expect(Math.abs(restored.top - simpleScroll.top)).toBeLessThanOrEqual(2);
  await expectNoHelpOrModelChanges(page, model);

  const firstTask=page.locator('.picture-canvas [data-phase-index="0"]').first();
  await firstTask.scrollIntoViewIfNeeded();
  await firstTask.press('Enter');
  const field = page.locator('#editor [data-field="label"]');
  await field.fill('手動任務：縮放與資料分開保存');
  await field.press('Tab');await field.blur();
  const edited = structuredClone(model);
  edited.projects[0].phases[0].label = '手動任務：縮放與資料分開保存';
  expect(await draft(page)).toEqual(edited);
  expect(await zoom(page)).toBe(300);
  const beforeCreation = await panelBounds(page);
  await clickAction(page,'global-menu');
  await page.locator('#global-action-menu [data-action=newproject]').click();
  const added = await draft(page);
  expect(added.projects).toHaveLength(8);
  expect(added.projects.slice(0, 7)).toEqual(edited.projects);
  expect(await zoom(page)).toBe(300);
  const afterCreation = await panelBounds(page);
  for (const selector of Object.keys(beforeCreation)) for (const key of ['x', 'y', 'width', 'height']) {
    if (key === 'y' && ['.split', '.bottom', '#editor'].includes(selector)) continue;
    expect(Math.abs(afterCreation[selector][key] - beforeCreation[selector][key]), `${selector}.${key} stays unchanged after project creation`).toBeLessThanOrEqual(1);
  }
  await expectControlsContained(page);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(edited);
  await control(page, 'zoom-in').click();
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  expect(await zoom(page)).toBe(350);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('picture controls stay within the preview after window and split resizing without changing the model', async ({ page }, info) => {
  const model = await mount(page, { width: 1440, pane: 78 });
  for (const mode of Object.keys(modeNames)) {
    await show(page, mode);
    await setZoom(page, 175);
    await page.setViewportSize({ width: 1024, height: 900 });
    await settle(page);
    expect(await zoom(page)).toBe(175);
    await expectControlsContained(page);
    await openVisiblePictureTask(page);
    const split = await page.locator('.split').boundingBox();
    const drawer = await page.locator('.bottom').boundingBox();
    await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
    await page.mouse.down();
    await page.mouse.move(split.x + split.width / 2 + (split.x < drawer.x ? -48 : 48), split.y + split.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    expect((await page.locator('.bottom').boundingBox()).width).toBeCloseTo(drawer.width + 48, 0);
    expect(await zoom(page)).toBe(175);
    await expectControlsContained(page);
    await control(page, 'center').click();
    await expectCentered(page);
    await expectNoHelpOrModelChanges(page, model);
    await page.screenshot({ path: info.outputPath(`${mode}-resized-controls.png`), fullPage: true });
  }
});

test('minimum desktop window and 25 percent pane keep picture controls usable without resetting the pane', async ({ page }, info) => {
  const model = await mount(page, { width: 1024, pane: 25 });
  await page.setViewportSize({ width: 1024, height: 700 });
  for (const mode of Object.keys(modeNames)) {
    await show(page, mode);
    await expectControlsContained(page);
    const before = await geometry(page);
    expect(before.image.height).toBeGreaterThanOrEqual(25);
    for (const name of ['zoom-in', 'zoom-out', 'center', 'reset', 'actual']) {
      await control(page, name).click();
      await expectControlsContained(page);
    }
    const picker = tools(page).getByRole('button', { name: '選擇縮放比例' });
    await picker.click();
    const menu = tools(page).getByRole('menu', { name: '縮放比例' });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1025);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(701);
    expect(menuBox.height).toBeGreaterThan(160);
    await page.screenshot({ path: info.outputPath(`${mode}-zoom-menu.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(picker).toHaveAttribute('aria-expanded', 'false');
    await expectCentered(page);
    expect(await zoom(page)).toBe(100);
    expect(await page.evaluate(() => localStorage.getItem('drag.paneHeight'))).toBe('25');
    await expectNoHelpOrModelChanges(page, model);
    await page.screenshot({ path: info.outputPath(`${mode}-minimum-pane.png`), fullPage: true });
  }
});
