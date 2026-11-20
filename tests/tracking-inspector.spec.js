import { test, expect } from './audit-fixture.js';
import { globalClick } from './global-actions.js';

const phase = (id, tracking = {}) => ({
  id, label: id, start: '2028-01-01', end: '2028-01-10', locks: {}, ...tracking,
});
const project = (id, phases) => ({ id, name: id, color: '#234567', locks: {}, phases });
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const field = (page, name) => page.locator(`#editor [data-field="${name}"]`);

async function openModel(page, projects) {
  const model = { title: 'Tracking', projects };
  await page.addInitScript(value => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft', JSON.stringify(value));
  }, model);
  await page.goto('/');
  return model;
}

async function enter(page, name, value) {
  const input = field(page, name);
  await input.fill(value);
  await input.press('Tab');
}

test('project completion reports the mean of reported phases and keeps unknown values out of the denominator', async ({ page }) => {
  const projects = [
    project('design', [phase('prepare', { progress: 0 }), phase('build', { progress: '64.5' }),
      phase('review', { progress: '' }), phase('deliver', { status: '已完成' })]),
    project('later', [phase('plan')]),
  ];
  const model = await openModel(page, projects);
  await page.locator('[data-select-p="0"] .tree-label').click();
  const summary = page.locator('.project-progress-summary');
  await expect(summary.getByRole('progressbar', { name: '已回報任務的平均完成率' })).toHaveAttribute('value', '32.25');
  await expect(summary.locator('strong')).toHaveText('32.25%');
  await expect(summary.locator('small')).toHaveText('已回報 2/4 項任務');
  await page.locator('[data-select-p="1"] .tree-label').click();
  await expect(summary).toHaveCount(0);
  expect(await draft(page)).toEqual(model);
});

test('phase status suggestions follow the interface language while custom text and completion remain independent', async ({ page }) => {
  const model = await openModel(page, [project('release', [phase('ship')])]);
  const task = page.locator('[data-select-f="0:0"] .tree-label');
  await task.click();
  const options = () => page.locator('#phase-status-options option').evaluateAll(nodes => nodes.map(node => node.value));
  await expect(field(page, 'status')).toHaveAttribute('list', 'phase-status-options');
  expect(await options()).toEqual(['未開始', '進行中', '受阻', '已完成']);
  await enter(page, 'status', '已完成');
  await expect(field(page, 'progress')).toHaveValue('');
  await enter(page, 'progress', '0');
  await expect(field(page, 'status')).toHaveValue('已完成');
  await enter(page, 'status', 'Waiting for A & B');
  await enter(page, 'progress', '37.5');
  await page.locator('#workspace-language').selectOption('en');
  await expect(field(page, 'status')).toHaveAccessibleName('Phase status');
  expect(await options()).toEqual(['Not started', 'In progress', 'Blocked', 'Completed']);
  await expect(field(page, 'status')).toHaveValue('Waiting for A & B');
  await expect(field(page, 'progress')).toHaveValue('37.5');
  await enter(page, 'progress', '');
  await page.locator('[data-select-p="0"] .tree-label').click();
  await expect(page.locator('.project-progress-summary')).toHaveCount(0);
  await globalClick(page, 'undo');
  await expect(page.getByRole('progressbar', { name: 'Average of reported tasks' })).toHaveAttribute('value', '37.5');
  await page.reload();
  await task.click();
  await expect(field(page, 'status')).toHaveValue('Waiting for A & B');
  await expect(field(page, 'progress')).toHaveValue('37.5');
  expect((await draft(page)).projects[0].phases[0]).toEqual({
    ...model.projects[0].phases[0], progress: 37.5, status: 'Waiting for A & B', locks: { progress: true, status: true },
  });
});
