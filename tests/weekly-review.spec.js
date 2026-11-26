import { test, expect } from './audit-fixture.js';
import { globalClick } from './global-actions.js';

const task = (id, end, data = {}) => ({ id, label: id, start: '2028-01-01', end, ...data });
const review = {
  title: 'Release review',
  projects: [
    { id: 'first', name: 'Design', phases: [
      task('Late with zero', '2028-01-03', { status: 'Custom', progress: '0' }),
      task('Past, no report', '2028-01-04'),
      task('Due today', '2028-01-05'),
      task('Done', '2028-01-01', { progress: 100 }),
    ] },
    { id: 'second', name: 'Delivery', phases: [
      task('Late with progress', '2028-01-04', { progress: 40 }),
      task('Open end', '2028-01-01', { open_end: true }),
      task('Next week', '2028-01-10', { progress: 25 }),
    ] },
  ],
};
const filter = (page, kind) => page.locator(`[data-weekly-filter="${kind}"]`);
const tracking = page => page.locator('[data-action="tracking"]');
const names = page => page.locator('.weekly-row .weekly-name');
const row = (page, name) => page.locator('.weekly-row').filter({ has: page.getByText(name, { exact: true }) });
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));

async function open(page, model = review) {
  await page.clock.setFixedTime(new Date('2028-01-05T12:00:00Z'));
  await page.addInitScript(data => localStorage.setItem('drag.draft', JSON.stringify(data)), model);
  await page.goto('/?lang=en');
  await expect(tracking(page)).toBeVisible();
}

test('weekly filters distinguish an overdue 0% from a missing report and preserve keyboard navigation', async ({page}) => {
  await open(page);
  const initial = await draft(page);
  await tracking(page).press('Enter');
  await expect(filter(page, 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tree')).toBeHidden();
  await expect(names(page)).toHaveText(['Late with zero', 'Late with progress', 'Past, no report', 'Due today', 'Open end']);
  await filter(page, 'overdue').click();
  await expect(names(page)).toHaveText(['Late with zero', 'Late with progress']);
  await row(page, 'Late with zero').press('Enter');
  await expect(page.locator('#weekly-report-progress')).toHaveValue('0');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Late with zero')).toBeFocused();
  await filter(page, 'unreported').click();
  await expect(names(page)).toHaveText(['Past, no report', 'Due today', 'Open end']);
  await filter(page, 'unconfirmed').click();
  await expect(names(page)).toHaveText(['Past, no report']);
  await row(page, 'Past, no report').click();
  await expect(page.locator('#weekly-report-progress')).toHaveValue('');
  await filter(page, 'due').click();
  await expect(names(page)).toHaveText(['Due today']);
  await page.locator('[data-action="timeline"]').press('Enter');
  await expect(page.locator('#tree')).toBeVisible();
  await expect(page.locator('#tracking-page')).toBeHidden();
  expect(await draft(page)).toEqual(initial);
});

test('a blocked task stays discoverable across deadlines, languages and undo', async ({page}) => {
  const model = structuredClone(review);
  const [, delivery] = model.projects;
  delivery.phases[0].status = '受阻';
  delivery.phases[2].status = 'Blocked';
  await open(page, model);
  const initial = await draft(page);
  await tracking(page).click();
  const late = row(page, 'Late with progress');
  for (const category of ['all', 'overdue', 'blocked']) {
    await filter(page, category).click();
    await expect(late).toHaveCount(1);
    await expect(late).toContainText('Blocked');
    await expect(late).toContainText('Overdue');
  }
  await expect(names(page)).toHaveText(['Late with progress', 'Next week']);
  await page.locator('#workspace-language').selectOption('zh-TW');
  await expect(filter(page, 'blocked')).toHaveAttribute('aria-pressed', 'true');
  await expect(late).toContainText('受阻');
  await expect(late).toContainText('已逾期');
  const future = row(page, 'Next week');
  await future.click();
  await page.locator('#weekly-report-form [data-status-choice="1"]').click();
  await page.locator('[data-weekly-save]').click();
  await expect(future).toHaveCount(0);
  await expect(late).toHaveCount(1);
  await globalClick(page, 'undo');
  await expect(future).toHaveCount(1);
  expect(await draft(page)).toEqual(initial);
});

test('saving advances across projects, removes completed rows and can be undone as one change', async ({page}) => {
  await open(page);
  const initial = await draft(page);
  await tracking(page).click();
  await filter(page, 'overdue').click();
  await row(page, 'Late with zero').click();
  await page.locator('#weekly-report-status').fill('Verified');
  await page.locator('#weekly-report-progress').fill('100');
  await page.locator('#weekly-report-note').fill('Reviewed locally');
  await page.locator('[data-weekly-save]').click();
  await expect(names(page)).toHaveText(['Late with progress']);
  await expect(row(page, 'Late with progress')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#weekly-report-status')).toBeFocused();
  await expect(page.locator('#weekly-report-progress')).toHaveValue('40');
  expect((await draft(page)).projects[0].phases[0]).toMatchObject({
    status: 'Completed', progress: 100, progressNote: 'Reviewed locally',
  });
  await globalClick(page, 'undo');
  expect(await draft(page)).toEqual(initial);
  await expect(names(page)).toHaveText(['Late with zero', 'Late with progress']);
});

test('project and category filters combine without changing the roadmap', async ({page}) => {
  await open(page);
  const original = await draft(page);
  await tracking(page).click();
  const project = page.locator('#tracking-project-filter');
  await project.selectOption({label: 'Delivery'});
  await filter(page, 'overdue').click();
  await expect(names(page)).toHaveText(['Late with progress']);
  await row(page, 'Late with progress').click();
  await expect(page.locator('#weekly-report-progress')).toHaveValue('40');
  await project.selectOption({label: 'Design'});
  await expect(names(page)).toHaveText(['Late with zero']);
  await filter(page, 'due').click();
  await expect(names(page)).toHaveText(['Due today']);
  expect(await draft(page)).toEqual(original);
});

test('a rescheduled task moves between review categories and keeps its unsaved update', async ({page}) => {
  await open(page);
  await tracking(page).click();
  await filter(page, 'overdue').click();
  await row(page, 'Late with zero').click();
  await page.locator('#weekly-report-note').fill('Replanned');

  await page.locator('[data-action="timeline"]').click();
  await page.locator('#tree [data-select-f="0:0"] .tree-label').click();
  const schedule = page.locator('[data-editor-section="schedule"]');
  if (!await schedule.evaluate(section => section.open)) await schedule.locator('summary').click();
  const end = schedule.locator('[data-field="end"]');
  await end.fill('2028-01-06');
  await end.press('Tab');

  await tracking(page).click();
  await expect(names(page)).toHaveText(['Late with progress']);
  await filter(page, 'due').click();
  await row(page, 'Late with zero').click();
  await expect(page.locator('#weekly-report-note')).toHaveValue('Replanned');
  await page.locator('[data-weekly-save]').click();
  expect((await draft(page)).projects[0].phases[0]).toMatchObject({end:'2028-01-06', progressNote:'Replanned'});
});

test.describe('mobile weekly review', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('the last task can be saved by touch and returns to the empty filter', async ({page}) => {
    await open(page);
    await tracking(page).tap();
    await filter(page, 'due').click();
    const due = row(page, 'Due today');
    expect((await due.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await due.tap();
    await page.locator('#weekly-report-progress').fill('100');
    await page.locator('[data-weekly-save]').tap();
    await expect(page.locator('#weekly-report-form')).toBeHidden();
    await expect(page.locator('.weekly-empty')).toHaveText('No matching tasks');
    await expect(filter(page, 'due')).toBeFocused();
    await expect(page.locator('#weekly-feedback')).toContainText('Reached the end');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await draft(page)).projects[0].phases[2].progress).toBe(100);
  });
});
