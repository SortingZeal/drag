import { selectTimelineScale } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, value) => page.locator(`[data-action="${value}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const scroll = page => page.locator('.preview').evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop }));

async function mount(page, view = 'Day', pane = 55) {
  const model = structuredClone(seed);
  model.metadata = { source: 'date-strip-navigation', nested: ['保留', { value: 59 }] };
  model.projects.forEach((project, pi) => {
    project.id = `navigation-project-${pi}`;
    project.locks = { color: true };
    project.phases.forEach((phase, fi) => {
      phase.id = `navigation-phase-${pi}-${fi}`;
      phase.locks = { label: true };
      phase.metadata = { keep: [pi, fi] };
    });
  });
  await page.addInitScript(({ value, pane }) => {
    if (!localStorage.getItem('navigation.seeded')) {
      localStorage.setItem('drag.draft', JSON.stringify(value));
      localStorage.setItem('drag.leftPaddingMonths', '3');
      localStorage.setItem('drag.rightPaddingMonths', '3');
      localStorage.setItem('drag.paneHeight', String(pane));
      localStorage.setItem('navigation.seeded', 'true');
    }
  }, { value: model, pane });
  await page.goto('/');
  await selectTimelineScale(page, view);
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  await expect(action(page, 'undo')).toBeDisabled();
  await expect(action(page, 'redo')).toBeDisabled();
  await settle(page);
  return model;
}

async function dateStripPoint(page) {
  const preview = await page.locator('.preview').boundingBox();
  const header = await page.locator('.grid-header').boundingBox();
  return { x: preview.x + preview.width * .5, y: header.y + header.height * .72 };
}

async function moveStrip(page, dx, dy = 0) {
  const point = await dateStripPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 10 });
  await page.mouse.up();
  await settle(page);
}

async function expectSeparatedDateDock(page) {
  const geometry = await page.evaluate(() => {
    const shell = document.querySelector('.timeline-shell');
    const dock = shell.querySelector('.timeline-date-dock');
    const header = dock.querySelector('.grid-header');
    const preview = shell.querySelector('.preview');
    const box = node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    const rect = dock.getBoundingClientRect();
    const hits = [.1, .5, .9].flatMap(x => [.2, .7, .95].map(y => {
      const stack = document.elementsFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
      return {
        hitsDock: stack.some(node => node === dock || dock.contains(node)),
        hitsTaskCanvas: stack.some(node => node === preview || node.closest?.('.bar-wrapper, svg.gantt')),
      };
    }));
    return {
      shell: box(shell), dock: box(dock), header: box(header), preview: box(preview), hits,
      background: getComputedStyle(dock).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      headerPosition: getComputedStyle(header).position,
      previewContain: getComputedStyle(preview).contain,
      bodyHeader: !!preview.querySelector('.grid-header'),
    };
  });
  expect(geometry.dock.y).toBeCloseTo(geometry.shell.y, 0);
  expect(geometry.header.y).toBeCloseTo(geometry.dock.y, 0);
  expect(geometry.dock.y + geometry.dock.height).toBeLessThanOrEqual(geometry.preview.y + 1);
  expect(geometry.header.y + geometry.header.height).toBeLessThanOrEqual(geometry.preview.y + 1);
  expect(geometry.bodyHeader).toBe(false);
  expect(geometry.background).toMatch(/^rgb\(/);
  expect(geometry.headerBackground).toMatch(/^rgb\(/);
  expect(geometry.headerPosition).toBe('relative');
  expect(geometry.previewContain).toContain('paint');
  expect(geometry.hits).toEqual(Array.from({ length: 9 }, () => ({ hitsDock: true, hitsTaskCanvas: false })));
  return geometry;
}

test.beforeEach(async ({ page }, info) => {
  info.navigationErrors = [];
  page.on('pageerror', error => info.navigationErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.navigationErrors).toEqual([]); });

test('dragging the date strip pans dates and task bars together without a horizontal scrollbar or edits', async ({ page }, info) => {
  const model = await mount(page);
  await expectSeparatedDateDock(page);
  const before = await scroll(page);
  const bar = page.locator('.bar-wrapper[data-id="navigation-phase-0-0"] .bar').first();
  const box = await bar.boundingBox();
  const date = page.locator('.grid-header .lower-text').nth(3);
  const dateBox = await date.boundingBox();
  await moveStrip(page, -180);
  const after = await scroll(page);
  expect(after.left - before.left).toBeCloseTo(180, 0);
  expect(after.top).toBe(before.top);
  expect((await bar.boundingBox()).x - box.x).toBeCloseTo(-180, 0);
  expect((await date.boundingBox()).x - dateBox.x).toBeCloseTo(-180, 0);
  await moveStrip(page, 100);
  expect((await scroll(page)).left - after.left).toBeCloseTo(-100, 0);
  expect(await page.locator('.preview').evaluate(node => ({ x: getComputedStyle(node).overflowX, y: getComputedStyle(node).overflowY }))).toEqual({ x: 'hidden', y: 'auto' });
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await expect(page.locator('#gantt')).not.toHaveClass(/is-panning-dates/);
  await page.screenshot({ path: info.outputPath('date-strip-pan.png'), fullPage: true });
});

test('dragging from the date strip into the open inspector leaves the inspector interactive', async ({ page }, info) => {
  const model = await mount(page);
  await page.locator('[data-select-f="0:0"] .tree-label').click();
  const before = await scroll(page);
  const headerBefore = await page.locator('.grid-header').boundingBox();
  const point = await dateStripPoint(page);
  const editor = await page.locator('#editor').boundingBox();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(editor.x + editor.width * .7, editor.y + 80, { steps: 12 });
  const hits = await page.evaluate(() => {
    return ['.split', '#editor'].map(selector => {
      const node = document.querySelector(selector), box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width * .7, box.y + 50);
      return node.contains(hit);
    });
  });
  expect(hits).toEqual([true, true]);
  await page.screenshot({ path: info.outputPath('date-strip-contained-during-drag.png'), fullPage: true });
  await page.mouse.up();
  await settle(page);
  expect((await scroll(page)).top).toBe(before.top);
  expect((await page.locator('.grid-header').boundingBox()).y).toBeCloseTo(headerBefore.y, 0);
  await page.locator('#editor [data-field="label"]').click();
  await expect(page.locator('#editor [data-field="label"]')).toBeFocused();
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('bar hover highlights its dates in the detached dock without stale upstream container lookups', async ({ page }) => {
  const model = await mount(page);
  const bar = page.locator('.bar-wrapper[data-id="navigation-phase-0-0"] .bar');
  await bar.evaluate(node => {
    const preview = document.querySelector('.preview');
    preview.scrollLeft += node.getBoundingClientRect().left - preview.getBoundingClientRect().left - preview.clientWidth * .4;
  });
  await settle(page);
  const barBox = await bar.boundingBox();
  await page.mouse.move(barBox.x + Math.min(80,barBox.width/2), barBox.y + barBox.height / 2);
  const highlight = page.locator('.timeline-date-dock .date-range-highlight:not(.hide)');
  await expect(highlight).toHaveCount(1);
  const highlightBox = await highlight.boundingBox();
  expect(highlightBox.x).toBeCloseTo(barBox.x, 0);
  expect(highlightBox.width).toBeCloseTo(barBox.width, 0);
  await page.locator('.workspace-title').hover();
  await expect(highlight).toHaveCount(0);
  // Rebuilding while a delayed hover is pending must cancel the old timer.
  await page.mouse.move(barBox.x + Math.min(80,barBox.width/2), barBox.y + barBox.height / 2);
  await selectTimelineScale(page, 'Month');
  await expect(page.locator('.timeline-date-dock .grid-header')).toHaveCount(1);
  await expectSeparatedDateDock(page);
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('date-strip navigation cancels on Escape and blur and remains usable after view changes', async ({ page }) => {
  const model = await mount(page);
  for (const cancel of ['Escape', 'blur']) {
    const point = await dateStripPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 80, point.y, { steps: 5 });
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const stopped = await scroll(page);
    await page.mouse.move(point.x - 160, point.y + 30, { steps: 5 });
    await page.mouse.up();
    expect(await scroll(page)).toEqual(stopped);
    await expect(page.locator('#gantt')).not.toHaveClass(/is-panning-dates/);
  }
  await selectTimelineScale(page, 'Month');
  const before = await scroll(page);
  await moveStrip(page, -70);
  expect((await scroll(page)).left).toBeGreaterThan(before.left + 60);
  await selectTimelineScale(page, 'Week');
  const next = await scroll(page);
  await moveStrip(page, -70);
  expect((await scroll(page)).left).toBeGreaterThan(next.left + 60);
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
});

for (const side of ['left', 'right']) test(`date-strip drag extends the ${side} boundary without moving stored dates`, async ({ page }) => {
  const model = await mount(page);
  await page.locator('.preview').evaluate((node, side) => { node.scrollLeft = side === 'left' ? 0 : node.scrollWidth - node.clientWidth; }, side);
  await settle(page);
  const key = side === 'left' ? 'drag.leftPaddingMonths' : 'drag.rightPaddingMonths';
  const before = await page.evaluate(key => Number(localStorage.getItem(key)), key);
  const point = await dateStripPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + (side === 'left' ? 100 : -100), point.y, { steps: 5 });
  await expect.poll(() => page.evaluate(key => Number(localStorage.getItem(key)), key)).toBeGreaterThan(before);
  await page.mouse.up();
  await moveStrip(page, side === 'left' ? 60 : -60);
  await expect(page.locator('.timeline-date-dock .grid-header')).toHaveCount(1);
  await expectSeparatedDateDock(page);
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('horizontal wheel navigation works and vertical scrolling leaves dates in a separate opaque row above the tasks', async ({ page }, info) => {
  await page.setViewportSize({width:1024,height:420});
  const model = await mount(page);
  const beforeDock = await expectSeparatedDateDock(page);
  const point = await dateStripPoint(page);
  await page.mouse.move(point.x, point.y + 90);
  const before = await scroll(page);
  await page.mouse.wheel(180, 0);
  await expect.poll(async () => (await scroll(page)).left).toBeGreaterThan(before.left + 100);
  await page.mouse.wheel(0, 350);
  await expect.poll(async () => (await scroll(page)).top).toBeGreaterThan(before.top + 150);
  const afterDock = await expectSeparatedDateDock(page);
  expect(afterDock.header.y).toBeCloseTo(beforeDock.header.y, 0);
  expect(afterDock.preview).toEqual(beforeDock.preview);
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('date-strip-vertical-containment.png'), fullPage: true });
});

test('all five views rebuild one aligned date dock while task scrolling stays independent', async ({ page }) => {
  const model = await mount(page);
  for (const view of ['Day', 'Week', 'Month', 'Quarter', 'Year']) {
    await selectTimelineScale(page, view);
    await expect(page.locator('.timeline-shell')).toHaveCount(1);
    await expect(page.locator('.timeline-date-dock .grid-header')).toHaveCount(1);
    const before = await expectSeparatedDateDock(page);
    await page.locator('.preview').evaluate(node => { node.scrollTop = 140; });
    await settle(page);
    const after = await expectSeparatedDateDock(page);
    expect(after.header.y).toBeCloseTo(before.header.y, 0);
    expect(after.preview).toEqual(before.preview);
    expect(await draft(page)).toEqual(model);
  }
  await expect(action(page, 'undo')).toBeDisabled();
});

test('a short timeline keeps task bars below dates and its inspector interactive during a drag', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 520 });
  const model = await mount(page, 'Day', 25);
  await page.locator('[data-select-f="0:0"] .tree-label').click();
  const before = await expectSeparatedDateDock(page);
  expect(before.preview.height).toBeGreaterThan(25);
  await page.locator('.preview').evaluate(node => { node.scrollTop = 350; });
  await settle(page);
  const scrolled = await expectSeparatedDateDock(page);
  expect(scrolled.header.y).toBeCloseTo(before.header.y, 0);
  const point = await dateStripPoint(page);
  const editor = await page.locator('#editor').boundingBox();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(editor.x + editor.width * .7, editor.y + 50, { steps: 8 });
  await expectSeparatedDateDock(page);
  const covered = await page.evaluate(() => ['.split', '#editor'].map(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return !!document.elementFromPoint(box.x + box.width * .7, box.y + Math.min(50, box.height / 2))
      ?.closest('.timeline-date-dock, .grid-header, #gantt');
  }));
  expect(covered).toEqual([false, false]);
  await page.screenshot({ path: info.outputPath('date-dock-small-pane-during-drag.png'), fullPage: true });
  await page.mouse.up();
  await page.locator('#editor [data-field="label"]').click();
  await expect(page.locator('#editor [data-field="label"]')).toBeFocused();
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('clicking a date changes scale around that date without changing task data or the vertical position', async ({page}) => {
  await page.setViewportSize({width:1280,height:540});
  const model = await mount(page);
  const ruler = page.locator('.timeline-date-dock');
  const task = page.locator('.bar-wrapper[data-id="navigation-phase-0-0"] .bar');
  await task.evaluate(bar => {
    const viewport = bar.closest('.preview');
    viewport.scrollLeft += bar.getBoundingClientRect().left - viewport.getBoundingClientRect().left - 180;
    viewport.scrollTop = 120;
  });
  await settle(page);
  const original = await task.boundingBox();
  const before = await scroll(page);
  const dock = await ruler.boundingBox();
  for (const next of ['Week','Month','Week','Day']) {
    await page.mouse.click(original.x,dock.y + dock.height * .74);
    const menu = page.getByRole('menu', {name:'時間尺度'});
    await expect(menu.getByRole('menuitemradio')).toHaveCount(5);
    await menu.locator(`[data-scale="${next}"]`).click();
    await expect(ruler).toHaveAttribute('data-scale',next);
    await expect(menu).toBeHidden();
    expect(Math.abs((await task.boundingBox()).x - original.x)).toBeLessThanOrEqual(1.5);
    expect((await scroll(page)).top).toBe(before.top);
  }
  await expect(ruler).toBeFocused();
  expect(await draft(page)).toEqual(model);
  await expect(action(page,'undo')).toBeDisabled();
});

test('the date ruler exposes all five scales to the keyboard and dragging never opens its menu', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('drag.preferences', JSON.stringify({version:1,values:{language:'en'}}));
  });
  await mount(page,'Week');
  const ruler = page.locator('.timeline-date-dock');
  const menu = page.getByRole('menu',{name:'Time scale',includeHidden:true});
  await expect(ruler).toHaveAccessibleName('Time scale · Week');
  const hint = ruler.locator('.timeline-scale-hint');
  await expect(hint).toHaveText('Click a date to change scale');
  await expect(hint).toHaveCSS('pointer-events','none');
  await ruler.focus();
  await page.keyboard.press('Enter');
  await expect(ruler).toHaveAttribute('aria-expanded','true');
  await expect(menu.locator('[aria-checked=true]')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(ruler).toHaveAttribute('data-scale','Year');
  await expect(ruler).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(ruler).toHaveAttribute('data-scale','Day');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(ruler).toHaveAttribute('data-scale','Day');
  await expect(ruler).toBeFocused();
  await moveStrip(page,-85);
  await expect(menu).toBeHidden();
  await ruler.click();
  await expect(menu).toBeVisible();
  await ruler.click();
  await expect(menu).toBeHidden();
  await ruler.click();
  await page.locator('.workspace-heading').click({position:{x:1,y:1}});
  await expect(menu).toBeHidden();
  await expect(ruler).toHaveAttribute('data-scale','Day');
});
