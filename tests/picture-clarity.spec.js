import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

for (const mode of ['simple']) for (const dpr of [1, 2]) {
  test(`${mode} keeps native vector text sharp at DPR ${dpr} after fitting, enlarging and panning`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(model => {
        localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' }));
        localStorage.setItem('drag.draft', JSON.stringify(model));
      }, seed);
      await page.goto('/');
      await page.locator(`[data-action="${mode}"]`).click();
      const control = name => page.locator(`[data-picture-action="${name}"]`);
      await settle(page);
      const geometry = () => page.evaluate(() => {
        const svg = document.querySelector('.picture-canvas > svg');
        const viewport = document.querySelector('.picture-viewport').getBoundingClientRect();
        const image = svg.getBoundingClientRect();
        const texts = [...svg.querySelectorAll('text')].map(node => {
          const r = node.getBoundingClientRect(), matrix = node.getScreenCTM();
          return { text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize), screenFont: parseFloat(getComputedStyle(node).fontSize) * matrix.a,
            clip: { x: r.x, y: r.y, width: r.width, height: r.height } };
        });
        return { width: image.width, height: image.height, designWidth: svg.viewBox.baseVal.width, designHeight: svg.viewBox.baseVal.height,
          viewport: { width: viewport.width, height: viewport.height }, scale: svg.getScreenCTM().a,
          visible: texts.filter(({ clip: r, font }) => font >= 12 && r.width > 10 && r.x > viewport.x + 4 && r.y > viewport.y + 4 && r.x + r.width < viewport.right - 4 && r.y + r.height < viewport.bottom - 80),
          rasterNodes: svg.querySelectorAll('image, foreignObject, canvas').length,
          transforms: [svg.parentElement, svg.parentElement.parentElement].map(node => getComputedStyle(node).transform) };
      });
      const initial = await geometry();
      expect(initial.width).toBeLessThanOrEqual(initial.viewport.width);
      expect(initial.height).toBeLessThanOrEqual(initial.viewport.height);
      await control('actual').click();
      await settle(page);
      const native = await geometry();
      expect(native.scale).toBeCloseTo(1, 4);
      expect(native.width).toBeCloseTo(native.designWidth, 1);
      expect(native.height).toBeCloseTo(native.designHeight, 1);
      expect(native.rasterNodes).toBe(0);
      expect(native.transforms).toEqual(['none', 'none']);
      expect(native.visible.length).toBeGreaterThan(0);
      for (const text of native.visible) expect(text.screenFont).toBeCloseTo(text.font, 3);
      const clip = native.visible[0].clip;
      const before = await page.screenshot({ clip });
      await control('reset').click();
      await settle(page);
      const fitted = await geometry();
      expect(fitted.width).toBeLessThanOrEqual(fitted.viewport.width + 2);
      expect(fitted.height).toBeLessThanOrEqual(fitted.viewport.height + 2);
      expect(parseFloat(await page.locator('[data-picture-zoom]').innerText())).toBeCloseTo(fitted.scale * 100, 0);
      await control('zoom-menu').click();
      await page.locator('[data-picture-zoom-level="8"]').click();
      await expect(control('zoom-in')).toBeDisabled();
      await settle(page);
      expect((await geometry()).scale).toBeCloseTo(8, 3);
      const view = await page.locator('.picture-viewport').boundingBox();
      await page.mouse.move(view.x + view.width / 2, view.y + 50);
      await page.keyboard.down('Shift');
      await page.mouse.down();
      await page.mouse.move(view.x + view.width / 2 + 93.3, view.y + 73.7, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await control('actual').click();
      await settle(page);
      const restored = await geometry();
      expect(restored.scale).toBeCloseTo(1, 4);
      expect(restored.visible[0].clip).toEqual(clip);
      const after = await page.screenshot({ clip });
      const pixels = await page.evaluate(async ({ before, after }) => {
        const decode = async data => {
          const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
          return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
        };
        const a = await decode(before), b = await decode(after);
        let error = 0, changed = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          let max = 0;
          for (let c = 0; c < 4; c++) { const diff = Math.abs(a.data[i + c] - b.data[i + c]); error += diff; max = Math.max(max, diff); }
          if (max > 8) changed++;
        }
        return { sameDimensions: a.width === b.width && a.height === b.height, meanError: error / a.data.length, changedFraction: changed / (a.width * a.height) };
      }, { before: before.toString('base64'), after: after.toString('base64') });
      await info.attach('native-before', { body: before, contentType: 'image/png' });
      await info.attach('native-restored', { body: after, contentType: 'image/png' });
      await info.attach('native-pixel-comparison', { body: JSON.stringify(pixels), contentType: 'application/json' });
      expect(pixels.sameDimensions).toBe(true);
      expect(pixels.meanError).toBeLessThan(0.5);
      expect(pixels.changedFraction).toBeLessThan(0.01);
      await page.screenshot({ path: info.outputPath(`${mode}-native-dpr-${dpr}.png`) });
      await info.attach('vector-preview-measurements', { body: JSON.stringify({ native, fitted, restored }), contentType: 'application/json' });
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(seed);
      await expect(page.locator('[data-action="undo"]')).toBeDisabled();
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
