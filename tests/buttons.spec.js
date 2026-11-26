import { selectTimelineScale, clickAction, openViewOptions, documentItems, currentDocument, chooseDocument } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const sourceSeed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const button = (page, action) => page.locator(`[data-action="${action}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const scrollLeft = page => page.locator('.preview').evaluate(node => node.scrollLeft);

function fixture() {
  const model = structuredClone(sourceSeed);
  model.metadata = { source: 'button-audit', nested: ['保留', { value: 11 }] };
  model.projects.forEach((project, pi) => {
    project.id = `buttons-project-${pi}`;
    project.locks = { color: true };
    project.metadata = { index: pi };
    project.phases.forEach((phase, fi) => {
      phase.id = `buttons-phase-${pi}-${fi}`;
      phase.locks = { label: true };
      phase.metadata = { keep: [pi, fi] };
    });
  });
  return model;
}

function oneTask(start, end = start) {
  const model = fixture();
  model.projects = [model.projects[0]];
  model.projects[0].phases = [{ ...model.projects[0].phases[0], start, end }];
  return model;
}

async function mount(page, model = fixture(), left = 3, right = 3) {
  await page.addInitScript(({ value, left, right }) => {
    if (!localStorage.getItem('buttons.seeded')) {
      localStorage.setItem('drag.draft', JSON.stringify(value));
      localStorage.setItem('drag.leftPaddingMonths', String(left));
      localStorage.setItem('drag.rightPaddingMonths', String(right));
      localStorage.setItem('drag.paneHeight', '65');
      localStorage.setItem('buttons.seeded', 'true');
    }
  }, { value: model, left, right });
  await page.goto('/');
  await expect(button(page, 'newproject')).toBeVisible();
  expect(await draft(page)).toEqual(model);
  return model;
}

async function disabledControl(locator) {
  await expect(locator).toBeDisabled();
  await expect(locator).not.toHaveAttribute('title', /\S/);
}

async function download(page, action) {
  const pending = page.waitForEvent('download');
  await clickAction(page, action);
  return pending;
}

async function change(page, selector, value) {
  if (selector.includes('data-field') && !await page.locator('#editor').isVisible()) await page.locator('[data-select-f="0:0"]').click();
  const field = page.locator(selector);
  await field.fill(value);
  await field.press('Tab');await field.blur();
}

async function padding(page) {
  return page.evaluate(() => ({ left: Number(localStorage.getItem('drag.leftPaddingMonths')), right: Number(localStorage.getItem('drag.rightPaddingMonths')) }));
}

async function importThroughButton(page, model) {
  const pending = page.waitForEvent('filechooser');
  await clickAction(page, 'import');
  const chooser = await pending;
  await chooser.setFiles({ name: 'button-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect.poll(() => draft(page)).toEqual(model);
}

test.beforeEach(async ({ page }, info) => {
  info.buttonPageErrors = [];
  page.on('pageerror', error => info.buttonPageErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.buttonPageErrors).toEqual([]); });

test('history buttons show availability, restore exact data, and discard redo after a new edit', async ({ page }, info) => {
  const model = await mount(page);
  await disabledControl(button(page, 'undo'));
  await disabledControl(button(page, 'redo'));
  await page.screenshot({ path: info.outputPath('buttons-initial.png'), fullPage: true });
  await change(page, '#editor [data-field="label"]', '按鈕測試：保留手動鎖');
  const edited = await draft(page);
  expect(edited.projects[0].phases[0].locks.label).toBe(true);
  await expect(button(page, 'undo')).toBeEnabled();
  await disabledControl(button(page, 'redo'));
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await disabledControl(button(page, 'undo'));
  await expect(button(page, 'redo')).toBeEnabled();
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(edited);
  await disabledControl(button(page, 'redo'));
  await clickAction(page, 'undo');
  await change(page, '#editor [data-field="label"]', '另一項使用者修改');
  await disabledControl(button(page, 'redo'));
  expect((await draft(page)).metadata).toEqual(model.metadata);
});

test('JSON save downloads the current model without adding helper or save-status text in any mode', async ({ page }) => {
  const model = await mount(page);
  await change(page, '#editor [data-field="label"]', '已手動修改並需要匯出');
  const edited = await draft(page);
  await expect(page.locator('.hint,.save-state,.action-status')).toHaveCount(0);
  const saved = await download(page, 'save');
  expect(saved.suggestedFilename()).toBe((await currentDocument(page).textContent()) + '.json');
  expect(JSON.parse(await readFile(await saved.path(), 'utf8'))).toEqual(edited);
  for (const mode of ['simple', 'timeline']) {
    await clickAction(page, mode);
    await expect(page.locator('.hint,.save-state,.action-status')).toHaveCount(0);
  }
  expect(await draft(page)).toEqual(edited);
  await change(page, '#editor [data-field="milestone"]', '下載後再修改');
  await expect(page.locator('.hint,.save-state,.action-status')).toHaveCount(0);
  expect((await draft(page)).projects.slice(1)).toEqual(model.projects.slice(1));
});


test('import button opens JSON and an empty project can be deleted on the first click, then restored', async ({ page }) => {
  const original = await mount(page);
  const imported = { title: '沒有任務的專案', metadata: { retain: 37 }, projects: [{ id: 'empty-project', name: '空專案', icon: '✦', color: '#123456', phases: [], locks: { name: true }, metadata: { retained: ['a', 'b'] } }] };
  await importThroughButton(page, imported);
  await page.locator('[data-select-p="0"]').click();
  await expect(page.locator('#editor h2')).toHaveText('專案屬性');
  await expect(button(page, 'delete')).toHaveText('刪除專案');
  await expect(page.locator('[data-select-p="0"]')).toHaveClass(/selected/);
  page.once('dialog', dialog => dialog.accept());
  await clickAction(page, 'delete');
  expect(await draft(page)).toEqual({ ...imported, projects: [] });
  await expect(page.locator('#editor [data-action="delete"]')).toHaveCount(0);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(imported);
  await expect(page.locator('#editor h2')).toHaveText('專案屬性');
  await expect(button(page, 'undo')).toBeDisabled();
  const importedId=await currentDocument(page).getAttribute('data-document-id');
  const originalId=await documentItems(page).first().getAttribute('data-document-id');
  await chooseDocument(page,originalId);
  await expect.poll(()=>draft(page)).toEqual(original);
  await chooseDocument(page,importedId);
  await expect.poll(()=>draft(page)).toEqual(imported);
  await expect(button(page, 'delete')).toHaveText('刪除專案');
});

test('empty timeline disables unavailable controls and becomes usable after adding a project and task', async ({ page }) => {
  const model = { title: '空白按鈕測試', metadata: { keep: ['empty'] }, projects: [] };
  await mount(page, model);
  for (const action of ['prev', 'next', 'today', 'expand-left', 'expand-right', 'shrink-left', 'shrink-right', 'svg', 'png', 'gif']) await disabledControl(button(page, action));
  await expect(button(page, 'save')).toBeEnabled();
  await expect(button(page, 'import')).toBeEnabled();
  await clickAction(page, 'newproject');
  await expect(page.locator('#editor [data-field="name"]')).toHaveValue('新專案');
  await expect(button(page, 'newphase')).toBeEnabled();
  await clickAction(page, 'newphase');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(1);
  for (const action of ['today', 'expand-left', 'expand-right', 'svg', 'png', 'gif']) await expect(button(page, action)).toBeEnabled();
  const added = await draft(page);
  expect(added.metadata).toEqual(model.metadata);
  expect(added.projects).toHaveLength(1);
  expect(added.projects[0].phases).toHaveLength(1);
  await clickAction(page, 'undo');
  await expect(page.locator('#editor h2')).toHaveText('專案屬性');
  await expect(button(page, 'delete')).toHaveText('刪除專案');
  await disabledControl(button(page, 'svg'));
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(added);
  await expect(button(page, 'svg')).toBeEnabled();
});

test('new project and task are revealed, cancel delete is harmless, and accepted deletions are undoable', async ({ page }) => {
  const original = await mount(page);
  await page.evaluate(() => { document.querySelector('aside').scrollTop = 0; document.querySelector('#editor').scrollTop = 100; });
  await clickAction(page, 'newproject');
  await expect(page.locator('#editor [data-field="name"]')).toHaveValue('新專案');
  expect(await page.locator('#editor').evaluate(node => node.scrollTop)).toBe(0);
  const selected = page.locator('[data-select-p="7"]');
  await expect(selected).toHaveClass(/selected/);
  const revealed = await selected.evaluate(node => { const a = node.getBoundingClientRect(), b = node.closest('aside').getBoundingClientRect(), header = node.closest('aside').querySelector('.aside-title').getBoundingClientRect(); return a.top >= Math.max(b.top, header.bottom) - 1 && a.bottom <= b.bottom + 1; });
  expect(revealed).toBe(true);
  await clickAction(page, 'newphase');
  const withTask = await draft(page);
  expect(withTask.projects.slice(0, 7)).toEqual(original.projects);
  expect(withTask.projects[7].phases).toHaveLength(1);
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue('新任務');
  page.once('dialog', dialog => dialog.dismiss());
  await clickAction(page, 'delete');
  expect(await draft(page)).toEqual(withTask);
  page.once('dialog', dialog => dialog.accept());
  await clickAction(page, 'delete');
  expect((await draft(page)).projects[7].phases).toHaveLength(0);
  await expect(button(page, 'delete')).toHaveText('刪除專案');
  page.once('dialog', dialog => dialog.accept());
  await clickAction(page, 'delete');
  expect(await draft(page)).toEqual(original);
  await clickAction(page, 'undo');
  expect((await draft(page)).projects).toHaveLength(8);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(withTask);
});

test('independent date padding limits disable only impossible actions and preserve task data', async ({ page }) => {
  const model = await mount(page, fixture(), 1, 120);
  await disabledControl(button(page, 'shrink-left'));
  await disabledControl(button(page, 'expand-right'));
  await expect(button(page, 'expand-left')).toBeEnabled();
  await expect(button(page, 'shrink-right')).toBeEnabled();
  await clickAction(page, 'expand-left');
  expect(await padding(page)).toEqual({ left: 4, right: 120 });
  await expect(button(page, 'shrink-left')).toBeEnabled();
  await clickAction(page, 'shrink-right');
  expect(await padding(page)).toEqual({ left: 4, right: 117 });
  await expect(button(page, 'expand-right')).toBeEnabled();
  await clickAction(page, 'shrink-left');
  // Outwait the 300 ms edge-extension timer: shrinking must stay shrunk.
  await page.waitForTimeout(650);
  expect(await padding(page)).toEqual({ left: 1, right: 117 });
  await disabledControl(button(page, 'shrink-left'));
  await clickAction(page, 'expand-right');
  await page.waitForTimeout(650);
  expect(await padding(page)).toEqual({ left: 1, right: 120 });
  await disabledControl(button(page, 'expand-right'));
  expect(await draft(page)).toEqual(model);
  await disabledControl(button(page, 'undo'));
});

test('navigation buttons move the viewport and disable at a reached horizontal boundary', async ({ page }) => {
  const model = await mount(page, fixture(), 120, 120);
  await page.locator('.preview').evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2; });
  await expect(button(page, 'prev')).toBeEnabled();
  await expect(button(page, 'next')).toBeEnabled();
  const middle = await scrollLeft(page);
  await clickAction(page, 'prev');
  expect(await scrollLeft(page)).toBeLessThan(middle - 100);
  const previous = await scrollLeft(page);
  await clickAction(page, 'next');
  expect(await scrollLeft(page)).toBeGreaterThan(previous + 100);
  await page.locator('.preview').evaluate(node => { node.scrollLeft = 0; });
  await disabledControl(button(page, 'prev'));
  await expect(button(page, 'next')).toBeEnabled();
  await page.locator('.preview').evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await disabledControl(button(page, 'next'));
  await expect(button(page, 'prev')).toBeEnabled();
  expect(await draft(page)).toEqual(model);
});

test('both navigation buttons stay disabled when the timeline fits without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  const model = await mount(page, oneTask('2026-10-21'), 1, 1);
  await selectTimelineScale(page, 'Year');
  const overflow = await page.locator('.preview').evaluate(node => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await disabledControl(button(page, 'prev'));
  await disabledControl(button(page, 'next'));
  expect(await draft(page)).toEqual(model);
});

test('today extends a distant timeline so the actual current date is visible without changing tasks', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'));
  const model = await mount(page, oneTask('2028-01-10', '2028-01-20'), 1, 1);
  await expect(page.locator('.lower-text.date_2026-10-01')).toHaveCount(0);
  await clickAction(page, 'today');
  await expect(page.locator('.lower-text.date_2026-10-01')).toHaveCount(1);
  const visible = await page.evaluate(() => {
    const october = document.querySelector('.lower-text.date_2026-10-01'), november = document.querySelector('.lower-text.date_2026-11-01');
    const left = parseFloat(october.style.left), column = parseFloat(november.style.left) - left;
    const todayX = document.querySelector('#gantt svg').getBoundingClientRect().left + left + 20 / 31 * column;
    const viewport = document.querySelector('.preview').getBoundingClientRect();
    return todayX >= viewport.left && todayX <= viewport.right;
  });
  expect(visible).toBe(true);
  await expect(page.locator('.hint,.save-state,.action-status')).toHaveCount(0);
  expect((await padding(page)).left).toBeGreaterThan(1);
  expect((await padding(page)).left).toBeLessThanOrEqual(120);
  expect(await draft(page)).toEqual(model);
  await disabledControl(button(page, 'undo'));
});

test('today reports an out-of-limit date instead of silently clamping or changing the model', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'));
  const model = await mount(page, oneTask('2045-01-10', '2045-01-20'), 1, 1);
  const before = await padding(page);
  let message = '';
  page.once('dialog', async dialog => { message = dialog.message(); await dialog.accept(); });
  await clickAction(page, 'today');
  expect(message).toMatch(/今天|今日/);
  expect(await draft(page)).toEqual(model);
  expect(await padding(page)).toEqual(before);
});

test('all four date nudges change only their date and lock, reject single-day shortening, and undo exactly', async ({ page }) => {
  const model = await mount(page, oneTask('2026-10-21'));
  await page.locator('[data-select-f="0:0"]').click();
  await disabledControl(page.locator('[data-nudge="start:1"]'));
  await disabledControl(page.locator('[data-nudge="end:-1"]'));
  await expect(page.locator('[data-nudge="start:-1"]')).toBeEnabled();
  await expect(page.locator('[data-nudge="end:1"]')).toBeEnabled();
  const expected = structuredClone(model);
  for (const [action, field, date] of [
    ['end:1', 'end', '2026-10-22'],
    ['start:1', 'start', '2026-10-22'],
    ['start:-1', 'start', '2026-10-21'],
    ['end:-1', 'end', '2026-10-21'],
  ]) {
    await page.locator(`[data-nudge="${action}"]`).click();
    const target = expected.projects[0].phases[0];
    target[field] = date;
    target.locks[field] = true;
    expect(await draft(page)).toEqual(expected);
    if (target.start === target.end) {
      await disabledControl(page.locator('[data-nudge="start:1"]'));
      await disabledControl(page.locator('[data-nudge="end:-1"]'));
    } else {
      await expect(page.locator('[data-nudge="start:1"]')).toBeEnabled();
      await expect(page.locator('[data-nudge="end:-1"]')).toBeEnabled();
    }
  }
  for (let i = 0; i < 4; i++) await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await disabledControl(button(page, 'undo'));
});

test('failed picture rendering disables the unified export controls and enables them again after correcting the range', async ({ page }) => {
  const model = fixture();
  model.presentation = { start: '1900-01-01', end: '2101-01-01', locks: { start: true } };
  await mount(page, model);
  await clickAction(page, 'simple');
  await expect(page.locator('.report-message')).toContainText('圖片載入失敗');
  await expect(page.getByRole('slider', { name: '圖片縮放拉桿' })).toBeDisabled();
  for (const action of ['svg', 'png', 'gif']) await disabledControl(button(page, action));
  await openViewOptions(page);
  await change(page, '#report-end', '1900-12-31');
  await expect(page.locator('.infographic-preview svg')).toBeVisible();
  await expect(page.getByRole('slider', { name: '圖片縮放拉桿' })).toBeEnabled();
  for (const action of ['svg', 'png', 'gif']) await expect(button(page, action)).toBeEnabled();
  const file = await download(page, 'svg');
  expect(file.suggestedFilename()).toBe('drag-simple.svg');
  expect(await readFile(await file.path(), 'utf8')).toContain('data-simple="true"');
  expect((await draft(page)).projects).toEqual(model.projects);
  expect((await draft(page)).metadata).toEqual(model.metadata);
  expect((await draft(page)).presentation.locks).toEqual({ start: true, end: true });
});

test('opening the same invalid JSON twice reports both errors and retains the valid draft', async ({ page }) => {
  const model = await mount(page);
  const invalid = { name: 'invalid-same-file.json', mimeType: 'application/json', buffer: Buffer.from('{"projects":"invalid"}') };
  const messages = [];
  page.on('dialog', async dialog => { messages.push(dialog.message()); await dialog.accept(); });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const pending = page.waitForEvent('filechooser');
    await clickAction(page, 'import');
    await (await pending).setFiles(invalid);
    await expect.poll(() => messages.length).toBe(attempt);
    expect(messages.at(-1)).toContain('開啟失敗');
    expect(await draft(page)).toEqual(model);
    await disabledControl(button(page, 'undo'));
  }
});

test('font controls show automatic sizing honestly and preserve a manual choice to return to automatic', async ({ page }) => {
  const model = await mount(page);
  for (const selection of ['[data-select-f="0:0"]', '[data-select-p="0"]']) {
    await page.locator(selection).click();
    const font = page.locator('#editor [data-field="fontSize"]');
    await expect(font).toHaveValue('');
    await expect(font).toHaveAttribute('placeholder', '自動');
    await font.fill('30');
    await font.press('Tab');await font.blur();
    let updated = await draft(page);
    let target = selection.includes('select-f') ? updated.projects[0].phases[0] : updated.projects[0];
    expect(target.fontSize).toBe(30);
    expect(target.locks.fontSize).toBe(true);
    const explicit = structuredClone(updated);
    await page.locator('#editor [data-field="fontSize"]').fill('');
    await page.locator('#editor [data-field="fontSize"]').press('Tab');await page.locator('#editor [data-field="fontSize"]').blur();
    await expect(page.locator('#editor [data-field="fontSize"]')).toHaveValue('');
    updated = await draft(page);
    target = selection.includes('select-f') ? updated.projects[0].phases[0] : updated.projects[0];
    expect(target).not.toHaveProperty('fontSize');
    expect(target.locks.fontSize).toBe(true);
    const automatic = structuredClone(updated);
    await clickAction(page, 'undo');
    expect(await draft(page)).toEqual(explicit);
    await expect(page.locator('#editor [data-field="fontSize"]')).toHaveValue('30');
    await clickAction(page, 'redo');
    expect(await draft(page)).toEqual(automatic);
    await expect(page.locator('#editor [data-field="fontSize"]')).toHaveValue('');
  }
  const expected = structuredClone(model);
  expected.projects[0].locks.fontSize = true;
  expected.projects[0].phases[0].locks.fontSize = true;
  expect(await draft(page)).toEqual(expected);
  await page.reload();
  expect(await draft(page)).toEqual(expected);
});


test('header PNG exports in the picture mode decode at 4K without changing data or manual settings', async ({ page }) => {
  const model = await mount(page);
  for (const mode of ['simple']) {
    await clickAction(page, mode);
    await expect(page.locator('.infographic-preview svg')).toBeVisible();
    const file = await download(page, 'png');
    expect(file.suggestedFilename()).toBe(`drag-${mode}.png`);
    const png = await readFile(await file.path());
    expect(png.readUInt32BE(16)).toBe(3840);
    expect(png.readUInt32BE(20)).toBe(2160);
    const decoded = await page.evaluate(async body => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + body;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, png.toString('base64'));
    expect(decoded).toEqual({ width: 3840, height: 2160 });
    await expect(button(page, 'png')).toBeEnabled();
    expect(await draft(page)).toEqual(model);
  }
});

test('today extends the right side from past work and a second in-range click preserves padding and dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'));
  const model = await mount(page, oneTask('2025-01-10', '2025-01-20'), 1, 1);
  await expect(page.locator('.lower-text.date_2026-10-01')).toHaveCount(0);
  await clickAction(page, 'today');
  await expect(page.locator('.lower-text.date_2026-10-01')).toHaveCount(1);
  const todayIsVisible = () => page.evaluate(() => {
    const october = document.querySelector('.lower-text.date_2026-10-01'), november = document.querySelector('.lower-text.date_2026-11-01');
    const left = parseFloat(october.style.left), column = parseFloat(november.style.left) - left;
    const todayX = document.querySelector('#gantt svg').getBoundingClientRect().left + left + 20 / 31 * column;
    const viewport = document.querySelector('.preview').getBoundingClientRect();
    return todayX >= viewport.left && todayX <= viewport.right;
  });
  expect(await todayIsVisible()).toBe(true);
  await page.waitForTimeout(650);
  const expanded = await padding(page);
  expect(expanded.right).toBeGreaterThan(1);
  expect(expanded.right).toBeLessThanOrEqual(120);
  expect(expanded.left).toBe(1);
  await clickAction(page, 'today');
  await page.waitForTimeout(650);
  expect(await todayIsVisible()).toBe(true);
  expect(await padding(page)).toEqual(expanded);
  expect(await draft(page)).toEqual(model);
  await disabledControl(button(page, 'undo'));
});
