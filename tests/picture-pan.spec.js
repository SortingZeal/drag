import {openVisiblePictureTask} from './picture-selection.js';
import { clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const modes = { simple: '圖檔' };
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const control = (page, name) => page.locator(`[data-picture-action="${name}"]`);
const viewport = page => page.locator('.picture-viewport');
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const zoom = async page => Number.parseFloat(await page.locator('[data-picture-zoom]').innerText());

async function mount(page, { width = 1280, height = 1000, pane = 65 } = {}) {
  const model = structuredClone(seed);
  model.metadata = { origin: 'picture-pan-test', keep: ['視角不屬於資料', { value: 510 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `pan-project-${pi}`;
    project.metadata = { keep: ['project', pi] };
    project.locks = { ...project.locks, name: true, color: true };
    project.phases.forEach((phase, fi) => {
      phase.id = `pan-phase-${pi}-${fi}`;
      phase.metadata = { keep: ['phase', pi, fi] };
      phase.locks = { ...phase.locks, label: true, start: true };
    });
  });
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ model, pane }) => {
    if (localStorage.getItem('picture-pan.seeded')) return;
    localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.paneHeight', String(pane));
    localStorage.setItem('drag.leftPaddingMonths', '3');
    localStorage.setItem('drag.rightPaddingMonths', '3');
    localStorage.setItem('picture-pan.seeded', 'true');
  }, { model, pane });
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(model);
  return model;
}

async function show(page, mode) {
  await clickAction(page, mode);
  await expect(viewport(page)).toBeVisible();
  await settle(page);
}

async function setZoom(page, target) {
  for (let attempts = 0; attempts < 20 && await zoom(page) !== target; attempts++) {
    await control(page, await zoom(page) < target ? 'zoom-in' : 'zoom-out').click();
  }
  expect(await zoom(page)).toBe(target);
  await settle(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.picture-viewport');
    const box = node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { ...box(viewport), width: viewport.clientWidth, height: viewport.clientHeight },
      image: box(document.querySelector('.picture-canvas > svg')),
      tools: box(document.querySelector('.picture-tools')),
      preview: box(document.querySelector('.preview')),
      scroll: { left: viewport.scrollLeft, top: viewport.scrollTop, maxLeft: viewport.scrollWidth - viewport.clientWidth, maxTop: viewport.scrollHeight - viewport.clientHeight },
    };
  });
}

async function titleCenter(page) {
  const title = page.locator('.picture-canvas [data-role="title"]');
  const box = await title.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, { x, y }, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(viewport(page)).toHaveClass(/is-panning/);
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
  await expect(viewport(page)).not.toHaveClass(/is-panning/);
  await settle(page);
}

function expectMoved(before, after, dx, dy) {
  expect(Math.abs(after.image.x - before.image.x - dx)).toBeLessThanOrEqual(1.1);
  expect(Math.abs(after.image.y - before.image.y - dy)).toBeLessThanOrEqual(1.1);
  expect(after.image.width).toBeCloseTo(before.image.width, 1);
  expect(after.image.height).toBeCloseTo(before.image.height, 1);
  for (const key of ['x', 'y', 'width', 'height']) expect(after.tools[key]).toBeCloseTo(before.tools[key], 1);
}

function visibleCenter(state) {
  return {
    x: (state.viewport.x + state.viewport.width / 2 - state.image.x) / state.image.width,
    y: (state.viewport.y + state.viewport.height / 2 - state.image.y) / state.image.height,
  };
}

function expectSameView(before, after) {
  const oldCenter = visibleCenter(before);
  const newCenter = visibleCenter(after);
  expect(Math.abs(newCenter.x - oldCenter.x) * Math.min(before.image.width, after.image.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(newCenter.y - oldCenter.y) * Math.min(before.image.height, after.image.height)).toBeLessThanOrEqual(1);
}

async function expectCentered(page) {
  const state = await geometry(page);
  expect(Math.abs(visibleCenter(state).x - 0.5) * state.image.width).toBeLessThanOrEqual(0.6);
  expect(Math.abs(visibleCenter(state).y - 0.5) * state.image.height).toBeLessThanOrEqual(0.6);
}

async function expectUnedited(page, model, { canRedo = false } = {}) {
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  if (canRedo) await expect(action(page, 'redo')).toBeEnabled();
  else await expect(action(page, 'redo')).toBeDisabled();
  await expect(page.locator('.hint, .save-state, .action-status, button[title]:not([aria-label]), input[title], select[title]')).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
}

async function download(page, name) {
  const pending = page.waitForEvent('download');
  await clickAction(page, name);
  const file = await pending;
  return { file, bytes: await readFile(await file.path()) };
}

test.beforeEach(async ({ page }, info) => {
  info.panErrors = [];
  page.on('pageerror', error => info.panErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.panErrors).toEqual([]); });

for (const [mode, label] of Object.entries(modes)) {
  test(`${label} can grab the native-size image and blank canvas in all directions even at 25 percent`, async ({ page }, info) => {
    const model = await mount(page);
    await show(page, mode);
    const zoomOptions = page.locator('.picture-zoom-menu');
    await zoomOptions.evaluate(menu => {
      window.presetChanges = 0;
      const observer = new MutationObserver(records => { window.presetChanges += records.length; });
      observer.observe(menu, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
    });
    let before = await geometry(page);
    expect(before.scroll.maxLeft).toBeGreaterThan(100);
    expect(before.scroll.maxTop).toBeGreaterThan(100);
    await drag(page, await titleCenter(page), 110, 75);
    let after = await geometry(page);
    expectMoved(before, after, 110, 75);
    before = after;
    await page.keyboard.down('Shift');
    await drag(page, { x: before.viewport.x + 150, y: before.viewport.y + 115 }, -90, -60);
    await page.keyboard.up('Shift');
    after = await geometry(page);
    expectMoved(before, after, -90, -60);
    expect(await page.evaluate(() => window.presetChanges), 'panning preserves the zoom controls').toBe(0);
    await setZoom(page, 25);
    expect(await page.evaluate(() => window.presetChanges)).toBeGreaterThan(0);
    await control(page, 'center').click();
    await settle(page);
    for (const [dx, dy] of [[140, 90], [-190, -110], [70, -40], [-20, 60]]) {
      before = await geometry(page);
      expect(before.scroll.maxLeft).toBeGreaterThan(100);
      expect(before.scroll.maxTop).toBeGreaterThan(100);
      await drag(page, { x: before.viewport.x + before.viewport.width / 2, y: before.viewport.y + 120 }, dx, dy);
      after = await geometry(page);
      expectMoved(before, after, dx, dy);
    }
    before = await geometry(page);
    await drag(page, { x: before.viewport.x + 18, y: before.viewport.y + 18 }, 700, 120);
    after = await geometry(page);
    expectMoved(before, after, 700, 120);
    expect(visibleCenter(after).x).toBeLessThan(0);
    await page.screenshot({ path: info.outputPath(`${mode}-free-pan-25.png`), fullPage: true });
    await control(page, 'center').click();
    await settle(page);
    expect(await zoom(page)).toBe(25);
    await expectCentered(page);
    await control(page, 'reset').click();
    await settle(page);
    const fitted = await geometry(page);
    expect(fitted.image.width).toBeLessThanOrEqual(fitted.viewport.width + 2);
    expect(fitted.image.height).toBeLessThanOrEqual(fitted.viewport.height + 2);
    await expectCentered(page);
    await control(page, 'actual').click();
    expect(await zoom(page)).toBe(100);
    await expectUnedited(page, model);
  });

  test(`${label} captures on the viewport and stops on release, Escape, cancel, blur and lost capture`, async ({ page }) => {
    const model = await mount(page);
    await show(page, mode);
    await setZoom(page, 25);
    await viewport(page).evaluate(node => {
      node.addEventListener('pointerdown', event => { window.panTestPointerId = event.pointerId; });
    });
    for (const end of ['release', 'Escape', 'pointercancel', 'blur', 'lostcapture']) {
      await control(page, 'center').click();
      await settle(page);
      const before = await geometry(page);
      const origin = await titleCenter(page);
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await expect(viewport(page)).toHaveClass(/is-panning/);
      expect(await viewport(page).evaluate(node => node.hasPointerCapture(window.panTestPointerId))).toBe(true);
      const outsidePoint = { x: origin.x - 60, y: Math.max(4, before.viewport.y - 12) };
      expect(await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('header')),outsidePoint)).toBe(true);
      await page.mouse.move(outsidePoint.x,outsidePoint.y,{steps:6});
      await settle(page);
      const outside = await geometry(page);
      expectMoved(before, outside, outsidePoint.x-origin.x, outsidePoint.y-origin.y);
      if (end === 'release') await page.mouse.up();
      else if (end === 'Escape') await page.keyboard.press('Escape');
      else if (end === 'pointercancel') await viewport(page).evaluate(node => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.panTestPointerId })));
      else if (end === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      else {
        await viewport(page).evaluate(node => node.releasePointerCapture(window.panTestPointerId));
        // Chrome processes pending capture changes before the next pointer event.
        // A real move must deliver lostpointercapture without moving the picture.
        await page.mouse.move(outsidePoint.x+2,outsidePoint.y+2);
      }
      await expect(viewport(page)).not.toHaveClass(/is-panning/);
      const stopped = await geometry(page);
      expectMoved(outside, stopped, 0, 0);
      await page.mouse.move(origin.x + 30, origin.y - 20, { steps: 4 });
      await settle(page);
      expectMoved(stopped, await geometry(page), 0, 0);
      await page.mouse.up();
      await viewport(page).evaluate(node => node.addEventListener('pointermove',event => {window.panReturnButtons=event.buttons;},{once:true}));
      await page.mouse.move(origin.x + 33, origin.y - 18);
      await settle(page);
      expect(await page.evaluate(() => window.panReturnButtons)).toBe(0);
      expectMoved(stopped, await geometry(page), 0, 0);
      expect(await viewport(page).evaluate(node => node.hasPointerCapture(window.panTestPointerId))).toBe(false);
      await expectUnedited(page, model);
    }
  });

  test(`${label} freely panned preview exports complete 4K SVG and PNG without changing JSON`, async ({ page }, info) => {
    const model = await mount(page);
    await show(page, mode);
    await setZoom(page, 25);
    const state = await geometry(page);
    await drag(page, { x: state.viewport.x + 18, y: state.viewport.y + 18 }, 700, 180);
    const panned = await geometry(page);
    expect(visibleCenter(panned).x).toBeLessThan(0);
    const svg = await download(page, 'svg');
    const parsed = await page.evaluate(xml => {
      const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
      return { errors: document.querySelectorAll('parsererror').length, width: document.documentElement.getAttribute('width'), height: document.documentElement.getAttribute('height'), projects: document.querySelectorAll('g[data-project-id]').length, phases: document.querySelectorAll('g[data-phase-id]').length };
    }, svg.bytes.toString());
    expect(parsed).toEqual({ errors: 0, width: '3840', height: '2160', projects: 7, phases: 15 });
    expect(svg.bytes.toString()).not.toContain('picture-viewport');
    await svg.file.saveAs(info.outputPath(`${mode}-freely-panned.svg`));
    const png = await download(page, 'png');
    expect(png.bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.bytes.readUInt32BE(16)).toBe(3840);
    expect(png.bytes.readUInt32BE(20)).toBe(2160);
    await png.file.saveAs(info.outputPath(`${mode}-freely-panned.png`));
    await control(page, 'reset').click();
    const centeredSvg = await download(page, 'svg');
    const centeredPng = await download(page, 'png');
    expect(centeredSvg.bytes).toEqual(svg.bytes);
    expect(centeredPng.bytes).toEqual(png.bytes);
    const json = await download(page, 'save');
    expect(JSON.parse(json.bytes)).toEqual(model);
    await expectUnedited(page, model);
  });
}

test('free picture positions survive mode switches, edits, undo and window/split resizing', async ({ page }) => {
  const model = await mount(page);
  await show(page, 'simple');
  await expectCentered(page);
  await setZoom(page, 125);
  const before = await geometry(page);
  await page.keyboard.down('Shift');
  await drag(page, { x: before.viewport.x + 220, y: before.viewport.y + 125 }, -180, -95);
  await page.keyboard.up('Shift');
  const simpleView = await geometry(page);
  await clickAction(page, 'timeline');
  await show(page, 'simple');
  expect(await zoom(page)).toBe(125);
  expectSameView(simpleView, await geometry(page));
  await expectUnedited(page, model);
  const selected = await openVisiblePictureTask(page);
  const field = page.locator('#editor [data-field="label"]');
  await field.fill('手動名稱仍保留自由視角');
  await field.press('Tab');await field.blur();
  const edited = structuredClone(model);
  edited.projects[selected.project].phases[selected.phase].label = '手動名稱仍保留自由視角';
  expect(await draft(page)).toEqual(edited);
  expectSameView(simpleView, await geometry(page));
  await page.setViewportSize({ width: 1024, height: 850 });
  await settle(page);
  expectSameView(simpleView, await geometry(page));
  await openVisiblePictureTask(page);
  const split = await page.locator('.split').boundingBox();
  const drawer = await page.locator('.bottom').boundingBox();
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await page.mouse.down();
  await page.mouse.move(split.x + split.width / 2 + (split.x < drawer.x ? -48 : 48), split.y + split.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  expect((await page.locator('.bottom').boundingBox()).width).toBeCloseTo(drawer.width + 48, 0);
  expectSameView(simpleView, await geometry(page));
  expect(await zoom(page)).toBe(125);
  await clickAction(page, 'undo');
  await settle(page);
  expect(await draft(page)).toEqual(model);
  expectSameView(simpleView, await geometry(page));
  await expectUnedited(page, model, { canRedo: true });
});

test('large-image native scroll and free grab compose without moving the floating tools', async ({ page }) => {
  const model = await mount(page);
  await show(page, 'simple');
  await setZoom(page, 400);
  await viewport(page).evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) * 0.8; node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.8; });
  await settle(page);
  let before = await geometry(page);
  expect(before.scroll.maxLeft).toBeGreaterThan(100);
  expect(before.scroll.maxTop).toBeGreaterThan(100);
  await drag(page, { x: before.viewport.x + before.viewport.width / 2, y: before.viewport.y + before.viewport.height / 2 }, -180, -90);
  expectMoved(before, await geometry(page), -180, -90);
  before = await geometry(page);
  await drag(page, { x: before.viewport.x + 18, y: before.viewport.y + 18 }, 620, 300);
  expectMoved(before, await geometry(page), 620, 300);
  await control(page, 'center').click();
  await settle(page);
  expect(await zoom(page)).toBe(400);
  await expectCentered(page);
  await expectUnedited(page, model);
});

test('minimum window and 25 percent pane keep free panning and all floating controls usable', async ({ page }, info) => {
  const model = await mount(page, { width: 1024, height: 700, pane: 25 });
  for (const mode of Object.keys(modes)) {
    await show(page, mode);
    let before = await geometry(page);
    await drag(page, { x: before.viewport.x + 18, y: before.viewport.y + 8 }, 130, 20);
    expectMoved(before, await geometry(page), 130, 20);
    for (const name of ['zoom-in', 'zoom-out', 'center', 'reset', 'actual']) {
      await control(page, name).click();
      await settle(page);
      const state = await geometry(page);
      expect(state.tools.x).toBeGreaterThanOrEqual(state.preview.x);
      expect(state.tools.y).toBeGreaterThanOrEqual(state.preview.y);
      expect(state.tools.x + state.tools.width).toBeLessThanOrEqual(state.preview.x + state.preview.width + 1);
      expect(state.tools.y + state.tools.height).toBeLessThanOrEqual(state.preview.y + state.preview.height + 1);
      expect(await control(page, name).evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
    }
    await expectCentered(page);
    expect(await zoom(page)).toBe(100);
    expect(await page.evaluate(() => localStorage.getItem('drag.paneHeight'))).toBe('25');
    await expectUnedited(page, model);
    await page.screenshot({ path: info.outputPath(`${mode}-minimum-pane-free-pan.png`), fullPage: true });
  }
});
