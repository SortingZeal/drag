import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('390px touch layout can create, edit, reorder and download a project', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    await context.addInitScript(() => localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' })));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    await expect(page.locator('#gantt svg.gantt')).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const header = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const top = rect('#app header');
        const brand = rect('#app header .brand');
        const title = rect('#app header .workspace-heading');
        const menu = rect('#app header [data-action="global-menu"]');
        return {
          height: top.height,
          centers: [brand, title, menu].map(box => box.y + box.height / 2),
          titleFits: title.right <= menu.left + 1,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      expect(header.height).toBeLessThanOrEqual(54);
      expect(Math.max(...header.centers) - Math.min(...header.centers)).toBeLessThanOrEqual(2);
      expect(header.titleFits).toBe(true);
      expect(header.overflow).toBe(false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const sidebar = box('.project-sidebar'), preview = box('.timeline-shell'), editor = box('.bottom');
      return { sidebar: { width: sidebar.width, bottom: sidebar.bottom }, preview: { width: preview.width, top: preview.top, bottom: preview.bottom }, editor: { width: editor.width, top: editor.top, bottom: editor.bottom }, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.sidebar.width).toBeGreaterThan(380);
    expect(layout.sidebar.bottom).toBeLessThanOrEqual(layout.preview.top + 1);
    await expect(page.locator('.bottom')).toBeHidden();
    await page.locator('[data-select-f="0:0"]').tap();
    const drawer=await page.locator('.bottom').boundingBox();
    expect(drawer.width).toBeGreaterThan(380);
    expect(drawer.y).toBeCloseTo(layout.preview.top,0);
    expect(drawer.y+drawer.height).toBeLessThanOrEqual(layout.height+1);
    await page.locator('[data-outline-close]').tap();

    await page.locator('.project-sidebar [data-action="newproject"]').tap();
    const project = page.locator('#editor [data-field="name"]');
    await expect(project).toBeVisible();
    await project.fill('手機專案');
    await page.locator('#editor [data-field="icon"]').tap();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects.at(-1).name)).toBe('手機專案');

    await page.locator('#editor [data-action="newphase"]').tap();
    const task = page.locator('#editor [data-field="label"]');
    await expect(task).toBeVisible();
    await task.fill('手機任務');
    await page.locator('#editor [data-field="status"]').tap();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects.at(-1).phases[0].label)).toBe('手機任務');

    const projectRow = page.locator('.project').last();
    await expect(projectRow.locator('.tree-item:not(.phase) .mobile-sort')).toBeVisible();
    await projectRow.locator('.tree-item:not(.phase) .mobile-sort button[aria-label^="上移"]').tap();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects.at(-2).name)).toBe('手機專案');

    await page.locator('header [data-action="undo"]').tap();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects.at(-1).name)).toBe('手機專案');
    await page.locator('header [data-action="redo"]').tap();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects.at(-2).name)).toBe('手機專案');
    await page.locator('header [data-action="export-menu"]').tap();
    const imageMenu = page.locator('#image-export-menu');
    await expect(imageMenu).toBeInViewport();
    const image = page.waitForEvent('download');
    await imageMenu.locator('[data-action="svg"]').tap();
    expect((await image).suggestedFilename()).toMatch(/\.svg$/i);
    await expect(imageMenu).toBeHidden();

    const pending = page.waitForEvent('download');
    await page.locator('[data-action="global-menu"]').tap();
    await page.locator('#global-action-menu [data-action="save"]').tap();
    const download = await pending;
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(saved.projects.at(-2).name).toBe('手機專案');
    expect(saved.projects.at(-2).phases[0].label).toBe('手機任務');

    await page.reload();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects.at(-2).phases[0].label)).toBe('手機任務');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('blocked localStorage shows a recoverable startup message', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('無法使用瀏覽器儲存空間');
  await expect(page.getByRole('button', { name: '重新整理' })).toBeVisible();
});

test('blocked IndexedDB shows a recoverable startup message', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('無法使用瀏覽器儲存空間');
  await expect(page.getByRole('button', { name: '重新整理' })).toBeVisible();
});
