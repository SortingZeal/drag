import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(process.env.DRAG_JITTER_JSON || new URL('../public/roadmap.json', import.meta.url), 'utf8'));

const sample = page => page.evaluate(() => {
  const viewport = document.querySelector('.picture-viewport');
  const image = document.querySelector('.picture-canvas > svg').getBoundingClientRect();
  return {
    x: image.x, y: image.y, width: image.width, height: image.height,
    left: viewport.scrollLeft, top: viewport.scrollTop,
  };
});

const stable = (before, after, tolerance = 0.6) => {
  for (const key of ['x', 'y', 'width', 'height', 'left', 'top']) {
    expect(Math.abs(after[key] - before[key]), key).toBeLessThanOrEqual(tolerance);
  }
};

async function recordFrames(page, selector, event) {
  await page.evaluate(({ selector, event }) => {
    const node = document.querySelector(selector);
    window.pictureJitterFrames = [];
    node.addEventListener(event, () => {
      let count = 0;
      const tick = () => {
        const viewport = document.querySelector('.picture-viewport');
        const image = document.querySelector('.picture-canvas > svg').getBoundingClientRect();
        window.pictureJitterFrames.push({ x: image.x, y: image.y, width: image.width, height: image.height, left: viewport.scrollLeft, top: viewport.scrollTop });
        if (++count < 14) requestAnimationFrame(tick);
      };
      tick();
    }, { once: true, capture: true });
  }, { selector, event });
}

async function frames(page) {
  await page.waitForFunction(() => window.pictureJitterFrames?.length === 14);
  return page.evaluate(() => window.pictureJitterFrames);
}

async function verify(page, mode) {
    await page.addInitScript(model => {
      localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
      localStorage.setItem('drag.draft', JSON.stringify(model));
    }, seed);
    await page.goto('/');
    await page.locator(`[data-action="${mode}"]`).click();
    await page.evaluate(() => document.fonts.ready);
    const viewport = page.locator('.picture-viewport');
    const point = async () => {
      const box = await viewport.boundingBox();
      return { x: box.x + box.width / 2, y: box.y + Math.min(60, box.height / 2) };
    };
    for (const target of ['actual', 'reset', 'zoom-in', 'zoom-out', '200', '800', '10']) {
      const selector = Number.isNaN(Number(target))
        ? `[data-picture-action="${target}"]`
        : `[data-picture-zoom-level="${Number(target) / 100}"]`;
      if (!Number.isNaN(Number(target))) await page.locator('[data-picture-action="zoom-menu"]').click();
      await recordFrames(page, selector, 'click');
      await page.locator(selector).click();
      const zoomFrames = await frames(page);
      for (const frame of zoomFrames.slice(2)) stable(zoomFrames[1], frame, 1);
      const before = await sample(page);
      await recordFrames(page, '.picture-viewport', 'pointerdown');
      const { x, y } = await point();
      await page.mouse.click(x, y);
      const clickFrames = await frames(page);
      for (const frame of clickFrames) stable(before, frame, 1);
      const after = await sample(page);
      stable(before, after);
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(seed);
}

for (const mode of ['simple']) {
  test(`${mode} image stays still on a click and after zoom settles at DPR 1`, async ({ page }) => {
    await verify(page, mode);
  });

  test(`${mode} image stays still on a click and after zoom settles at DPR 2`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    try { await verify(await context.newPage(), mode); }
    finally { await context.close(); }
  });
}
