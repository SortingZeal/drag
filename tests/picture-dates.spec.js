import { globalClick, openViewOptions, openViewSection } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFile } from 'node:fs/promises';

const model = {
  title: '日期測試',
  projects: [
    { id: 'p1', name: '專案一', color: '#2256b8', phases: [{ id: 'f1', label: '十月任務', start: '2026-10-01', end: '2026-10-30', milestone: '完成', milestoneDate: '2026-10-30', locks: { label: true }, custom: { keep: true } }] },
    { id: 'p2', name: '專案二', color: '#15803d', phases: [{ id: 'f2', label: '另一任務', start: '2026-10-15', end: '2026-11-15', locks: { end: true } }] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T04:00:00Z'));
  await page.addInitScript(value => localStorage.setItem('drag.draft', JSON.stringify(value)), model);
  await page.goto('/');
});

test('display start clips out-of-range bars and today line appears in the picture', async ({ page }) => {
  for (const [mode, attribute] of [['simple', 'data-simple']]) {
    await page.locator(`[data-action="${mode}"]`).click();
    const svg = page.locator(`#infographic-panel svg[${attribute}]`);
    await expect(svg).toBeVisible();
    await openViewOptions(page);
    await page.locator('#report-start').fill('2026-11-03');
    await page.locator('#report-start').press('Tab');
    await expect(svg).toHaveAttribute('data-start', '2026-11-03');
    await expect(svg.locator('[data-phase-id="f1"]')).toHaveCount(0);
    await expect(svg.locator('[data-role="range-note"]')).toHaveCount(0);
    await expect(svg).not.toContainText('範圍外');
    await expect(svg.locator('[data-role="today-line"][data-date="2026-11-10"]')).not.toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await globalClick(page,'svg');
    const download = await downloadPromise;
    const exported = await readFile(await download.path(), 'utf8');
    expect(exported).toContain('data-role="today-line"');
    expect(exported).toContain('data-date="2026-11-10"');
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  expect(stored.projects).toEqual(model.projects.map(project => ({ ...project, locks: {} })));
});

test('picture alignment changes placement only and remains undoable', async ({ page }) => {
  await page.locator('[data-action="simple"]').click();
  await openViewSection(page,'.align-start');
  await page.locator('#align-mode').selectOption('date');
  await page.locator('#align-start-date').fill('2026-11-03');
  await page.locator('#align-start-apply').click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  const current = await stored();
  expect(current.projects).toEqual(model.projects.map(project => ({ ...project, locks: {} })));
  expect(current.presentation.alignMode).toBe('date');
  expect(current.presentation.alignDate).toBe('2026-11-03');
  const svg = page.locator('.roadmap-simple');
  await expect(svg).toHaveAttribute('data-start', '2026-11-03');
  await expect(svg.locator('[data-phase-id="f1"]')).toHaveCount(0);
  await expect(svg.locator('[data-phase-id="f2"]')).toHaveAttribute('data-start', '2026-10-15');
  await expect(page.locator('#report-start')).toHaveValue('2026-11-03');
  await expect(page.locator('#report-start')).toBeDisabled();
  await expect(svg.locator('[data-role="today-line"][data-date="2026-11-10"]')).not.toHaveCount(0);
  await page.locator('[data-action="timeline"]').click();
  await expect(page.locator('[data-field="start"]')).toHaveValue('2026-10-01');
  await globalClick(page,'undo');
  expect((await stored()).projects).toEqual(current.projects);
  await page.locator('[data-action="simple"]').click();
  await expect(page.locator('.roadmap-simple [data-phase-id="f1"]')).toHaveAttribute('data-start', '2026-10-01');
});

test('today alignment and the separate date line have independent modes', async ({ page }) => {
  await page.locator('[data-action="simple"]').click();
  await openViewSection(page,'.align-start');
  await page.locator('#align-mode').selectOption('today');
  await expect(page.locator('#align-start-date')).toBeDisabled();
  await page.locator('#align-start-apply').click();
  await expect(page.locator('.roadmap-simple')).toHaveAttribute('data-start', '2026-11-10');
  await expect(page.locator('.roadmap-simple [data-phase-id="f1"]')).toHaveCount(0);
  await expect(page.locator('.roadmap-simple [data-phase-id="f2"]')).toHaveAttribute('data-start', '2026-10-15');
  await openViewSection(page,'.date-line');
  await page.locator('#date-line-mode').selectOption('custom');
  await page.locator('#date-line-date').fill('2026-11-20');
  await page.locator('#date-line-apply').click();
  await expect(page.locator('.roadmap-simple [data-role="today-line"][data-date="2026-11-20"]')).not.toHaveCount(0);
  await expect(page.locator('.roadmap-simple [data-role="today-line"][data-date="2026-11-10"]')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  expect(saved.projects).toEqual(model.projects.map(project => ({ ...project, locks: {} })));
  expect(saved.presentation.alignMode).toBe('today');
  expect(saved.presentation.dateLineMode).toBe('custom');
  await openViewSection(page,'.date-line');
  await page.locator('#date-line-mode').selectOption('off');
  await page.locator('#date-line-apply').click();
  await expect(page.locator('.roadmap-simple [data-role="today-line"]')).toHaveCount(0);
  await expect(page.locator('.roadmap-simple [data-phase-id="f1"]')).toHaveCount(0);
});

test('alignment after the saved end clips old work and restores the manual range when turned off', async ({ page }) => {
  for (const [mode, attribute] of [['simple', 'data-simple']]) {
    await page.locator(`[data-action="${mode}"]`).click();
    await openViewOptions(page);
    await page.locator('#report-start').fill('2026-10-01');
    await page.locator('#report-start').press('Tab');
    await page.locator('#report-end').fill('2026-10-30');
    await page.locator('#report-end').press('Tab');
    await openViewSection(page,'.align-start');
    await page.locator('#align-mode').selectOption('date');
    await page.locator('#align-start-date').fill('2026-11-03');
    await page.locator('#align-start-apply').click();
    const svg = page.locator(`#infographic-panel svg[${attribute}]`);
    await expect(svg).toHaveAttribute('data-start', '2026-11-03');
    await expect(svg).toHaveAttribute('data-end', '2026-11-30');
    await expect(svg.locator('[data-phase-id="f1"]')).toHaveCount(0);
    await expect(svg.locator('[data-phase-id="f2"]')).toHaveAttribute('data-start', '2026-10-15');
    await expect(svg).not.toContainText('範圍外');
    await expect(page.locator('#report-start')).toHaveValue('2026-11-03');
    await expect(page.locator('#report-start')).toBeDisabled();
    await expect(page.locator('#report-end')).toHaveValue('');
    await openViewSection(page,'.align-start');
    await page.locator('#align-mode').selectOption('off');
    await page.locator('#align-start-apply').click();
    await expect(svg).toHaveAttribute('data-start', '2026-10-01');
    await expect(svg).toHaveAttribute('data-end', '2026-10-30');
    await expect(svg.locator('[data-phase-id="f1"]')).toHaveAttribute('data-start', '2026-10-01');
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  expect(stored.projects).toEqual(model.projects.map(project => ({ ...project, locks: {} })));
});

test('alignment and date line controls remain reachable in a small window', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 500 });
  await page.locator('[data-action="simple"]').click();
  await openViewSection(page,'.align-start');
  await page.locator('#align-mode').selectOption('date');
  await page.locator('#align-start-date').fill('2026-11-03');
  await expect(page.locator('#align-start-apply')).toBeInViewport();
  await page.locator('#align-start-apply').click();
  await openViewSection(page,'.date-line');
  await page.locator('#date-line-mode').selectOption('custom');
  await page.locator('#date-line-date').fill('2026-11-20');
  await expect(page.locator('#date-line-apply')).toBeInViewport();
  await page.locator('#date-line-apply').click();
  await expect(page.locator('.roadmap-simple [data-role="today-line"][data-date="2026-11-20"]')).not.toHaveCount(0);
});
