import { clickAction, documentItems, currentDocument, chooseDocument } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const modes = ['timeline', 'simple'];

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { source: 'controls-consolidation', nested: ['保留未知資料', { value: 51 }] };
  model.locks = { title: true };
  model.presentation = { milestoneShape: 'star', locks: { milestoneShape: true }, metadata: { retain: 'presentation' } };
  model.projects.forEach((project, pi) => {
    project.id = `controls-project-${pi}`;
    project.locks = { color: true, customProperty: true };
    project.metadata = { retain: [pi, { approved: true }] };
    project.phases.forEach((phase, fi) => {
      phase.id = `controls-phase-${pi}-${fi}`;
      phase.locks = { start: true, end: true, customProperty: true };
      phase.metadata = { retain: [pi, fi, { literal: '原始資料' }] };
    });
  });
  model.projects[0].fontSize = 28;
  model.projects[0].phases[0].fontSize = 18;
  return model;
}

async function mount(page) {
  const model = fixture();
  await page.addInitScript(value => {
    if (!localStorage.getItem('controls.seeded')) {
      localStorage.setItem('drag.draft', JSON.stringify(value));
      localStorage.setItem('drag.leftPaddingMonths', '3');
      localStorage.setItem('drag.rightPaddingMonths', '3');
      localStorage.setItem('drag.paneHeight', '65');
      localStorage.setItem('controls.seeded', 'true');
    }
  }, model);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(model);
  return model;
}

async function showMode(page, mode) {
  await clickAction(page, mode);
  if (mode === 'timeline') await expect(page.locator('#gantt svg.gantt')).toBeVisible();
  else await expect(page.locator('.infographic-preview svg')).toBeVisible();
  await expect(action(page, 'svg')).toBeEnabled();
  await expect(action(page, 'png')).toBeEnabled();
}

async function download(page, name) {
  const pending = page.waitForEvent('download');
  await clickAction(page, name);
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return file;
}

async function changeLabel(page, value) {
  if (await page.locator('main[data-view=simple]').count()) await page.locator('.picture-canvas [data-phase-id="controls-phase-0-0"]').press('Enter');
  else await page.locator('[data-select-f="0:0"] .tree-label').click();
  const input = page.locator('#editor [data-field="label"]');
  await input.fill(value);
  await input.press('Tab');await input.blur();
  await expect.poll(async () => (await draft(page)).projects[0].phases[0].label).toBe(value);
}

async function panelBounds(page) {
  return page.evaluate(() => ['header', '.toolbar', 'main', '.preview', '.bottom'].map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
    return { selector, x, y, width, height };
  }));
}

test.beforeEach(async ({ page }, info) => {
  info.controlsPageErrors = [];
  page.on('pageerror', error => info.controlsPageErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.controlsPageErrors).toEqual([]); });

test('each view exposes history in the toolbar and the three image formats in a dedicated menu', async ({ page }) => {
  const model = await mount(page);
  for (const mode of modes) {
    await showMode(page, mode);
    await expect(page.locator('#global-action-menu')).toBeHidden();
    await action(page, 'global-menu').click();
    await expect(page.locator('#global-action-menu')).toBeVisible();
    await expect(action(page, 'save')).toHaveText('儲存專案');
    await expect(action(page, 'import')).toHaveText('開啟專案');
    await expect(action(page, 'undo')).toHaveAccessibleName('復原');
    await expect(action(page, 'redo')).toHaveAccessibleName('重做');
    await expect(action(page, 'customize-toolbar')).toHaveText('自訂工具列');
    await expect(page.locator('#global-action-menu [data-action=newproject]')).toHaveCount(mode==='simple'?1:0);
    await expect(page.locator('#global-action-menu [data-action]')).toHaveCount(mode==='simple'?5:4);
    await action(page, 'export-menu').click();
    await expect(page.locator('#global-action-menu')).toBeHidden();
    await expect(page.locator('#image-export-menu')).toBeVisible();
    for (const name of ['svg', 'png', 'gif']) {
      await expect(action(page, name)).toHaveCount(1);
      await expect(page.locator(`#image-export-menu [data-action="${name}"]`)).toBeVisible();
    }
    await expect(action(page, 'svg')).toHaveText('匯出 SVG');
    await expect(action(page, 'png')).toHaveAttribute('aria-label',mode === 'timeline' ? '匯出 PNG' : '匯出 PNG · 4K');
    await expect(page.locator('.report-download,[data-action="infographic-svg"],[data-action="infographic-png"]')).toHaveCount(0);
    await expect(page.locator('.hint,.save-state,.action-status,header button[title]:not([aria-label])')).toHaveCount(0);
    await expect(page.locator('header .view-settings')).toHaveCount(1);
    await expect(page.locator('#global-action-menu details')).toHaveCount(0);
    await expect(action(page, 'undo')).toBeDisabled();
    await expect(action(page, 'redo')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#image-export-menu')).toBeHidden();
    await expect(action(page, 'export-menu')).toBeFocused();
    expect(await draft(page)).toEqual(model);
  }
});

test('save and open preserve complete independent files and per-file history', async ({ page }) => {
  const original = await mount(page);
  await changeLabel(page, '整併後仍保留全部手動資料');
  const savedModel = await draft(page);
  expect(savedModel.projects[0].phases[0].locks).toEqual({ ...original.projects[0].phases[0].locks, label: true });
  await showMode(page, 'simple');
  const saved = await download(page, 'save');
  expect(saved.suggestedFilename()).toBe((await currentDocument(page).textContent()) + '.json');
  const bytes = await readFile(await saved.path());
  expect(JSON.parse(bytes.toString('utf8'))).toEqual(savedModel);

  await changeLabel(page, '開啟檔案前的另一個修改');
  const beforeImport = await draft(page);
  const pending = page.waitForEvent('filechooser');
  await clickAction(page, 'import');
  await (await pending).setFiles({ name: saved.suggestedFilename(), mimeType: 'application/json', buffer: bytes });
  await expect.poll(() => draft(page)).toEqual(savedModel);
  await expect(action(page, 'undo')).toBeDisabled();
  await expect(documentItems(page)).toHaveCount(2);
  const originalId = await documentItems(page).first().getAttribute('data-document-id');
  await chooseDocument(page,originalId);
  await expect.poll(() => draft(page)).toEqual(beforeImport);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(savedModel);
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(beforeImport);
  await clickAction(page, 'undo');
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(original);
  await expect(action(page, 'undo')).toBeDisabled();
  await page.reload();
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(original);
});

test('one-click history works with both menus closed and the image menu supports keyboard navigation', async ({page}) => {
  const original = await mount(page);
  await changeLabel(page, 'Updated task');
  const updated = await draft(page);
  await expect(action(page, 'undo')).toBeVisible();
  await action(page, 'undo').click();
  expect(await draft(page)).toEqual(original);
  await expect(action(page, 'redo')).toBeVisible();
  await action(page, 'redo').click();
  expect(await draft(page)).toEqual(updated);
  await expect(page.locator('#global-action-menu')).toBeHidden();
  const trigger = action(page, 'export-menu');
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(action(page, 'svg')).toBeFocused();
  await action(page, 'svg').press('ArrowDown');
  await expect(action(page, 'png')).toBeFocused();
  await action(page, 'png').press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('#image-export-menu')).toBeHidden();
});

for (const mode of modes) {
  test(`${mode} header exports usable complete SVG and PNG while preserving all project data`, async ({ page }, info) => {
    const model = await mount(page);
    await showMode(page, mode);
    const basename = mode === 'timeline' ? 'drag-roadmap' : mode === 'simple' ? 'drag-simple' : 'drag-infographic';
    const vector = await download(page, 'svg');
    expect(vector.suggestedFilename()).toBe(`${basename}.svg`);
    await vector.saveAs(info.outputPath(`${mode}.svg`));
    const xml = await readFile(await vector.path(), 'utf8');
    const content = await page.evaluate(body => {
      const document = new DOMParser().parseFromString(body, 'image/svg+xml');
      return {
        errors: document.querySelectorAll('parsererror').length,
        unsafe: document.querySelectorAll('script,foreignObject').length,
        width: Number(document.documentElement.getAttribute('width')),
        height: Number(document.documentElement.getAttribute('height')),
        projects: document.querySelectorAll('g[data-project-id]').length,
        phases: document.querySelectorAll('g[data-phase-id]').length,
        bars: document.querySelectorAll('.bar-wrapper').length,
        header: document.querySelectorAll('[data-export-header]').length,
        text: document.documentElement.textContent,
      };
    }, xml);
    expect(content.errors).toBe(0);
    expect(content.unsafe).toBe(0);
    expect(content.width).toBeGreaterThan(0);
    expect(content.height).toBeGreaterThan(0);
    expect(content.text).toContain(model.title);
    if (mode === 'timeline') {
      expect(content.bars).toBe(15);
      expect(content.header).toBe(1);
    } else {
      expect(content.projects).toBe(7);
      expect(content.phases).toBe(15);
      expect([content.width, content.height]).toEqual([3840, 2160]);
    }

    const bitmap = await download(page, 'png');
    expect(bitmap.suggestedFilename()).toBe(`${basename}.png`);
    await bitmap.saveAs(info.outputPath(`${mode}.png`));
    const png = await readFile(await bitmap.path());
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const size = [png.readUInt32BE(16), png.readUInt32BE(20)];
    if (mode === 'timeline') {
      expect(size[0]).toBeGreaterThanOrEqual(content.width);
      expect(size[1]).toBeGreaterThanOrEqual(content.height);
      expect(size[0] / size[1]).toBeCloseTo(content.width / content.height, 2);
      expect(size).not.toEqual([3840, 2160]);
    } else expect(size).toEqual([3840, 2160]);
    const pixels = await page.evaluate(async body => {
      const image = new Image();
      image.src = `data:image/png;base64,${body}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0, opaque = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 250) opaque++;
        if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 45 && data[i + 3] > 128) colored++;
      }
      return { colored, opaque };
    }, png.toString('base64'));
    expect(pixels.opaque).toBe(960 * 540);
    expect(pixels.colored).toBeGreaterThan(1000);
    expect(await draft(page)).toEqual(model);
    await expect(action(page, 'undo')).toBeDisabled();
    await expect(action(page, 'redo')).toBeDisabled();
  });
}
