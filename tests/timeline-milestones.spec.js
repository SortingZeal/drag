import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { selectTimelineScale, clickAction, selectSnap } from './global-actions.js';

const start = '2028-04-03', end = '2028-04-10';
const model = {
  title: 'Launch plan', presentation: { milestoneShape: 'star' },
  projects: [{ id: 'team', name: 'Team', color: '#365887', locks: {}, phases: [
    { id: 'dated', label: 'QA', start, end, status: 'Blocked',
      milestone: { label: 'Sign-off', date: '2028-04-06', owner: 'QA' }, milestoneShape: 'circle' },
    { id: 'plain', label: 'Planning', start, end },
    { id: 'undated', label: 'Review', start, end, status: 'In progress', milestone: '待確認' },
    { id: 'date-only', label: 'Release', start, end, milestoneDate: '2028-04-08' },
    { id: 'long', label: 'Long label', start, end, milestone: '🚀     驗收'.repeat(25), status: '🛰️   調整'.repeat(25) },
    { id: 'beyond', label: 'Handoff', start, end, milestoneDate: '2035-04-08' },
  ].map(task => ({ ...task, locks: {} })) }],
};
const row = (page, id) => page.locator(`.bar-wrapper[data-id="${id}"]`);
const mark = (page, id) => row(page, id).locator('.bar-milestone');
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(data => {
    localStorage.setItem('drag.draft', JSON.stringify(data));
    localStorage.setItem('drag.snap', '1d');
  }, model);
  await page.goto('/');
  await expect(row(page, 'dated').locator('.bar')).toBeVisible();
});

test('milestones preserve their names, dates, shape and colour in the timeline and downloaded SVG', async ({ page }) => {
  await expect(mark(page, 'plain')).toHaveCount(0);
  await expect(mark(page, 'dated').locator('text')).toHaveText('Sign-off · 2028-04-06');
  await expect(mark(page, 'dated').locator('[data-shape]')).toHaveAttribute('data-shape', 'circle');
  await expect(mark(page, 'undated').locator('text')).toHaveText(/待確認 · (日期待定|Date TBD)/);
  await expect(mark(page, 'undated').locator('[data-shape]')).toHaveAttribute('data-shape', 'star');
  await expect(mark(page, 'date-only').locator('text')).toHaveText('2028-04-08');
  await expect(mark(page, 'long').locator('text')).toContainText('…');
  await expect(mark(page, 'long').locator('title')).toContainText(model.projects[0].phases[4].milestone);
  await expect(mark(page, 'beyond')).toHaveAttribute('data-range-state', 'after');
  const blocked = row(page, 'dated').locator('.bar-status-badge circle');
  const active = row(page, 'undated').locator('.bar-status-badge circle');
  expect(await blocked.getAttribute('fill')).not.toEqual(await active.getAttribute('fill'));

  const rows = page.locator('.bar-wrapper');
  const rects = await rows.evaluateAll(nodes => nodes.map(node => {
    const box = selector => node.querySelector(selector)?.getBoundingClientRect().toJSON();
    return { bar: box('.bar'), status: box('.bar-status-badge'), mark: box('.bar-milestone-text') };
  }));
  for (const [index, row] of rects.entries()) {
    if (row.status) expect(row.status.bottom).toBeLessThanOrEqual(row.bar.top);
    if (row.mark) {
      expect(row.mark.top).toBeGreaterThanOrEqual(row.bar.bottom);
      const next = rects[index + 1];
      if (next) expect(row.mark.bottom).toBeLessThanOrEqual((next.status || next.bar).top);
    }
  }
  function annotations(svg) {
    return Array.from(svg.querySelectorAll('.bar-milestone'), mark => ({
      label: mark.querySelector('text').textContent, title: mark.querySelector('title').textContent,
      shape: mark.querySelector('[data-shape]').dataset.shape,
      color: mark.querySelector('[data-shape]').getAttribute('fill'), transform: mark.getAttribute('transform'),
    }));
  }
  const drawn = await page.locator('#gantt svg.gantt').evaluate(annotations);
  const [file] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'svg')]);
  const xml = await readFile(await file.path(), 'utf8');
  const exported = await page.evaluateHandle(xml => new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement, xml);
  expect(await exported.evaluate(annotations)).toEqual(drawn);
  await exported.dispose();
  expect(await draft(page)).toEqual(model);
});

test('click and keyboard open the chosen task field, and moving a pin only changes its date', async ({ page }) => {
  await selectTimelineScale(page, 'Day');
  await selectSnap(page, '1d');
  const pin = mark(page, 'dated').locator('[data-shape]');
  const drawer = page.locator('.bottom');
  const close = page.locator('[data-outline-close]');
  await pin.click();
  await expect(drawer).toBeVisible();
  await expect(page.locator('#editor [data-milestone-anchor="start"]')).toBeFocused();
  await expect(page.locator('#editor [data-field="milestone"]')).toHaveValue('Sign-off');
  await close.click();
  await row(page, 'dated').locator('.bar-status-badge').press('Enter');
  await expect(drawer).toBeVisible();
  await expect(page.locator('#editor [data-status-choice][aria-pressed="true"]')).toBeFocused();
  await expect(page.locator('#editor [data-task-status]')).toHaveValue('Blocked');
  await close.click();
  await pin.scrollIntoViewIfNeeded();
  const box = await pin.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const dx = await row(page, 'dated').locator('.bar').evaluate(bar => Number(bar.getAttribute('width')) / 8);
  const drag = async () => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx * 2, y, { steps: 6 });
    await expect(mark(page, 'dated')).toHaveAttribute('data-date', '2028-04-08');
    expect(await draft(page)).toEqual(model);
  };
  await drag();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(mark(page, 'dated')).toHaveAttribute('data-date', '2028-04-06');
  await expect(drawer).toBeHidden();
  await drag();
  await page.mouse.up();
  const expected = structuredClone(model);
  const task = expected.projects[0].phases[0];
  task.milestone.date = '2028-04-08';
  task.locks = { milestoneDate: true };
  expect(await draft(page)).toEqual(expected);
  await expect(drawer).toBeHidden();
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
});
