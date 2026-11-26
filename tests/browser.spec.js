import { selectTimelineScale, globalClick, selectSnap, clickAction} from './global-actions.js';
import { test, expect } from './audit-fixture.js';

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', error => testInfo.pageErrors.push(error.message));
});
test.afterEach(async ({}, testInfo) => { expect(testInfo.pageErrors).toEqual([]); });
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const sourceSeed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const expectedColor='rgb('+sourceSeed.projects[0].color.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')+')';
const taskCount = sourceSeed.projects.reduce((total, project) => total + project.phases.length, 0);
const copy = value => JSON.parse(JSON.stringify(value));
const addDays = (date, amount) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};
const duration = task => Math.round((Date.parse(task.end) - Date.parse(task.start)) / 86400000) + 1;

function fixture() {
  const model = copy(sourceSeed);
  model.custom = { source: 'browser-test', nested: ['preserve', { value: 7 }] };
  model.projects.forEach((project, pi) => {
    project.id = `project-${pi}`;
    project.locks = { color: true };
    project.custom = { projectIndex: pi };
    project.phases.forEach((phase, fi) => {
      phase.id = `phase-${pi}-${fi}`;
      phase.locks = { label: true };
      phase.custom = { value: `metadata-${pi}-${fi}` };
    });
  });
  return model;
}

const bar = (page, id = 'phase-0-0') => page.locator(`.bar-wrapper[data-id="${id}"] .bar`).first();
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const firstTask = async page => (await draft(page)).projects[0].phases[0];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function mount(page, model = fixture()) {
  await page.addInitScript(value => {
    // The flag survives reload but each Playwright test receives a fresh context.
    if (!localStorage.getItem('drag.test.seeded')) {
      localStorage.setItem('drag.draft', JSON.stringify(value));
      localStorage.setItem('drag.leftPaddingMonths', '3');
      localStorage.setItem('drag.rightPaddingMonths', '3');
      localStorage.setItem('drag.snap', '1d');
      localStorage.setItem('drag.test.seeded', 'true');
    }
  }, model);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(taskCount);
  await expect(page.locator('.drag-anchor')).toHaveCount(0);
  return model;
}

async function choose(page, view = 'Day', snap = '1d') {
  await selectTimelineScale(page, view);
  await selectSnap(page,snap);
  await settle(page);
}

async function positionTask(page, id = 'phase-0-0') {
  await bar(page, id).evaluate(element => {
    const preview = document.querySelector('.preview');
    const target = element.getBoundingClientRect();
    const viewport = preview.getBoundingClientRect();
    preview.scrollLeft += target.left - viewport.left - viewport.width * 0.32;
    preview.scrollTop += target.top - viewport.top - 110;
  });
  await settle(page);
  const box = await bar(page, id).boundingBox();
  expect(box).not.toBeNull();
  const viewport=await page.locator('.preview').boundingBox();
  box.pointer={x:(Math.max(box.x,viewport.x+20)+Math.min(box.x+box.width,viewport.x+viewport.width-20))/2,y:box.y+box.height/2};
  return box;
}

async function moveTask(page, amount, { side = null, task = null } = {}) {
  const original = task ?? await firstTask(page);
  const box = await positionTask(page, original.id);
  const pixelsPerDay = box.width / duration(original);
  // A long task can extend past the viewport. Start inside its visible left
  // section so this date-accuracy case does not invoke edge auto-pan; that
  // interaction has its own stationary-pointer tests below.
  let origin = { x: box.x + Math.min(box.width / 2, 200), y: box.y + box.height / 2 };
  if (side) {
    await page.locator(`.bar-wrapper[data-id="${original.id}"] .handle.${side}`).evaluate(node=>{const p=document.querySelector('.preview'),r=node.getBoundingClientRect(),v=p.getBoundingClientRect();if(r.right>v.right-220)p.scrollLeft+=r.right-v.right+240;else if(r.left<v.left+220)p.scrollLeft-=v.left-r.left+240;});await settle(page);
    const handle = await page.locator(`.bar-wrapper[data-id="${original.id}"] .handle.${side}`).boundingBox();
    expect(handle).not.toBeNull();
    origin = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  }
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + amount * pixelsPerDay, origin.y, { steps: 12 });
  await page.mouse.up();
  await settle(page);
}

test('seed keeps every task, metadata and design without invisible anchor rows', async ({ page }) => {
  const model = await mount(page);
  expect(model.projects).toHaveLength(7);
  expect(taskCount).toBe(15);
  expect(await draft(page)).toEqual(model);
  const color = await bar(page).evaluate(element => getComputedStyle(element).fill);
  expect(color).toBe(expectedColor);
  await page.reload();
  await expect(bar(page)).toBeVisible();
  expect(await draft(page)).toEqual(model);
});

test('all view and snapping choices preserve real dates and only the preview scrolls horizontally', async ({ page }) => {
  const model = await mount(page);
  for (const view of ['Day', 'Week', 'Month', 'Quarter', 'Year']) {
    for (const snap of ['auto', '1d', '7d', '30d']) {
      await choose(page, view, snap);
      await expect(page.locator('.timeline-date-dock')).toHaveAttribute('data-scale', view);
      await expect(page.locator('#snap')).toHaveValue(snap);
      await expect(page.locator('.bar-wrapper .bar')).toHaveCount(taskCount);
      expect(await draft(page)).toEqual(model);
      expect(await page.locator('.preview .gantt-container').evaluate(element => {
        const style = getComputedStyle(element);
        return style.overflowX;
      })).not.toMatch(/^(auto|scroll)$/);
    }
  }
});

for (const delta of [3, -2]) {
  test(`bar moves ${delta} days with stable duration, one undo and persistent reload`, async ({ page }) => {
    const model = await mount(page);
    const original = copy(model.projects[0].phases[0]);
    await choose(page);
    await moveTask(page, delta);
    await expect.poll(() => firstTask(page)).toEqual({
      ...original, start: addDays(original.start, delta), end: addDays(original.end, delta),
      locks: { ...original.locks, start: true, end: true },
    });
    const expected = copy(model);
    expected.projects[0].phases[0] = await firstTask(page);
    expect(await draft(page)).toEqual(expected);
    await page.reload();
    await expect(bar(page)).toBeVisible();
    expect(await draft(page)).toEqual(expected);
    // Undo history is intentionally in memory, so perform a new action after reload.
    await choose(page);
    await moveTask(page, 1);
    await globalClick(page,'undo');
    expect(await draft(page)).toEqual(expected);
    await page.reload();
    await expect(bar(page)).toBeVisible();
    expect(await draft(page)).toEqual(expected);
  });
}

test('one drag creates one history entry and redo restores the complete locked model', async ({ page }) => {
  const model = await mount(page);
  await choose(page);
  await moveTask(page, 3);
  const moved = await draft(page);
  await globalClick(page,'undo');
  expect(await draft(page)).toEqual(model);
  await globalClick(page,'redo');
  expect(await draft(page)).toEqual(moved);
  await page.reload();
  await expect(bar(page)).toBeVisible();
  expect(await draft(page)).toEqual(moved);
});

for (const [side, field, delta] of [['left', 'start', 2], ['left', 'start', -2], ['right', 'end', 2], ['right', 'end', -2]]) {
  test(`${side} resize ${delta} days edits and locks only ${field}`, async ({ page }) => {
    const model = await mount(page);
    const original = copy(model.projects[0].phases[0]);
    await choose(page);
    await moveTask(page, delta, { side });
    const expected = copy(model);
    expected.projects[0].phases[0] = {
      ...original, [field]: addDays(original[field], delta),
      locks: { ...original.locks, [field]: true },
    };
    await expect.poll(() => draft(page)).toEqual(expected);
    await globalClick(page,'undo');
    expect(await draft(page)).toEqual(model);
    await page.reload();
    await expect(bar(page)).toBeVisible();
    expect(await draft(page)).toEqual(model);
  });
}

for (const [view, snap, distance, result] of [
  ['Day', '1d', 2.7, 3], ['Week', '7d', 9, 7], ['Month', '30d', 35, 30],
  ['Week', '7d', -9, -7], ['Month', '30d', -35, -30],
]) {
  test(`${view} ${snap} snapping rounds ${distance} days to ${result}`, async ({ page }) => {
    const model = await mount(page);
    const original = model.projects[0].phases[0];
    await choose(page, view, snap);
    await moveTask(page, distance);
    await expect.poll(async () => {
      const task = await firstTask(page);
      return [task.start, task.end];
    }).toEqual([addDays(original.start, result), addDays(original.end, result)]);
  });
}

for (const [view, distance, result, wideTaskEnd] of [
  ['Day', 2.7, 3, null], ['Week', 2.7, 3, null], ['Month', 9, 7, null],
  ['Quarter', 9, 7, '2027-01-20'], ['Year', 35, 30, '2027-10-20'],
]) {
  test(`${view} automatic snapping uses a ${view === 'Year' ? 30 : ['Month', 'Quarter'].includes(view) ? 7 : 1}-day step`, async ({ page }) => {
    const model = fixture();
    if (wideTaskEnd) model.projects[0].phases[0].end = wideTaskEnd;
    await mount(page, model);
    const original = model.projects[0].phases[0];
    await choose(page, view, 'auto');
    await moveTask(page, distance);
    await expect.poll(async () => {
      const task = await firstTask(page);
      return [task.start, task.end];
    }).toEqual([addDays(original.start, result), addDays(original.end, result)]);
  });
}

test('left and right expansion and contraction are independent and keep visible task positions', async ({ page }) => {
  const model = await mount(page);
  await choose(page);
  const originalBox = await positionTask(page);
  const padding = () => page.evaluate(() => ({
    left: Number(localStorage.getItem('drag.leftPaddingMonths')),
    right: Number(localStorage.getItem('drag.rightPaddingMonths')),
  }));
  const initial = await padding();
  for (const [action, expected] of [
    ['expand-left', { left: initial.left + 3, right: initial.right }],
    ['expand-right', { left: initial.left + 3, right: initial.right + 3 }],
    ['shrink-left', { left: initial.left, right: initial.right + 3 }],
    ['shrink-right', initial],
  ]) {
    await clickAction(page,action);
    await settle(page);
    expect(await padding()).toEqual(expected);
    const nextBox = await bar(page).boundingBox();
    expect(Math.abs(nextBox.x - originalBox.x)).toBeLessThanOrEqual(2);
    expect(await draft(page)).toEqual(model);
  }
});

for (const side of ['left', 'right']) {
  test(`active drag pans ${side} with a stationary pointer and stops after release outside`, async ({ page }) => {
    test.setTimeout(90000); // Slow Windows runners can spend tens of seconds delivering pointer moves.
    const model = await mount(page);
    await choose(page);
    const taskBox = await positionTask(page);
    const viewport = await page.locator('.preview').boundingBox();
    const beforeScroll = await page.locator('.preview').evaluate(element => element.scrollLeft);
    await page.mouse.move(taskBox.pointer.x, taskBox.pointer.y);
    await page.mouse.down();
    await expect(page.locator('#gantt')).toHaveClass(/is-dragging/);
    await page.mouse.move(side === 'left' ? viewport.x + 5 : viewport.x + viewport.width - 5, taskBox.y + taskBox.height / 2, { steps: 8 });
    // No further mouse movement: animation frames must drive the auto-pan.
    await expect.poll(() => page.locator('.preview').evaluate(element => element.scrollLeft), { timeout: 5000 }).not.toBe(beforeScroll);
    const firstScroll = await page.locator('.preview').evaluate(element => element.scrollLeft);
    await expect.poll(async () => Math.abs(await page.locator('.preview').evaluate(element => element.scrollLeft) - firstScroll), { timeout: 5000 }).toBeGreaterThan(40);
    expect(await draft(page)).toEqual(model); // preview changes must not commit mid-drag
    await page.mouse.move(side === 'left' ? viewport.x + 5 : viewport.x + viewport.width - 5, 4);
    await page.mouse.up();
    await settle(page);
    const after = await firstTask(page);
    expect(side === 'left' ? after.start < model.projects[0].phases[0].start : after.start > model.projects[0].phases[0].start).toBe(true);
    expect(duration(after)).toBe(duration(model.projects[0].phases[0]));
    const stopped = await page.locator('.preview').evaluate(element => element.scrollLeft);
    await page.waitForTimeout(180);
    expect(await page.locator('.preview').evaluate(element => element.scrollLeft)).toBe(stopped);
  });
}

test('Escape cancels pending drag, preserves data and does not add undo history', async ({ page }) => {
  const model = await mount(page);
  await choose(page);
  const box = await positionTask(page);
  await page.mouse.move(box.pointer.x, box.pointer.y);
  await page.mouse.down();
  await expect(page.locator('#gantt')).toHaveClass(/is-dragging/);
  await page.mouse.move(box.pointer.x + 100, box.pointer.y, { steps: 8 });
  expect(await draft(page)).toEqual(model);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await draft(page)).toEqual(model);
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  expect(await draft(page)).toEqual(model);
  await page.reload();
  await expect(bar(page)).toBeVisible();
  expect(await draft(page)).toEqual(model);
});

test('JSON import/export roundtrip persists; invalid import leaves the current draft unchanged', async ({ page }) => {
  const model = await mount(page);
  const downloadPromise = page.waitForEvent('download');
  await globalClick(page,'save');
  const download = await downloadPromise;
  expect(JSON.parse(await readFile(await download.path(), 'utf8'))).toEqual(model);
  const imported = copy(model);
  imported.title = '使用者另存專案';
  imported.projects[0].phases[0].label = '手動匯入名稱';
  imported.projects[0].phases[0].custom.imported = ['retained'];
  await page.locator('#import').setInputFiles({ name: 'roadmap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect.poll(() => draft(page)).toEqual(imported);
  await page.reload();
  await expect(bar(page)).toBeVisible();
  expect(await draft(page)).toEqual(imported);
  const invalid = copy(imported);
  invalid.projects[0].phases[0].end = '2026-01-01';
  const alertPromise = page.waitForEvent('dialog').then(async dialog => { const message = dialog.message(); await dialog.dismiss(); return message; });
  await page.locator('#import').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  expect(await alertPromise).toMatch(/失敗|日期|晚於/);
  expect(await draft(page)).toEqual(imported);
});

test('cross-project tree drag preserves stable ids, locks and arbitrary metadata', async ({ page }) => {
  const model = await mount(page);
  const original = copy(model.projects[0].phases[0]);
  const source = page.locator('.tree-item.phase[data-p="0"][data-f="0"]');
  const target = page.locator('.project[data-p="1"] > .tree-item[data-select-p="1"]');
  await source.dragTo(target);
  const expected = copy(model);
  expected.projects[0].phases.shift();
  expected.projects[1].phases.push({ ...original, locks: { ...original.locks, parent: true } });
  await expect.poll(() => draft(page)).toEqual(expected);
  await page.reload();
  await expect(bar(page)).toBeVisible();
  expect(await draft(page)).toEqual(expected);
});

test('SVG and PNG downloads contain visible colored task content', async ({ page }, testInfo) => {
  await mount(page);
  const svgPromise = page.waitForEvent('download');
  await globalClick(page,'svg');
  const svgDownload = await svgPromise;
  await svgDownload.saveAs(testInfo.outputPath('roadmap.svg'));
  const svg = await readFile(await svgDownload.path(), 'utf8');
  expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
  expect(await page.evaluate(xml => {
    const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml');
    return {
      errors: parsed.querySelectorAll('parsererror').length,
      bars: parsed.querySelectorAll('rect.bar').length,
      sized: Array.from(parsed.querySelectorAll('rect.bar')).every(element => Number(element.getAttribute('width')) > 0),
    };
  }, svg)).toEqual({ errors: 0, bars: taskCount, sized: true });
  expect(await page.evaluate(xml=>new DOMParser().parseFromString(xml,'image/svg+xml').querySelector('rect.bar').style.fill,svg)).toBe(expectedColor);
  const pngPromise = page.waitForEvent('download');
  await globalClick(page,'png');
  const pngDownload = await pngPromise;
  await pngDownload.saveAs(testInfo.outputPath('roadmap.png'));
  await page.screenshot({path:testInfo.outputPath('editor.png'), fullPage:true});
  const png = await readFile(await pngDownload.path());
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);
  expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  const coloredPixels = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = Math.max(1, Math.round(image.height * 800 / image.width));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (pixels[i + 3] > 128 && max - min > 40 && min < 200) colored++;
    }
    return colored;
  }, png.toString('base64'));
  expect(coloredPixels).toBeGreaterThan(100);
});
