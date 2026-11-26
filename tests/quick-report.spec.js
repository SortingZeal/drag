import { test, expect } from './audit-fixture.js';

const oldTask = {
  id: 't1', label: 'Prototype', start: '2024-03-01', end: '2024-03-05',
  status: 'Review', progress: '020.50', progressNote: 'Initial note', locks: {},
  metadata: { imported: true },
};
const model = {
  title: 'Progress review', projects: [{
    id: 'p', name: 'Product', locks: {}, color: '#64748b', phases: [
      oldTask,
      { id: 't2', label: 'Test', start: '2024-03-01', end: '2024-03-06', progress: 0, locks: {} },
    ],
  }],
};
const row = (page, index) => page.locator(`[data-weekly-project="0"][data-weekly-phase="${index}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
async function openReport(page) {
  await page.addInitScript(seed => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft', JSON.stringify(seed));
  }, model);
  await page.goto('/');
  await page.locator('[data-action="tracking"]').click();
  await page.locator('[data-weekly-filter="overdue"]').click();
  await row(page, 0).click();
}

test('a quick report stays together across task and language switches and can be discarded', async ({ page }) => {
  await openReport(page);
  const status = page.locator('#weekly-report-status'), progress = page.locator('#weekly-report-progress');
  const note = page.locator('#weekly-report-note');
  await status.fill('Blocked');
  await progress.fill('101');
  await note.fill('Waiting for a decision');
  await page.locator('[data-weekly-save]').click();
  await expect(progress).toBeFocused();
  expect(await progress.evaluate(input => input.validity.customError)).toBe(true);
  expect(await draft(page)).toEqual(model);
  await row(page, 1).click();
  await expect(note).toHaveValue('');
  await row(page, 0).click();
  await page.locator('#workspace-language').selectOption('en');
  await expect(note).toHaveAccessibleName('Progress note (optional)');
  await expect(status).toHaveValue('Blocked');
  await expect(progress).toHaveValue('101');
  await expect(note).toHaveValue('Waiting for a decision');
  await page.getByRole('button', { name: 'Discard edits' }).click();
  await expect(progress).toHaveValue('20.5');
  await expect(note).toHaveValue(oldTask.progressNote);
  expect(await draft(page)).toEqual(model);
});

test('a failed quick report can be retried without changing untouched legacy values', async ({ page }) => {
  await openReport(page);
  const note = page.locator('#weekly-report-note');
  const value = 'Use <script> as text & keep\nthe second line.';
  await note.fill(value);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, body) {
      if (key === 'drag.documentDraft') {
        Storage.prototype.setItem = original;
        throw new DOMException('Full', 'QuotaExceededError');
      }
      return original.call(this, key, body);
    };
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-weekly-save]').click();
  await expect(row(page, 0)).toHaveAttribute('aria-current', 'true');
  await expect(note).toHaveValue(value);
  expect(await draft(page)).toEqual(model);
  await page.locator('[data-weekly-save]').click();
  await expect(row(page, 1)).toHaveAttribute('aria-current', 'true');
  const result = (await draft(page)).projects[0].phases[0];
  expect(result).toEqual({ ...oldTask, progressNote: value, locks: { progressNote: true } });
  await page.reload();
  await page.locator('[data-action="timeline"]').click();
  await page.locator('[data-select-f="0:0"] .tree-label').click();
  await expect(page.locator('[data-field="progressNote"]')).toHaveValue(value);
});
