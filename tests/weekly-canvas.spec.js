import {test, expect} from './audit-fixture.js';

const model = {
  title: 'Delivery review',
  presentation: {start: '2026-01-01', end: '2026-12-31'},
  projects: Array.from({length: 24}, (_, index) => ({
    id: 'p' + index, name: 'Project ' + index, color: '#50748a', locks: {},
    phases: [{
      id: 'task-' + index, label: 'Deliver ' + index,
      start: index === 0 ? '2025-12-10' : '2026-10-10',
      end: index === 0 ? '2025-12-12' : '2026-10-12',
      progress: 30, locks: {},
    }],
  })),
};

async function mount(page, mode) {
  await page.setViewportSize({width: 1100, height: 650});
  await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
  await page.addInitScript(({model, mode}) => {
    localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.preferences', JSON.stringify({version: 1, values: {startupMode: mode}}));
  }, {model, mode});
  await page.goto('/');
  await page.locator(`[data-action="${mode}"]`).click();
}

for (const mode of ['timeline', 'simple']) {
  test(`tracking a task leaves the selected ${mode} task and schedule unchanged`, async ({page}) => {
    await mount(page, mode);
    const outlineTask = page.locator('#tree [data-select-f="1:0"]');
    if (mode === 'simple') {
      await page.locator('.picture-canvas [data-phase-id="task-1"]').press('Enter');
      await expect(page.locator('#editor [data-field=label]')).toHaveValue('Deliver 1');
    } else {
      await outlineTask.locator('.tree-label').click();
      await expect(outlineTask).toHaveClass(/selected/);
    }
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
    await page.locator('[data-action="tracking"]').click();
    await expect(page.locator('#tracking-page')).toBeVisible();
    await expect(page.locator('#tree')).toBeHidden();
    await page.locator('[data-weekly-project="23"][data-weekly-phase="0"]').click();
    await expect(page.locator('#weekly-report-progress')).toHaveValue('30');
    await page.locator('#weekly-report-note').fill('Review with delivery lead');
    await page.locator(`[data-action="${mode}"]`).click();
    if (mode === 'timeline') await expect(outlineTask).toHaveClass(/selected/);
    else await expect(page.locator('#tree')).toHaveCount(0);
    const bar = mode === 'simple' ? '[data-phase-id="task-1"] [data-role="phase-bar"]' : '[data-id="task-1"] .bar';
    await expect(page.locator(bar)).toBeAttached();
    if (mode === 'simple') await expect(page.locator('.picture-canvas > svg')).toHaveAttribute('data-start', model.presentation.start);
    await page.locator('[data-action="tracking"]').click();
    await page.locator('[data-weekly-project="23"][data-weekly-phase="0"]').click();
    await expect(page.locator('#weekly-report-note')).toHaveValue('Review with delivery lead');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(original);
  });
}
