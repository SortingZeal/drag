import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickAction } from './global-actions.js';

const chineseSeed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));

async function openSettings(page) {
  await clickAction(page, 'settings');
  await expect(page.locator('#settings-dialog')).toBeVisible();
}

test('English first use, language changes and reload keep the authored JSON intact', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('language-test-seeded')) return;
    localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
    localStorage.setItem('language-test-seeded', '1');
  });
  await page.goto('/?lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  await expect(page.locator('#gantt svg')).toBeVisible();
  const model = await draft(page);
  expect(model.projects).toHaveLength(7);
  expect(model.projects.reduce((sum, project) => sum + project.phases.length, 0)).toBe(15);
  expect(model.title).toMatch(/[A-Za-z]/);
  expect(model.title).not.toMatch(/[\u3400-\u9fff]/);

  await openSettings(page);
  const language = page.locator('[data-pref="language"]');
  await expect(language).toHaveValue('en');
  await language.selectOption('zh-TW');
  await expect(page.locator('html')).toHaveAttribute('lang', /^zh/);
  expect(await draft(page)).toEqual(model);
  await page.locator('[data-pref="language"]').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  expect(await draft(page)).toEqual(model);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  await openSettings(page);
  await expect(page.locator('[data-pref="language"]')).toHaveValue('en');
  expect(await draft(page)).toEqual(model);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).not.toBeVisible();

  const pending = page.waitForEvent('download');
  await clickAction(page, 'save');
  const exported = JSON.parse(readFileSync(await (await pending).path(), 'utf8'));
  expect(exported).toEqual(model);
});

test('English UI preserves an existing Chinese project and its narrow header stays on one line', async ({ page }) => {
  await page.addInitScript(model => {
    localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.preferences', JSON.stringify({ version: 1, values: { language: 'en' } }));
    localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
  }, chineseSeed);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  expect(await draft(page)).toEqual(chineseSeed);

  await expect(page.locator('#app header')).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const header = await page.evaluate(() => {
      const top = document.querySelector('#app header');
      const title = document.querySelector('.workspace-heading strong');
      const menu = document.querySelector('#app header [data-action="global-menu"]');
      return {
        height: top.getBoundingClientRect().height,
        direction: getComputedStyle(top).flexDirection,
        titleWhiteSpace: getComputedStyle(title).whiteSpace,
        fits: title.getBoundingClientRect().right <= menu.getBoundingClientRect().left + 1,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(header.height).toBeLessThanOrEqual(54);
    expect(header.direction).toBe('row');
    expect(header.titleWhiteSpace).toBe('nowrap');
    expect(header.fits).toBe(true);
    expect(header.overflow).toBe(false);
  }
});
