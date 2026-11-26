import { test, expect } from './audit-fixture.js';
import { selectTimelineScale } from './global-actions.js';

const phases = Array.from({ length: 20 }, (_, i) => ({
  id: `stage-${i}`, label: `Stage ${i + 1}`, start: '2026-01-01', end: '2026-12-31',
}));
phases[2].end = '2026-01-15';
const model = { title: 'Annual plan', projects: [{ id: 'plan', name: 'Plan', phases }] };
const panel = page => page.locator('main > .bottom');
const nameField = page => panel(page).locator('[data-field="label"]');
const bar = (page, index) => page.locator(`.bar-wrapper[data-id="stage-${index}"] .bar`);

async function openChart(page) {
  await page.addInitScript(model => localStorage.setItem('drag.draft', JSON.stringify(model)), model);
  await page.goto('/');
  await expect(bar(page, 0)).toBeAttached();
  await selectTimelineScale(page, 'Day');
  const settings = page.locator('.view-settings');
  if (await settings.evaluate(node => node.open)) await settings.locator(':scope > summary').click();
  // Midyear exposes both ends of the long rows and leaves the January row empty.
  await bar(page, 0).evaluate(node => {
    const view = node.closest('.timeline-viewport');
    const bounds = node.getBoundingClientRect();
    view.scrollLeft += bounds.left + bounds.width / 2 - view.getBoundingClientRect().left - view.clientWidth / 2;
  });
}

async function clickPoint(page, index, edge) {
  const point = await bar(page, index).evaluate((node, edge) => {
    const view = node.closest('.timeline-viewport');
    const area = view.getBoundingClientRect();
    const row = node.getBoundingClientRect();
    const x = edge === 'left' ? area.left + 30 : area.left + view.clientWidth - 30;
    const y = row.top + row.height / 2;
    return { x, y, target: document.elementFromPoint(x, y)?.closest('.bar-wrapper')?.dataset.id };
  }, edge);
  expect(point.target).toBe(`stage-${index}`);
  return point;
}

async function panelBounds(page) {
  return panel(page).evaluate(node => {
    const rect = node.getBoundingClientRect();
    const view = document.querySelector('.timeline-viewport');
    const area = view.getBoundingClientRect();
    const dates = document.querySelector('.timeline-date-dock').getBoundingClientRect();
    return {
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      withinChart: rect.left > area.left && rect.top > dates.bottom &&
        rect.right < area.left + view.clientWidth && rect.bottom < area.top + view.clientHeight,
    };
  });
}

async function emptyGridPoint(page) {
  const point = await bar(page, 0).evaluate(node => {
    const view = node.closest('.timeline-viewport').getBoundingClientRect();
    const panel = document.querySelector('main > .bottom').getBoundingClientRect();
    const shortRow = document.querySelector('.bar-wrapper[data-id="stage-2"] .bar').getBoundingClientRect();
    const y = shortRow.top + shortRow.height / 2;
    const gaps = [[view.left, panel.left], [panel.right, view.right]].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const xs = gaps.map(([left, right]) => (left + right) / 2);
    const x = xs.find(x => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest('.timeline-viewport') && !hit.closest('.bar-wrapper');
    });
    return {x, y};
  });
  expect(point.x).toBeDefined();
  return point;
}

test('the inspector opens beside the clicked end of a task and clears the date ruler and all four chart edges', async ({page}) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await openChart(page);
  for (const index of [0, phases.length - 1]) {
    await page.locator('.timeline-viewport').evaluate((view, first) => {
      view.scrollTop = first ? 0 : view.scrollHeight;
    }, index === 0);
    for (const edge of ['left', 'right']) {
      const point = await clickPoint(page, index, edge);
      await page.mouse.click(point.x, point.y);
      await expect(nameField(page)).toHaveValue(phases[index].label);
      await expect.poll(async () => (await panelBounds(page)).withinChart).toBe(true);
      const bounds = await panelBounds(page);
      const gap = edge === 'left' ? bounds.left - point.x : point.x - bounds.right;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(55);
      expect(bounds.top).toBeLessThan(point.y + 55);
      expect(bounds.bottom).toBeGreaterThan(point.y - 55);
      await panel(page).locator('[data-outline-close]').click();
    }
  }
});

test('another bar replaces the visible form, edits survive, and a tap on empty chart space dismisses it', async ({page}) => {
  await openChart(page);
  const first = await clickPoint(page, 0, 'left');
  const savedPhases = () => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects[0].phases);
  const initial = await savedPhases();
  await page.mouse.click(first.x, first.y);
  await expect(nameField(page)).toHaveValue(phases[0].label);
  const name = 'Reviewed first stage';
  await nameField(page).fill(name);
  await expect(nameField(page)).toBeFocused();
  const second = await clickPoint(page, 1, 'right');
  await page.mouse.click(second.x, second.y);
  await expect(nameField(page)).toHaveValue(phases[1].label);
  await expect(page.locator('[data-field="label"]:visible')).toHaveCount(1);
  await expect(page.locator('[data-select-f="0:1"]')).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 1010, height: 550 });
  await expect.poll(async () => (await panelBounds(page)).withinChart).toBe(true);
  const blank = await emptyGridPoint(page);
  await page.mouse.click(blank.x, blank.y);
  await expect(panel(page)).toBeHidden();
  const saved = await savedPhases();
  expect(saved[0].label).toBe(name);
  expect(saved[1]).toEqual(initial[1]);
});

test.describe('small touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 740 } });

  test('a tap opens an internally scrollable form while leaving room to dismiss it', async ({page}) => {
    await openChart(page);
    const point = await clickPoint(page, 0, 'right');
    await page.touchscreen.tap(point.x, point.y);
    await expect(nameField(page)).toHaveValue(phases[0].label);
    await expect.poll(async () => (await panelBounds(page)).withinChart).toBe(true);
    const editor = panel(page).locator('#editor');
    await editor.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await editor.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    const outside = await emptyGridPoint(page);
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(panel(page)).toBeHidden();
  });
});

test('Escape returns keyboard focus to the chart task that opened properties', async ({page}) => {
  await openChart(page);
  const task = bar(page, 1);
  await task.focus();
  await task.press('Enter');
  await expect(nameField(page)).toHaveValue(phases[1].label);
  await expect.poll(async () => (await panelBounds(page)).withinChart).toBe(true);
  await nameField(page).press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(task).toBeFocused();
});
