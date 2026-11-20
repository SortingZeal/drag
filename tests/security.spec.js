import { globalClick, clickAction } from './global-actions.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const template = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const templateTaskCount = template.projects.reduce((total, project) => total + project.phases.length, 0);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
    localStorage.setItem('drag.preferences', JSON.stringify({ version: 1, values: { view: 'Year' } }));
  });
  await page.goto('/');
  await expect(page.locator('#gantt .bar-wrapper')).toHaveCount(templateTaskCount);
});

test('imported SVG markup stays visible text in the timeline and after reload', async ({ page }) => {
  const model = copy(template);
  const malicious = '<image href="data:image/png;base64,eA==" onerror="window.__auditMarker=1"></image>';
  model.projects[0].phases[0].label = malicious;
  model.projects[0].phases[0].icon = malicious;
  model.projects[0].phases[1].label = 'A & <B> 🚀';
  await page.locator('#import').setInputFiles({ name: 'security-example.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  const label = page.locator(`.bar-wrapper[data-id="${model.projects[0].phases[0].id}"] .bar-label`);
  await expect(label).toHaveText(`${malicious} ${malicious}`);
  await expect(page.locator('.bar-label image')).toHaveCount(0);
  await expect(page.locator(`.bar-wrapper[data-id="${model.projects[0].phases[1].id}"] .bar-label`)).toHaveText('A & <B> 🚀');
  expect(await page.evaluate(() => window.__auditMarker || 0)).toBe(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  expect(saved.projects[0].phases[0].label).toBe(malicious);
  expect(saved.projects[0].phases[0].icon).toBe(malicious);
  await page.reload();
  await expect(label).toHaveText(`${malicious} ${malicious}`);
  await expect(page.locator('.bar-label image')).toHaveCount(0);
  expect(await page.evaluate(() => window.__auditMarker || 0)).toBe(0);
});

test('oversized project lists are rejected before they replace the active document', async ({ page }) => {
  const model = { projects: Array.from({ length: 2001 }, () => ({ phases: [] })) };
  const dialog = page.waitForEvent('dialog');
  await page.locator('#import').setInputFiles({ name: 'too-many-projects.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  const alert = await dialog;
  expect(alert.message()).toContain('專案數量不可超過 2000 個');
  await alert.accept();
  await expect(page.locator('#document-select option')).toHaveCount(1);
  await expect(page.locator('#gantt .bar-wrapper')).toHaveCount(templateTaskCount);
});

test('existing over-budget task files remain openable and exportable', async ({ page }) => {
  test.setTimeout(60_000);
  const model = copy(template);
  model.projects = [{ ...model.projects[0], phases: Array.from({ length: 2001 }, (_, index) => ({
    id: `large-phase-${index}`, label: `任務 ${index}`, start: '2026-10-01', end: '2026-10-02', locks: { start: true },
  })) }];
  await page.locator('#import').setInputFiles({ name: 'large-existing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('#gantt .empty')).toContainText('任務過多');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft'))?.projects?.[0]?.phases?.length)).toBe(2001);
  await page.reload();
  await expect(page.locator('#gantt .empty')).toContainText('任務過多');
  const pending = page.waitForEvent('download');
  await globalClick(page,'save');
  const file = await pending;
  const exported = JSON.parse((await readFile(await file.path())).toString());
  expect(exported).toEqual(model);
});

test('distant one-day tasks leave the imported file editable without rendering an excessive timeline', async ({ page }) => {
  const model = copy(template);
  model.projects[0].phases[0].start = model.projects[0].phases[0].end = '0100-01-01';
  model.projects[0].phases[1].start = model.projects[0].phases[1].end = '9999-12-31';
  await page.locator('#import').setInputFiles({ name: 'wide-range.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('#gantt .empty')).toContainText('時間軸日期範圍過大');
  await expect(page.locator('#document-select option')).toHaveCount(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  expect(saved.projects[0].phases[0].start).toBe('0100-01-01');
  expect(saved.projects[0].phases[1].end).toBe('9999-12-31');
  await page.reload();
  await expect(page.locator('#gantt .empty')).toContainText('時間軸日期範圍過大');
  await page.locator('[data-select-f="0:0"]').click();
  await expect(page.locator('#editor')).toBeVisible();
});

test('legacy years below 0100 cannot bypass the timeline budget', async ({ page }) => {
  const model = copy(template);
  model.projects[0].phases[0].start = model.projects[0].phases[0].end = '0099-01-01';
  model.projects[0].phases[1].start = model.projects[0].phases[1].end = '0100-01-01';
  await page.locator('#import').setInputFiles({ name: 'early-year.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('#gantt .empty')).toContainText('0100 年以前');
  await page.reload();
  await expect(page.locator('#gantt .empty')).toContainText('0100 年以前');
});

test('Today and manual extension keep an existing chart when the next range is too large', async ({ page }) => {
  // A near-century chart can take longer to render than an ordinary interaction.
  test.setTimeout(120_000);
  const model = copy(template);
  model.projects = [{ ...model.projects[0], phases: model.projects[0].phases.slice(0, 2) }];
  model.projects[0].phases[0].start = model.projects[0].phases[0].end = '1926-07-19';
  model.projects[0].phases[1].start = model.projects[0].phases[1].end = '2024-12-31';
  await page.locator('#import').setInputFiles({ name: 'near-limit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect(page.locator('#document-select option')).toHaveCount(2, { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft'))?.projects?.[0]?.phases?.[0]?.start)).toBe('1926-07-19');
  await expect(page.locator('#view')).toHaveValue('Year');
  await expect(page.locator('#gantt .bar-wrapper')).toHaveCount(2);
  await expect(page.locator('#gantt svg')).toBeVisible();
  await page.clock.setFixedTime(new Date('2030-10-30T12:00:00+08:00'));
  const originalRight = await page.evaluate(() => localStorage.getItem('drag.rightPaddingMonths'));
  const blocked = async selector => {
    const dialogHandled = page.waitForEvent('dialog', { timeoutMs: 10000 }).then(async dialog => {
      expect(dialog.message()).toContain('範圍過大');
      await dialog.accept();
    });
    await Promise.all([dialogHandled, page.locator(selector).click()]);
  };
  await blocked('[data-action="today"]');
  await expect(page.locator('#gantt svg')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('drag.rightPaddingMonths'))).toBe(originalRight);
  await clickAction(page,'expand-right');
  await clickAction(page,'expand-right');
  const allowedRight = await page.evaluate(() => localStorage.getItem('drag.rightPaddingMonths'));
  await blocked('[data-action="expand-right"]');
  await expect(page.locator('#gantt svg')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('drag.rightPaddingMonths'))).toBe(allowedRight);
});
