import { globalClick, selectSnap, clickAction} from './global-actions.js';
import { test, expect } from './audit-fixture.js';

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', error => testInfo.pageErrors.push(error.message));
});
test.afterEach(async ({}, testInfo) => { expect(testInfo.pageErrors).toEqual([]); });
import { readFile } from 'node:fs/promises';

const copy = value => JSON.parse(JSON.stringify(value));
const shift = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const days = task => Math.round((Date.parse(task.end) - Date.parse(task.start)) / 86400000) + 1;
const wrapper = (page, id = 'target') => page.locator(`.bar-wrapper[data-id=${JSON.stringify(id)}]`);
const taskBar = (page, id = 'target') => wrapper(page, id).locator('.bar').first();
const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const currentTask = async page => (await stored(page)).projects[0].phases[0];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function modelWithTasks(tasks) {
  return {
    title: '日期邊界測試', metadata: { retain: ['日期', { value: 9 }] },
    projects: [{
      id: 'project', name: '保留手動設計', color: '#2563eb', icon: '★', locks: { color: true },
      phases: tasks.map((task, index) => ({
        id: index ? `marker-${index}` : 'target', label: `階段 ${index}`,
        locks: { label: true }, metadata: { index }, ...task,
      })),
    }],
  };
}

async function mount(page, model) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('calendar.test.seeded')) {
      localStorage.setItem('drag.draft', JSON.stringify(value));
      localStorage.setItem('drag.leftPaddingMonths', '3');
      localStorage.setItem('drag.rightPaddingMonths', '3');
      localStorage.setItem('drag.snap', '1d');
      localStorage.setItem('calendar.test.seeded', 'true');
    }
  }, model);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(model.projects[0].phases.length);
  expect(await stored(page)).toEqual(model);
}

async function configure(page, view = 'Day') {
  await page.locator('#view').selectOption(view);
  await selectSnap(page,'1d');
  await settle(page);
}

async function putDateInView(page, referenceId, fraction = 0.45) {
  await taskBar(page, referenceId).evaluate((element, ratio) => {
    const preview = document.querySelector('.preview');
    preview.scrollLeft += element.getBoundingClientRect().left - preview.getBoundingClientRect().left - preview.clientWidth * ratio;
  }, fraction);
  await settle(page);
}

// Marker tasks are user-visible date landmarks. Measuring their rendered edges
// avoids approximating month, quarter, or year lengths in the test itself.
async function dragBetweenMarkers(page, id = 'target') {
  await putDateInView(page, 'origin-marker');
  // Observe one completed chart frame; a range rebuild can briefly replace SVG nodes.
  let positions;
  await expect.poll(async () => {
    positions=await page.evaluate(taskId=>{
      const box=selector=>{const node=document.querySelector(selector);if(!node||!node.getClientRects().length)return null;const r=node.getBoundingClientRect();return r.width&&r.height?{x:r.x,y:r.y,width:r.width,height:r.height}:null;};
      return {origin:box('.bar-wrapper[data-id="origin-marker"] .bar'),destination:box('.bar-wrapper[data-id="destination-marker"] .bar'),target:box(`.bar-wrapper[data-id="${CSS.escape(taskId)}"] .bar`),preview:box('.preview')};
    },id);
    return Object.values(positions).every(Boolean);
  }).toBe(true);
  const {origin,destination,target,preview}=positions;
  const y = target.y + target.height / 2;
  expect(origin.x).toBeGreaterThan(preview.x + 70);
  expect(destination.x).toBeLessThan(preview.x + preview.width - 70);
  await page.mouse.move(Math.floor(origin.x), y);
  await page.mouse.down();
  await page.mouse.move(Math.floor(destination.x), y, { steps: 4 });
  await page.mouse.up();
  await settle(page);
}

for (const view of ['Day', 'Week', 'Month', 'Quarter', 'Year']) {
  for (const [name, start, end, origin, delta, expectedStart] of [
    ['month end', '2026-01-29', '2027-01-28', '2026-08-30', 5, '2026-02-03'],
    ['year end', '2026-12-29', '2028-12-28', '2027-12-30', 5, '2027-01-03'],
    ['2028 leap day', '2028-02-27', '2029-02-26', '2028-03-30', 3, '2028-03-01'],
    ['backward into February', '2026-03-02', '2027-03-01', '2026-08-02', -3, '2026-02-27'],
    ['spring DST boundary', '2027-03-12', '2028-03-11', '2027-08-20', 4, '2027-03-16'],
    ['backward fall DST boundary', '2027-11-09', '2028-11-08', '2028-06-20', -4, '2027-11-05'],
  ]) {
    test(`${view} 1d drag crosses ${name} with exact ISO dates and unchanged duration`, async ({ page }) => {
      const model = modelWithTasks([
        { start, end },
        { id: 'origin-marker', start: origin, end: origin },
        { id: 'destination-marker', start: shift(origin, delta), end: shift(origin, delta) },
      ]);
      await mount(page, model);
      await configure(page, view);
      await dragBetweenMarkers(page);
      const expected = copy(model);
      expected.projects[0].phases[0] = {
        ...model.projects[0].phases[0], start: expectedStart, end: shift(end, delta),
        locks: { label: true, start: true, end: true },
      };
      await expect.poll(() => stored(page)).toEqual(expected);
      expect(days(await currentTask(page))).toBe(days(model.projects[0].phases[0]));
      await page.reload();
      await expect(taskBar(page)).toBeVisible();
      expect(await stored(page)).toEqual(expected);
    });
  }
}

for (const side of ['left', 'right']) {
  test(`${side} resize across the opposite endpoint clamps to one valid calendar day`, async ({ page }) => {
    const model = modelWithTasks([{ start: '2028-02-27', end: '2028-03-02' }]);
    await mount(page, model);
    await configure(page);
    await putDateInView(page, 'target', 0.35);
    const handle = await wrapper(page).locator(`.handle.${side}`).boundingBox();
    const y = handle.y + handle.height / 2;
    const x = handle.x + handle.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (side === 'left' ? 380 : -380), y, { steps: 8 });
    await page.mouse.up();
    const expected = copy(model);
    const field = side === 'left' ? 'start' : 'end';
    expected.projects[0].phases[0][field] = side === 'left' ? '2028-03-02' : '2028-02-27';
    expected.projects[0].phases[0].locks[field] = true;
    await expect.poll(() => stored(page)).toEqual(expected);
    expect(days(await currentTask(page))).toBe(1);
    await globalClick(page,'undo');
    expect(await stored(page)).toEqual(model);
  });
}

for (const side of ['left', 'right']) {
  test(`active auto-pan extends the ${side} hard boundary and retains the gesture`, async ({ page }) => {
    const model = modelWithTasks([{ start: '2026-10-21', end: '2026-10-30' }]);
    await mount(page, model);
    await configure(page);
    await putDateInView(page, 'target', 0.35);
    const target = await taskBar(page).boundingBox();
    const preview = await page.locator('.preview').boundingBox();
    const before = await page.evaluate(() => ({
      left: Number(localStorage.getItem('drag.leftPaddingMonths')),
      right: Number(localStorage.getItem('drag.rightPaddingMonths')),
      width: document.querySelector('.preview').scrollWidth,
    }));
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.locator('.preview').evaluate((element, edge) => {
      element.scrollLeft = edge === 'left' ? 0 : element.scrollWidth - element.clientWidth;
    }, side);
    const edgeX = side === 'left' ? preview.x + 5 : preview.x + preview.width - 5;
    await page.mouse.move(edgeX, target.y + target.height / 2, { steps: 4 });
    await expect.poll(() => page.evaluate(edge => Number(localStorage.getItem(`drag.${edge}PaddingMonths`)), side), { timeout: 5000 }).toBeGreaterThan(before[side]);
    expect(await page.locator('.preview').evaluate(element => element.scrollWidth)).toBeGreaterThan(before.width);
    expect(await page.evaluate(edge => Number(localStorage.getItem(`drag.${edge}PaddingMonths`)), side === 'left' ? 'right' : 'left')).toBe(before[side === 'left' ? 'right' : 'left']);
    expect(await stored(page)).toEqual(model);
    const pending = await wrapper(page).getAttribute('data-start');
    // Keep dragging after the canvas has been rebuilt; capture must survive.
    await page.mouse.move(edgeX + (side === 'left' ? 150 : -150), target.y + target.height / 2, { steps: 8 });
    await expect.poll(() => wrapper(page).getAttribute('data-start')).not.toBe(pending);
    await page.mouse.up();
    const moved = await currentTask(page);
    expect(days(moved)).toBe(days(model.projects[0].phases[0]));
    expect(moved.start <= moved.end).toBe(true);
    expect(moved.locks).toEqual({ label: true, start: true, end: true });
    await globalClick(page,'undo');
    expect(await stored(page)).toEqual(model);
  });
}

for (const side of ['left', 'right']) {
  test(`ordinary scroll extends only the ${side} side without moving a visible date label`, async ({ page }) => {
    const model = modelWithTasks([{ start: '2026-10-21', end: '2026-10-30' }]);
    await mount(page, model);
    await configure(page);
    const before = await page.evaluate(() => ({
      left: Number(localStorage.getItem('drag.leftPaddingMonths')),
      right: Number(localStorage.getItem('drag.rightPaddingMonths')),
    }));
    await page.locator('.preview').evaluate((element, edge) => {
      element.scrollLeft = edge === 'left' ? 0 : element.scrollWidth - element.clientWidth;
    }, side);
    await settle(page);
    const label = await page.locator('.lower-text').evaluateAll(elements => {
      const preview = document.querySelector('.preview').getBoundingClientRect();
      const visible = elements.find(element => {
        const box = element.getBoundingClientRect();
        return box.left > preview.left + 100 && box.right < preview.right - 100;
      });
      if (!visible) return null;
      return { className: [...visible.classList].find(name => /^date_\d{4}-\d{2}-\d{2}$/.test(name)), x: visible.getBoundingClientRect().left };
    });
    expect(label).not.toBeNull();
    expect(label.className).toBeTruthy();
    const viewport = await page.locator('.preview').boundingBox();
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 120);
    await page.mouse.wheel(side === 'left' ? -400 : 400, 0);
    await expect.poll(() => page.evaluate(edge => Number(localStorage.getItem(`drag.${edge}PaddingMonths`)), side), { timeout: 5000 }).toBe(before[side] + 2);
    const after = await page.evaluate(() => ({
      left: Number(localStorage.getItem('drag.leftPaddingMonths')),
      right: Number(localStorage.getItem('drag.rightPaddingMonths')),
    }));
    expect(after[side === 'left' ? 'right' : 'left']).toBe(before[side === 'left' ? 'right' : 'left']);
    const movedLabel = await page.locator(`.lower-text.${label.className}`).boundingBox();
    expect(Math.abs(movedLabel.x - label.x)).toBeLessThanOrEqual(2);
    expect(await stored(page)).toEqual(model);
  });
}

test('spaces, Chinese and punctuation in stable ids survive selection, dragging, export and reload', async ({ page }) => {
  const id = '任務 A / [日期] "#%?:&=+\\';
  const model = modelWithTasks([{ id, start: '2026-10-21', end: '2026-10-30' }]);
  model.projects[0].id = '專案 A / #%';
  await mount(page, model);
  await configure(page);
  await putDateInView(page, id, 0.35);
  await expect(wrapper(page, id)).toHaveAttribute('data-id', id);
  await taskBar(page,id).hover({position:{x:20,y:5}});
  await page.waitForTimeout(260);
  await page.mouse.move(10,10);
  const box = await taskBar(page, id).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 76, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const expected = copy(model);
  expected.projects[0].phases[0].start = '2026-10-23';
  expected.projects[0].phases[0].end = '2026-11-01';
  expected.projects[0].phases[0].locks = { label: true, start: true, end: true };
  await expect.poll(() => stored(page)).toEqual(expected);
  await expect(page.locator('[data-field="label"]')).toHaveValue(model.projects[0].phases[0].label);
  const downloadPromise = page.waitForEvent('download');
  await globalClick(page,'save');
  const download = await downloadPromise;
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toEqual(expected);
  await page.reload();
  await expect(wrapper(page, id)).toBeVisible();
  expect(await stored(page)).toEqual(expected);
});

test('corrupt local draft is retained while a warning and the intact seed are shown', async ({ page }) => {
  const raw = '{this draft must remain available for recovery';
  const warnings = [];
  page.on('dialog', async dialog => { warnings.push(dialog.message()); await dialog.dismiss(); });
  await page.addInitScript(value => localStorage.setItem('drag.draft', value), raw);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  await expect.poll(() => warnings.length).toBe(1);
  expect(warnings[0]).toMatch(/保留原始草稿/);
  expect(await page.evaluate(() => localStorage.getItem('drag.draft'))).toBe(raw);
  await expect(page.locator('.tree-item[data-select-p]')).toHaveCount(7);
});

test('clearing either date input restores its previous value without editing dates or locks', async ({ page }) => {
  const model = modelWithTasks([{ start: '2028-02-27', end: '2028-03-02' }]);
  await mount(page, model);
  await page.locator('[data-select-f="0:0"]').click();
  for (const field of ['start', 'end']) {
    const input = page.locator(`[data-field="${field}"]`);
    const dialogPromise = page.waitForEvent('dialog').then(async dialog => { const message = dialog.message(); await dialog.dismiss(); return message; });
    await input.fill('');
    await input.press('Tab');await input.blur();
    expect(await dialogPromise).toMatch(/有效日期/);
    await expect(input).toHaveValue(model.projects[0].phases[0][field]);
    expect(await stored(page)).toEqual(model);
  }
});


test('year headers start on January 1 even when month padding is not a whole year', async ({ page }) => {
  await mount(page, modelWithTasks([{start:'2026-10-21',end:'2027-10-20'}]));
  await configure(page,'Year');
  const headers = await page.locator('.lower-text').evaluateAll(elements => elements.map(el => [...el.classList].find(c=>c.startsWith('date_'))));
  expect(headers.length).toBeGreaterThan(1);
  expect(headers.every(name=>/^date_\d{4}-01-01$/.test(name))).toBe(true);
});

test('selecting a bar keeps editor add and delete actions working', async ({ page }) => {
  const model=modelWithTasks([{start:'2026-10-21',end:'2026-10-30'}]);
  await mount(page,model);
  await configure(page);
  await putDateInView(page,'target',0.35);
  await taskBar(page).click({position:{x:20,y:5}});
  await page.locator('[data-select-f="0:0"]').click();
  await page.locator('#editor [data-action="newphase"]').click();
  await expect.poll(async()=> (await stored(page)).projects[0].phases.length).toBe(2);
  await globalClick(page,'undo');
  await taskBar(page).click({position:{x:20,y:5}});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#editor [data-action="delete"]').click();
  await expect.poll(async()=> (await stored(page)).projects[0].phases.length).toBe(0);
  await globalClick(page,'undo');
  expect(await stored(page)).toEqual(model);
});
