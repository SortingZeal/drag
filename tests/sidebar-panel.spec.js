import { globalClick, clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const panel = page => page.locator('aside.project-sidebar');
const edge = page => page.locator('main > .sidebar-resizer');
const corner = page => page.locator('aside > .sidebar-corner-resizer');
const panelAction = (page, name) => page.locator(`[data-sidebar-action="${name}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const preferences = page => page.evaluate(() => localStorage.getItem('drag.sidebar'));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { origin: 'movable-sidebar', retained: ['保留', { approved: 12 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `panel-project-${pi}`;
    project.locks = { color: true, name: true };
    project.metadata = { retained: [pi, { manual: true }] };
    project.phases.forEach((phase, fi) => {
      phase.id = `panel-phase-${pi}-${fi}`;
      phase.locks = { start: true, end: true, icon: true };
      phase.metadata = { retained: [pi, fi, { manual: true }] };
    });
  });
  return model;
}

async function mount(page, saved) {
  const model = fixture();
  await page.addInitScript(({ model, saved }) => {
    if (localStorage.getItem('panel-tests.seeded')) return;
    localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.paneHeight', '65');
    localStorage.setItem('drag.leftPaddingMonths', '3');
    localStorage.setItem('drag.rightPaddingMonths', '3');
    if (saved !== undefined) localStorage.setItem('drag.sidebar', typeof saved === 'string' ? saved : JSON.stringify(saved));
    localStorage.setItem('panel-tests.seeded', 'true');
  }, { model, saved });
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(model);
  await settle(page);
  return model;
}

async function geometry(page) {
  await settle(page);
  return page.evaluate(() => {
    const box = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
    const main = document.querySelector('main');
    return { main: box(main), panel: box(main.querySelector('aside')), header: box(main.querySelector('.aside-title')),
      upper: box(main.querySelector(':scope > .timeline-shell, :scope > .preview')), mode: main.dataset.sidebarMode,
      pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth };
  });
}

function expectSameBox(before, after) {
  for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(after[key] - before[key]), key).toBeLessThanOrEqual(1);
}

function expectContained(box) {
  expect(box.panel.x).toBeGreaterThanOrEqual(box.main.x + 7);
  expect(box.panel.y).toBeGreaterThanOrEqual(box.main.y + 7);
  expect(box.panel.right).toBeLessThanOrEqual(box.main.right - 7);
  expect(box.panel.bottom).toBeLessThanOrEqual(box.main.bottom - 7);
  expect(box.pageScrollWidth).toBeLessThanOrEqual(box.pageWidth + 1);
}

async function expectUnedited(page, model, { canRedo = false } = {}) {
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  if (canRedo) await expect(action(page, 'redo')).toBeEnabled();
  else await expect(action(page, 'redo')).toBeDisabled();
  await expect(page.locator('.hint,.save-state,.action-status,button[title]:not([aria-label]),input[title],select[title]')).toHaveCount(0);
}

async function drag(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await settle(page);
}

async function resizeDock(page, dx) {
  const box = await edge(page).boundingBox();
  expect(box).not.toBeNull();
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, 0);
}

async function moveHeader(page, dx, dy) {
  const box = await page.locator('.aside-title').boundingBox();
  await drag(page, { x: box.x + 38, y: box.y + 18 }, dx, dy);
}

async function undock(page) {
  await moveHeader(page, 140, 84);
  await expect(page.locator('main')).toHaveAttribute('data-sidebar-mode', 'floating');
  await expect(panel(page)).toHaveClass(/is-floating/);
  const box = await geometry(page);
  expectContained(box);
  return box;
}

async function resizeFloat(page, dx, dy) {
  const box = await corner(page).boundingBox();
  expect(box).not.toBeNull();
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, dx, dy);
}

test.beforeEach(async ({ page }, info) => {
  info.panelErrors = [];
  page.on('pageerror', error => info.panelErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.panelErrors).toEqual([]); });

test('docked sidebar defaults to 224px and its pointer resize respects both width limits without changing JSON', async ({ page }, info) => {
  const model = await mount(page);
  const before = await geometry(page);
  expect(before.mode).toBe('docked');
  expect(before.panel.width).toBeCloseTo(224, 0);
  await resizeDock(page, 100);
  const wider = await geometry(page);
  expect(wider.panel.width - before.panel.width).toBeCloseTo(100, 0);
  expect(wider.upper.x - before.upper.x).toBeCloseTo(100, 0);
  expect(wider.panel.y).toBe(before.panel.y);
  expect(wider.panel.height).toBe(before.panel.height);
  await resizeDock(page, -600);
  expect((await geometry(page)).panel.width).toBeCloseTo(192, 0);
  await resizeDock(page, 1000);
  expect((await geometry(page)).panel.width).toBeCloseTo(480, 0);
  await page.setViewportSize({ width: 1024, height: 700 });
  const small = await geometry(page);
  expect(small.panel.width).toBeLessThanOrEqual(464);
  expect(small.upper.width).toBeGreaterThanOrEqual(559);
  await expectUnedited(page, model);
  const pending = page.waitForEvent('download');
  await clickAction(page, 'save');
  expect(JSON.parse(await readFile(await (await pending).path(), 'utf8'))).toEqual(model);
  await page.screenshot({ path: info.outputPath('docked-adjustable-width.png'), fullPage: true });
});

test('docked separator offers keyboard resizing and restores the default width', async ({ page }) => {
  const model = await mount(page);
  await expect(edge(page)).toHaveAttribute('role', 'separator');
  await expect(edge(page)).toHaveAttribute('aria-orientation', 'vertical');
  await edge(page).focus();
  await page.keyboard.press('ArrowRight');
  expect((await geometry(page)).panel.width).toBeCloseTo(234, 0);
  await page.keyboard.press('Shift+ArrowRight');
  expect((await geometry(page)).panel.width).toBeCloseTo(274, 0);
  await page.keyboard.press('Home');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '192');
  await page.keyboard.press('End');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '480');
  await page.keyboard.press('Enter');
  await expect(edge(page)).toHaveAttribute('aria-valuenow', '224');
  await resizeDock(page, 80);
  await edge(page).dblclick();
  expect((await geometry(page)).panel.width).toBeCloseTo(224, 0);
  await expectUnedited(page, model);
});

test('grabbing the header undocks the panel, moves in every direction, and docks back to the chosen width', async ({ page }, info) => {
  const model = await mount(page);
  const initial = await geometry(page), initialPreference = await preferences(page);
  await moveHeader(page, 3, 2);
  expect((await geometry(page)).mode).toBe('docked');
  expectSameBox(initial.panel, (await geometry(page)).panel);
  expect(await preferences(page)).toBe(initialPreference);
  await resizeDock(page, 80);
  const dockWidth = (await geometry(page)).panel.width;
  const floating = await undock(page);
  expect(floating.upper.x).toBeCloseTo(floating.main.x, 0);
  await expect(edge(page)).toBeHidden();
  await expect(panelAction(page, 'dock')).toBeVisible();
  for (const [dx, dy] of [[80, 0], [0, 40], [-50, 0], [0, -30]]) {
    const before = await geometry(page);
    await moveHeader(page, dx, dy);
    const after = await geometry(page);
    expect(after.panel.x - before.panel.x).toBeCloseTo(dx, 0);
    expect(after.panel.y - before.panel.y).toBeCloseTo(dy, 0);
    expect(after.panel.width).toBeCloseTo(before.panel.width, 0);
    expect(after.panel.height).toBeCloseTo(before.panel.height, 0);
    expectContained(after);
  }
  await page.screenshot({ path: info.outputPath('freely-moved-panel.png'), fullPage: true });
  const vectorPending = page.waitForEvent('download');
  await clickAction(page, 'svg');
  const vector = await vectorPending;
  const svg = await readFile(await vector.path(), 'utf8');
  for (const text of ['專案／任務結構', '調整面板大小', 'data-sidebar-action']) expect(svg).not.toContain(text);
  expect(await page.evaluate(source => {
    const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
    return { errors: xml.querySelectorAll('parsererror').length, tasks: xml.querySelectorAll('.bar-wrapper').length, headers: xml.querySelectorAll('[data-export-header]').length };
  }, svg)).toEqual({ errors: 0, tasks: 15, headers: 1 });
  await vector.saveAs(info.outputPath('floating-panel-timeline.svg'));
  const jsonPending = page.waitForEvent('download');
  await clickAction(page, 'save');
  expect(JSON.parse(await readFile(await (await jsonPending).path(), 'utf8'))).toEqual(model);
  await panelAction(page, 'dock').click();
  const docked = await geometry(page);
  expect(docked.mode).toBe('docked');
  expect(docked.panel.width).toBeCloseTo(dockWidth, 0);
  expect(docked.panel.x).toBeCloseTo(docked.main.x, 0);
  expect(docked.panel.height).toBeCloseTo(docked.main.height, 0);
  await expectUnedited(page, model);
});

test('floating corner resizes width and height while window and split changes keep the panel reachable', async ({ page }, info) => {
  const model = await mount(page);
  await undock(page);
  const before = await geometry(page);
  await resizeFloat(page, 170, 90);
  const larger = await geometry(page);
  expect(larger.panel.width - before.panel.width).toBeCloseTo(170, 0);
  expect(larger.panel.height - before.panel.height).toBeCloseTo(90, 0);
  await resizeFloat(page, -1000, -1000);
  const smaller = await geometry(page);
  expect(smaller.panel.width).toBeCloseTo(224, 0);
  expect(smaller.panel.height).toBeCloseTo(180, 0);
  await moveHeader(page, 850, 550);
  await page.setViewportSize({ width: 1024, height: 700 });
  expectContained(await geometry(page));
  for (const mode of ['simple']) {
    await clickAction(page, mode);
    await settle(page);
    await page.locator('[data-select-p="0"]').click();
    const split = page.locator('#split');await split.focus();await split.press('ArrowLeft');
    const inspector=await page.locator('.bottom').boundingBox();
    expect(inspector.x).toBeGreaterThanOrEqual(0);
    expect(inspector.x+inspector.width).toBeLessThanOrEqual(1024);
    await page.locator('[data-outline-close]').click();
    expectContained(await geometry(page));
    await expect(page.locator('.picture-tools')).toBeVisible();
    await expect(panelAction(page, 'dock')).toBeVisible();
  }
  await expectUnedited(page, model);
  await page.screenshot({ path: info.outputPath('floating-small-window.png'), fullPage: true });
});

test('panel preferences survive modes, selection, manual editing, undo, redo and reload independently of data history', async ({ page }) => {
  const original = await mount(page);
  await resizeDock(page, 70);
  await undock(page);
  await resizeFloat(page, 70, -140);
  const baseline = (await geometry(page)).panel;
  const saved = await preferences(page);
  expect(JSON.parse(saved).mode).toBe('floating');
  for (const mode of ['simple', 'timeline']) {
    await clickAction(page, mode);
    expectSameBox(baseline, (await geometry(page)).panel);
    expect(JSON.parse(await preferences(page)).mode).toBe('floating');
  }
  await page.locator('[data-select-f="0:1"]').click();
  const input = page.locator('#editor [data-field="label"]');
  await input.fill('手動修改後保留面板位置');
  await input.press('Tab');await input.blur();
  const edited = await draft(page);
  expect(edited.projects[0].phases[1].locks.label).toBe(true);
  expect(edited.metadata).toEqual(original.metadata);
  expect(edited.projects.slice(1)).toEqual(original.projects.slice(1));
  expectSameBox(baseline, (await geometry(page)).panel);
  expect(await preferences(page)).toBe(saved);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(original);
  expectSameBox(baseline, (await geometry(page)).panel);
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(edited);
  expect(await preferences(page)).toBe(saved);
  await page.reload();
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(edited);
  expect(await preferences(page)).toBe(saved);
  expectSameBox(baseline, (await geometry(page)).panel);
});

test('Escape, pointer cancellation, blur and lost capture roll back panel gestures without committing preferences', async ({ page }) => {
  const model = await mount(page);
  await resizeDock(page, 40);
  for (const type of ['Escape', 'pointercancel', 'blur', 'lostcapture']) {
    const before = await geometry(page), saved = await preferences(page);
    await page.locator('.aside-title').evaluate(node => {
      node.addEventListener('pointerdown', event => { window.panelPointer = event.pointerId; }, { once: true });
    });
    const from = { x: before.header.x + 38, y: before.header.y + 18 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 100, from.y + 60, { steps: 6 });
    await expect(panel(page)).toHaveClass(/is-floating/);
    if (type === 'Escape') await page.keyboard.press('Escape');
    else if (type === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else if (type === 'pointercancel') await page.locator('.aside-title').evaluate(node => node.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.panelPointer, bubbles: true })));
    else {
      await page.evaluate(() => {
        const node = [...document.querySelectorAll('main, main *')].find(node => node.hasPointerCapture?.(window.panelPointer));
        if (!node) throw new Error('Panel did not capture the active pointer');
        node.releasePointerCapture(window.panelPointer);
      });
      await page.mouse.move(from.x + 105, from.y + 65);
    }
    await settle(page);
    expect((await geometry(page)).mode).toBe('docked');
    expectSameBox(before.panel, (await geometry(page)).panel);
    expect(await preferences(page)).toBe(saved);
    await page.mouse.move(from.x + 160, from.y + 80);
    await page.mouse.up();
    expectSameBox(before.panel, (await geometry(page)).panel);
    await expectUnedited(page, model);
  }
});

test('floating panel controls still create projects and move actual tree tasks without moving the panel', async ({ page }) => {
  const original = await mount(page);
  await undock(page);
  const before = (await geometry(page)).panel, saved = await preferences(page);
  await clickAction(page, 'newproject');
  const added = await draft(page);
  expect(added.projects.slice(0, original.projects.length)).toEqual(original.projects);
  expect(added.projects.at(-1).locks.name).toBe(true);
  expectSameBox(before, (await geometry(page)).panel);
  expect(await preferences(page)).toBe(saved);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(original);
  await panel(page).evaluate(node => { node.scrollTop = 0; });
  const moved = structuredClone(original.projects[0].phases[0]);
  await page.locator('.tree-item.phase[data-p="0"][data-f="0"]').dragTo(page.locator('.project[data-p="1"] > .tree-item[data-select-p="1"]'));
  const expected = structuredClone(original);
  expected.projects[0].phases.shift();
  expected.projects[1].phases.push({ ...moved, locks: { ...moved.locks, parent: true } });
  await expect.poll(() => draft(page)).toEqual(expected);
  expectSameBox(before, (await geometry(page)).panel);
  expect(await preferences(page)).toBe(saved);
  await clickAction(page, 'undo');
  await expectUnedited(page, original, { canRedo: true });
});

test('reset restores default docking and malformed or offscreen saved layouts remain operable', async ({ page }) => {
  const model = await mount(page, { mode: 'floating', dockWidth: 9999, float: { x: 99999, y: 99999, width: 9999, height: 9999 } });
  const box = await geometry(page);
  expect(box.mode).toBe('floating');
  expectContained(box);
  await expect(panelAction(page,'reset')).toHaveCount(0);
  await globalClick(page,'settings');await page.locator('[data-settings-category="workspace"]').click();await page.locator('[data-settings-action="reset-layout"]').click();await page.keyboard.press('Escape');
  const reset = await geometry(page);
  expect(reset.mode).toBe('docked');
  expect(reset.panel.width).toBeCloseTo(224, 0);
  expect(reset.panel.x).toBeCloseTo(reset.main.x, 0);
  expect(reset.panel.height).toBeCloseTo(reset.main.height, 0);
  await page.evaluate(() => localStorage.setItem('drag.sidebar', '{invalid JSON'));
  await page.reload();
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect((await geometry(page)).panel.width).toBeCloseTo(224, 0);
  await expectUnedited(page, model);
});
