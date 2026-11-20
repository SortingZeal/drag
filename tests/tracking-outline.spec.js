import { test, expect } from './audit-fixture.js';

test('tracking stays with the task through rename, reorder and language switches', async ({ page }) => {
  const status = 'Waiting for review <QA> & sign-off';
  const phases = [
    { label: 'Draft review', status, progress: 0 },
    { label: 'Pilot', progress: 45 },
    { label: 'Release' },
  ].map((phase, index) => ({
    id: 'tracked-' + index, start: '2028-01-01', end: '2028-02-01', ...phase,
  }));
  await page.addInitScript(phases => {
    localStorage.setItem('drag.draft', JSON.stringify({ title: 'Schedule', projects: [{ id: 'launch', name: 'Launch', phases }] }));
    localStorage.setItem('drag.uiSize', 'small');
  }, phases);
  await page.goto('/?lang=en');
  const row = name => page.getByRole('treeitem', { name, exact: true });
  const item = row('Draft review');
  await expect(item).toHaveAccessibleDescription('Stage status ' + status + ' Progress 0%');
  await expect(item.locator('.outline-status')).toBeVisible();
  await expect(item.locator('.outline-progress')).toBeVisible();
  await expect(row('Pilot')).toHaveAccessibleDescription('Progress 45%');
  await expect(row('Release').locator('.outline-tracking')).toHaveCount(0);

  await item.press('F2');
  const input = page.getByRole('textbox', { name: 'Rename' });
  await expect(input).toHaveValue('Draft review');
  await input.fill('Ready for release');
  await input.press('Enter');
  const renamed = row('Ready for release');
  await renamed.press('Alt+ArrowDown');
  await expect(renamed).toHaveAttribute('data-select-f', '0:1');
  await expect(renamed).toHaveAccessibleDescription('Stage status ' + status + ' Progress 0%');
  await page.locator('#workspace-language').selectOption('zh-TW');
  await expect(renamed).toHaveAccessibleDescription('階段狀態 ' + status + ' 完成進度 0%');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(renamed.locator('.outline-progress')).toBeVisible();
  await expect.poll(() => renamed.evaluate(el => {
    const row = el.getBoundingClientRect();
    return [...el.querySelectorAll('.tree-label,.outline-status,.outline-progress')].filter(node => {
      const box = node.getBoundingClientRect();
      return box.width <= 0 || box.left < row.left || box.right > row.right + 1;
    }).map(node => node.className);
  })).toEqual([]);
});
