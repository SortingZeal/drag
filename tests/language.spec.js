import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickAction } from './global-actions.js';

const chineseSeed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));

async function openSettings(page) {
  await clickAction(page, 'settings');
  await expect(page.locator('#settings-dialog')).toBeVisible();
}

for (const language of ['zh-TW', 'en']) {
  test(`fresh ${language} example visibly animates its half-complete task in both views`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' })));
    await page.goto(language === 'en' ? '/?lang=en' : '/');
    await expect(page.locator('#gantt svg.gantt')).toBeVisible();
    const model = await draft(page);
    const phases = model.projects.flatMap(project => project.phases);
    const halfComplete = phases.find(phase => phase.progress === 50);
    expect(halfComplete).toBeDefined();
    for (const mode of ['timeline', 'simple']) {
      await clickAction(page, mode);
      const task = mode === 'timeline'
        ? page.locator(`#gantt .bar-wrapper[data-id="${halfComplete.id}"]`)
        : page.locator(`.picture-canvas [data-phase-id="${halfComplete.id}"]`);
      const texture = task.locator('.bar-progress-texture');
      await expect(texture).toBeInViewport();
      const firstFrame = await texture.screenshot({ animations: 'allow' });
      await expect.poll(async () => firstFrame.equals(await texture.screenshot({ animations: 'allow' }))).toBe(false);
    }
    expect(await draft(page)).toEqual(model);
  });
}

test('English first use, language changes and reload keep the authored JSON intact', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('language-test-seeded')) return;
    localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
    localStorage.setItem('language-test-seeded', '1');
  });
  await page.goto('/?lang=en');
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  await expect(page.locator('#gantt svg.gantt')).toBeVisible();
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
  const existing = structuredClone(chineseSeed);
  for (const phase of existing.projects.flatMap(project => project.phases)) {
    delete phase.status;
    delete phase.progress;
  }
  await page.addInitScript(model => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft', JSON.stringify(model));
    localStorage.setItem('drag.preferences', JSON.stringify({ version: 1, values: { language: 'en' } }));
    localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
  }, existing);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', /^en/);
  expect(await draft(page)).toEqual(existing);
  await expect(page.locator('#gantt .bar-progress-texture')).toHaveCount(0);

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
