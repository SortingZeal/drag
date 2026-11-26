import { selectTimelineScale, globalClick, clickAction, selectSnap, openViewOptions, openViewSection, currentDocument, chooseDocument } from './global-actions.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { expect } from '@playwright/test';

// Run against the actual packaged executable. Each case receives a disposable
// profile; neither Chrome's draft nor the normal desktop profile is touched.
const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = process.env.DRAG_DESKTOP_EXECUTABLE || path.join(root, process.platform === 'win32' ? 'release/drag-win32-x64/drag.exe' : 'release/drag.app/Contents/MacOS/drag');
const modKey=process.platform==='darwin'?'Meta':'Control';
const version=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version;
const evidence = process.env.DRAG_DESKTOP_EVIDENCE || path.join(root, `docs/evidence/v${version.replace(/\.0$/,'')}/desktop`);
const seedPath = path.join(root, 'public/roadmap.json');
const seedBytes = await readFile(seedPath);
const seed = JSON.parse(seedBytes);
const seedHash = createHash('sha256').update(seedBytes).digest('hex');
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const bar = (page, id = 'desktop-phase-0-0') => page.locator(`.bar-wrapper[data-id="${id}"] .bar`).first();
const shift = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const duration = phase => (Date.parse(phase.end) - Date.parse(phase.start)) / 86400000 + 1;

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { source: 'packaged-desktop-test', nested: ['保留', { value: 58 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `desktop-project-${pi}`;
    project.locks = { ...project.locks, color: true, name: true };
    project.metadata = { preserved: ['project', pi] };
    project.phases.forEach((phase, fi) => {
      phase.id = `desktop-phase-${pi}-${fi}`;
      phase.locks = { ...phase.locks, label: true };
      phase.metadata = { preserved: ['phase', pi, fi] };
    });
  });
  return model;
}

async function launch(profile) {
  const instance = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 30000 });
  const page = await instance.firstWindow();
  page.setDefaultTimeout(10000);
  try { await expect(action(page, 'timeline')).toBeVisible({ timeout: 20000 }); }
  catch (error) {
    const state = await Promise.allSettled([
      page.evaluate(() => ({ url: location.href, readyState: document.readyState, body: document.body?.innerText.slice(0, 300) })),
      instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), visible: window.isVisible() }))),
    ]);
    console.error('Desktop launch state:', JSON.stringify(state.map(item => item.status === 'fulfilled' ? item.value : String(item.reason))));
    throw error;
  }
  if(await page.locator('#quick-tour').isVisible())await page.locator('[data-tour-action="skip"]').click();
  assert.equal(page.url(), 'app://bundle/index.html');
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
  await page.bringToFront();
  await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(true);
  return { instance, page };
}

async function isolated(t) {
  await access(executablePath);
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(path.join(os.tmpdir(),'drag-desktop-test-'));
  const profile = path.join(directory, 'profile');
  const running = await launch(profile);
  const errors = [];
  running.page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    await running.instance.close();
    assert.deepEqual(errors, [], 'renderer must not throw');
    assert.equal(createHash('sha256').update(await readFile(seedPath)).digest('hex'), seedHash, 'seed must remain byte-identical');
    await rm(directory, { recursive: true, force: true });
  });
  return { ...running, directory, profile, errors };
}

async function importModel(page, model = fixture()) {
  const pending = page.waitForEvent('filechooser');
  await clickAction(page, 'import');
  const chooser = await pending;
  await chooser.setFiles({ name: 'desktop-roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect.poll(() => draft(page)).toEqual(model);
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  // Open adds a separate file. Reload proves the imported draft was persisted
  // and starts subsequent interactions from an explicit empty-history baseline.
  await page.reload();
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  assert.deepEqual(await draft(page), model);
  await expect(action(page, 'undo')).toBeDisabled();
  await expect(action(page, 'redo')).toBeDisabled();
  return model;
}

async function selectFirstTask(page) {
  if (await page.locator('main').getAttribute('data-view') === 'simple') {
    await page.locator('.picture-canvas [data-phase-index]').first().press('Enter');
  } else {
    await page.locator('#tree [data-select-f="0:0"] .tree-label').click();
  }
  await expect(page.locator('.bottom')).toBeVisible();
}

async function positionTask(page) {
  await bar(page).evaluate(element => {
    const preview = document.querySelector('.preview');
    const target = element.getBoundingClientRect();
    const box = preview.getBoundingClientRect();
    preview.scrollLeft += target.left - box.left - box.width * 0.32;
    preview.scrollTop += target.top - box.top - 110;
  });
  await settle(page);
  const box = await bar(page).boundingBox();
  assert.ok(box);
  const pointer = await bar(page).evaluate(element => {
    const r = element.getBoundingClientRect(), viewport = document.querySelector('.preview'), v = viewport.getBoundingClientRect();
    const left = Math.max(r.left, v.left + viewport.clientLeft + 12), right = Math.min(r.right, v.left + viewport.clientLeft + viewport.clientWidth - 12);
    const x = left + Math.min(80, (right - left) / 2), y = r.top + r.height / 2;
    return { x, y, visibleWidth: right - left, hit: document.elementFromPoint(x, y)?.closest('.bar-wrapper')?.getAttribute('data-id') };
  });
  assert.ok(pointer.visibleWidth > 0, 'the gesture starts on the visible part of the bar');
  assert.equal(pointer.hit, 'desktop-phase-0-0', 'hit testing confirms the real bar before pointer input');
  return { ...box, pointer };
}

async function download(instance, page, directory, name) {
  // This deliberately bypasses only the OS save panel to verify real Electron
  // DownloadItem output. It is not evidence that native panels were exercised.
  const prefix = path.resolve(directory) + path.sep;
  await instance.evaluate(({ session }, prefix) => {
    globalThis.__dragDownload = null;
    session.defaultSession.once('will-download', (_event, item) => {
      const filename = item.getFilename();
      const target = prefix + filename;
      globalThis.__dragDownload = { filename, target, state: 'started' };
      item.setSavePath(target);
      item.once('done', (_event, state) => { globalThis.__dragDownload.state = state; });
    });
  }, prefix);
  await clickAction(page, name);
  await expect.poll(() => instance.evaluate(() => globalThis.__dragDownload?.state), { timeout: 20000 }).toBe('completed');
  const result = await instance.evaluate(() => globalThis.__dragDownload);
  assert.equal(path.dirname(result.target), path.resolve(directory));
  assert.equal(path.basename(result.target), result.filename);
  return { ...result, bytes: await readFile(result.target) };
}

test('packaged app loads offline seed with isolated renderer, CSP and blocked external navigation', { timeout: 60000 }, async t => {
  const { instance, page } = await isolated(t);
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  const initial = await draft(page);
  assert.equal(initial.projects.length, 7);
  assert.deepEqual(initial.projects.map(project => ({ name: project.name, color: project.color, icon: project.icon, phases: project.phases.map(({ label, start, end }) => ({ label, start, end })) })), seed.projects.map(project => ({ name: project.name, color: project.color, icon: project.icon, phases: project.phases.map(({ label, start, end }) => ({ label, start, end })) })));
  assert.deepEqual(await page.evaluate(async () => (await fetch('/roadmap.json')).json()), seed);
  assert.deepEqual(await page.evaluate(() => [typeof require, typeof process, typeof Buffer]), ['undefined', 'undefined', 'undefined']);
  const preferences = await instance.evaluate(({ BrowserWindow, app }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity, packaged: app.isPackaged, data: app.getPath('userData') };
  });
  assert.deepEqual({ sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity, packaged: preferences.packaged }, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, packaged: true });
  assert.equal(path.basename(preferences.data), 'profile');
  assert.match(path.basename(path.dirname(preferences.data)), /^drag-desktop-test-/);
  const csp = await page.evaluate(async () => (await fetch('/index.html')).headers.get('Content-Security-Policy'));
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.equal(await page.evaluate(async () => { try { await fetch('https://example.com/'); return 'allowed'; } catch { return 'blocked'; } }), 'blocked');
  assert.equal(await instance.evaluate(async ({ net }) => { try { await net.fetch('https://example.com/', { signal: AbortSignal.timeout(5000) }); return 'allowed'; } catch { return 'blocked'; } }), 'blocked');
  await page.evaluate(() => { window.open('https://example.com/'); });
  await expect.poll(() => instance.windows().length).toBe(1);
  const prevented = instance.evaluate(({ BrowserWindow }) => new Promise(resolve => BrowserWindow.getAllWindows()[0].webContents.once('will-navigate', event => resolve(event.defaultPrevented))));
  await page.evaluate(() => { window.location.href = 'https://example.com/'; });
  assert.equal(await prevented, true);
  assert.equal(page.url(), 'app://bundle/index.html');
  assert.deepEqual(await draft(page), initial);
  await page.screenshot({ path: path.join(evidence, 'packaged-timeline.png'), fullPage: true });
});

test('desktop JSON import, both modes and new-project layout retain manual data and clean copy', { timeout: 60000 }, async t => {
  const { page } = await isolated(t);
  const model = await importModel(page);
  await page.setViewportSize({ width: 1166, height: 952 });
  await expect(page.locator('.bottom')).toBeHidden();
  await selectFirstTask(page);
  for (const mode of ['simple', 'timeline']) {
    await clickAction(page, mode);
    if (mode === 'simple') {
      await expect(page.locator('.infographic-preview svg')).toBeVisible();
      await expect(page.locator('aside, .sidebar-resizer')).toHaveCount(0);
      const main=await page.locator('main').boundingBox(),preview=await page.locator('.preview').boundingBox();
      assert.ok(Math.abs(preview.x-main.x)<=1 && Math.abs(preview.width-main.width)<=1);
      await selectFirstTask(page);
      await expect(page.locator('#editor [data-field="label"]')).toHaveValue(model.projects[0].phases[0].label);
      await page.screenshot({path:path.join(evidence,'packaged-full-width-picture.png'),fullPage:true});
      assert.deepEqual(await draft(page),model);
      continue;
    }
    await selectFirstTask(page);
    await settle(page);
    const layout = await page.evaluate(() => {
      const side = document.querySelector('aside'), main = document.querySelector('main');
      const box = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
      return { direct: side.parentElement === main, side: box(side), main: box(main), preview: box(main.querySelector(':scope > .timeline-shell, :scope > .preview')), editor: box(document.querySelector('#editor')) };
    });
    assert.equal(layout.direct, true);
    assert.ok(Math.abs(layout.side.width - 224) <= 1);
    assert.ok(Math.abs(layout.side.y - layout.main.y) <= 1);
    assert.ok(Math.abs(layout.side.bottom - layout.main.bottom) <= 1);
    assert.ok(layout.preview.x >= layout.side.right - 1);
    assert.ok(layout.editor.x >= layout.side.right - 1);
    await page.screenshot({ path: path.join(evidence, `packaged-${mode}-sidebar.png`), fullPage: true });
    assert.deepEqual(await draft(page), model);
    await expect(page.locator('.hint, .save-state, .action-status, button[title]:not([aria-label]), input[title], select[title]')).toHaveCount(0);
  }
  const selectors = ['header', '.toolbar', 'main', '.preview', 'aside'];
  const rectangles = () => page.evaluate(values => Object.fromEntries(values.map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
    return [selector, { x, y, width, height }];
  })), selectors);
  await settle(page);
  const before = await rectangles();
  await clickAction(page, 'newproject');
  await settle(page);
  const after = await rectangles();
  for (const selector of selectors) for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(after[selector][key] - before[selector][key]) <= 1, `${selector}.${key} remains stable`);
  const added = await draft(page);
  assert.equal(added.projects.length, model.projects.length + 1);
  assert.deepEqual(added.projects.slice(0, model.projects.length), model.projects);
  assert.deepEqual(added.metadata, model.metadata);
  await clickAction(page, 'undo');
  assert.deepEqual(await draft(page), model);
  await page.screenshot({ path: path.join(evidence, 'packaged-layout.png'), fullPage: true });
});

test('desktop drag snaps to seven days, resize and padding retain metadata, dates and undo', { timeout: 60000 }, async t => {
  const { page } = await isolated(t);
  const model = await importModel(page);
  await selectTimelineScale(page, 'Day');
  await selectSnap(page,'7d');
  await settle(page);
  const original = model.projects[0].phases[0];
  let box = await positionTask(page);
  const perDay = box.width / duration(original);
  await page.mouse.move(box.pointer.x, box.pointer.y);
  await page.mouse.down();
  await expect(page.locator('#gantt')).toHaveClass(/is-dragging/);
  await page.mouse.move(box.pointer.x + 5 * perDay, box.pointer.y, { steps: 8 });
  assert.deepEqual(await draft(page), model, 'drag does not commit before release');
  await page.mouse.up();
  const moved = await draft(page);
  assert.equal(moved.projects[0].phases[0].start, shift(original.start, 7));
  assert.equal(moved.projects[0].phases[0].end, shift(original.end, 7));
  assert.deepEqual(moved.projects[0].phases[0].metadata, original.metadata);
  assert.equal(moved.projects[0].phases[0].locks.label, true);
  assert.equal(moved.projects[0].phases[0].locks.start, true);
  assert.equal(moved.projects[0].phases[0].locks.end, true);
  await clickAction(page, 'undo');
  assert.deepEqual(await draft(page), model);
  await expect(action(page, 'undo')).toBeDisabled();
  await selectSnap(page,'1d');
  await positionTask(page);
  await page.locator('.bar-wrapper[data-id="desktop-phase-0-0"] .handle.right').evaluate(node=>{const p=document.querySelector('.preview'),r=node.getBoundingClientRect(),v=p.getBoundingClientRect();if(r.right>v.right-220)p.scrollLeft+=r.right-v.right+240;});await settle(page);
  const handle = await page.locator('.bar-wrapper[data-id="desktop-phase-0-0"] .handle.right').boundingBox();
  assert.ok(handle);
  box = await bar(page).boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 2 * box.width / duration(original), handle.y + handle.height / 2, { steps: 8 });
  await page.mouse.up();
  const resized = await draft(page);
  assert.equal(resized.projects[0].phases[0].start, original.start);
  assert.equal(resized.projects[0].phases[0].end, shift(original.end, 2));
  await clickAction(page, 'undo');
  assert.deepEqual(await draft(page), model);
  await positionTask(page);
  // A fresh profile uses the editor's six-month defaults before first persist.
  const padding = () => page.evaluate(() => [Number(localStorage.getItem('drag.leftPaddingMonths') ?? 6), Number(localStorage.getItem('drag.rightPaddingMonths') ?? 6)]);
  const initial = await padding();
  for (const [name, expected] of [['expand-left', [initial[0] + 3, initial[1]]], ['expand-right', [initial[0] + 3, initial[1] + 3]], ['shrink-left', [initial[0], initial[1] + 3]], ['shrink-right', initial]]) {
    await clickAction(page, name);
    await settle(page);
    assert.deepEqual(await padding(), expected);
    assert.deepEqual(await draft(page), model);
  }
});

for (const side of ['left', 'right']) test(`desktop drag auto-pans ${side} with stationary pointer and stops on cancellation`, { timeout: 60000 }, async t => {
  const { instance, page } = await isolated(t);
  const model = await importModel(page);
  await selectTimelineScale(page, 'Day');
  await selectSnap(page,'1d');
  // Establish native focus and a started drag before measuring stationary
  // pointer movement; retain event evidence if either interaction fails.
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await page.evaluate(() => {
    window.__autoPanTrace = [];
    for (const type of ['focus', 'blur', 'pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      window.addEventListener(type, event => {
        window.__autoPanTrace.push({ type, at: performance.now(), x: event.clientX, y: event.clientY,
          pointer: event.pointerId, target: event.target?.id || event.target?.classList?.value,
          focused: document.hasFocus(), dragging: document.querySelector('#gantt').classList.contains('is-dragging'),
          scroll: document.querySelector('.preview').scrollLeft });
      }, true);
    }
  });
  try {
    const box = await positionTask(page);
    const preview = await page.locator('.preview').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x+node.clientLeft,width:node.clientWidth};});
    const scroll = () => page.locator('.preview').evaluate(element => element.scrollLeft);
    await page.mouse.move(box.pointer.x, box.pointer.y);
    await page.mouse.down();
    await expect(page.locator('#gantt')).toHaveClass(/is-dragging/);
    await page.mouse.move(side === 'left' ? preview.x + 5 : preview.x + preview.width - 5, box.pointer.y, { steps: 8 });
    const first = await scroll();
    await expect.poll(async () => Math.abs(await scroll() - first), { timeout: 5000 }).toBeGreaterThan(40);
    assert.deepEqual(await draft(page), model);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page);
    const stopped = await scroll();
    await page.waitForTimeout(180);
    assert.equal(await scroll(), stopped);
    assert.deepEqual(await draft(page), model);
    await expect(action(page, 'undo')).toBeDisabled();
  } catch (error) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ focused: document.hasFocus(),
      dragging: document.querySelector('#gantt')?.classList.contains('is-dragging'), trace: window.__autoPanTrace })), null, 2));
    throw error;
  }
});

test('desktop DownloadItem writes exact JSON and real SVG, PNG and GIF in both modes', { timeout: 120000 }, async t => {
  const { instance, page, directory } = await isolated(t);
  const model = fixture();
  Object.assign(model.projects[0].phases[0], { status: '進行中', progress: 35 });
  await importModel(page, model);
  const json = await download(instance, page, directory, 'save');
  assert.equal(json.filename, 'desktop-roundtrip.json');
  assert.deepEqual(JSON.parse(json.bytes), model);
  await expect(action(page, 'save')).toHaveText('儲存專案');
  await expect(action(page, 'import')).toHaveText('開啟專案');
  await expect(page.locator('header #global-action-menu[role="menu"]')).toHaveCount(1);
  await expect(page.locator('header #image-export-menu[role="menu"]')).toHaveCount(1);
  await expect(page.locator('header details.view-settings')).toHaveCount(1);
  await expect(action(page, 'undo')).toBeDisabled();
  for (const [mode, filename] of [['simple', 'drag-simple'], ['timeline', 'drag-roadmap']]) {
    await clickAction(page, mode);
    await page.locator('[data-action="export-menu"]').click();
    await expect(page.locator('.report-download,[data-action="infographic-png"],[data-action="infographic-svg"]')).toHaveCount(0);
    for (const name of ['svg', 'png', 'gif']) {
      await expect(action(page, name)).toHaveCount(1);
      await expect(page.locator(`header [data-action="${name}"]`)).toBeVisible();
    }
    await expect(action(page, 'svg')).toHaveText('匯出 SVG');
    await expect(action(page, 'png')).toHaveText(mode === 'timeline' ? '匯出 PNG' : '匯出 PNG · 4K');
    const gif = await download(instance, page, directory, 'gif');
    assert.equal(gif.filename, filename + '.gif');
    assert.equal(gif.bytes.subarray(0, 6).toString(), 'GIF89a');
    assert.ok(gif.bytes.includes(Buffer.from('NETSCAPE2.0')), 'animation loops');
    const svg = await download(instance, page, directory, 'svg');
    assert.equal(svg.filename, `${filename}.svg`);
    const parsed = await page.evaluate(xml => {
      const document = new DOMParser().parseFromString(xml, 'image/svg+xml');
      return { errors: document.querySelectorAll('parsererror').length, tag: document.documentElement.tagName, text: document.documentElement.textContent, width: Number(document.documentElement.getAttribute('width')), height: Number(document.documentElement.getAttribute('height')), phases: document.querySelectorAll('g[data-phase-id]').length };
    }, svg.bytes.toString());
    assert.equal(parsed.errors, 0);
    assert.equal(parsed.tag, 'svg');
    assert.ok(parsed.width > 0 && parsed.height > 0);
    assert.ok(parsed.text.includes(model.projects[0].phases[0].label));
    const png = await download(instance, page, directory, 'png');
    assert.equal(png.filename, `${filename}.png`);
    assert.equal(png.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    if (mode !== 'timeline') {
      assert.equal(png.bytes.readUInt32BE(16), 3840);
      assert.equal(png.bytes.readUInt32BE(20), 2160);
      assert.equal(parsed.width, 3840);
      assert.equal(parsed.height, 2160);
      if (mode === 'simple') assert.equal(parsed.phases, 15);
    }
    const colored = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 960, 540);
      const data = context.getImageData(0, 0, 960, 540).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 250 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 45) count++;
      return count;
    }, png.bytes.toString('base64'));
    assert.ok(colored > 1000, `${mode} PNG contains visible colored content`);
    assert.deepEqual(await draft(page), model);
    if (mode === 'simple') {
      await page.screenshot({ path: path.join(evidence, 'packaged-simple.png'), fullPage: true });
      await import('node:fs/promises').then(({ copyFile }) => Promise.all([copyFile(png.target, path.join(evidence, 'packaged-simple-export.png')), copyFile(svg.target, path.join(evidence, 'packaged-simple-export.svg'))]));
    }
  }
});

test('desktop draft, locks and UI preferences survive a complete app exit and relaunch', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'drag-desktop-test-'));
  const profile = path.join(directory, 'profile');
  let running;
  t.after(async () => { if (running) await running.instance.close(); await rm(directory, { recursive: true, force: true }); });
  running = await launch(profile);
  const model = await importModel(running.page);
  await selectFirstTask(running.page);
  const label = running.page.locator('#editor [data-field="label"]');
  await label.fill('桌面重開：保留手動設定');
  await label.press('Tab');
  const edited = await draft(running.page);
  assert.equal(edited.projects[0].phases[0].locks.label, true);
  assert.deepEqual(edited.metadata, model.metadata);
  await selectSnap(running.page,'7d');
  await clickAction(running.page, 'expand-left');
  await clickAction(running.page, 'expand-right');
  await running.page.setViewportSize({width:1024,height:700});
  await selectFirstTask(running.page);
  const originalWidth = (await running.page.locator('.bottom').boundingBox()).width;
  const split = await running.page.locator('#split').boundingBox();
  await running.page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await running.page.mouse.down();
  await running.page.mouse.move(split.x + split.width / 2 + 48, split.y + split.height / 2, { steps: 8 });
  await running.page.mouse.up();
  const preferences = await running.page.evaluate(() => Object.fromEntries(['drag.snap', 'drag.leftPaddingMonths', 'drag.rightPaddingMonths', 'drag.inspectorWidth'].map(key => [key, localStorage.getItem(key)])));
  assert.equal(preferences['drag.snap'], '7d');
  assert.equal(Number(preferences['drag.inspectorWidth']), originalWidth + 48);
  await running.instance.close();
  running = null;
  running = await launch(profile);
  assert.deepEqual(await draft(running.page), edited);
  assert.deepEqual(await running.page.evaluate(() => Object.fromEntries(['drag.snap', 'drag.leftPaddingMonths', 'drag.rightPaddingMonths', 'drag.inspectorWidth'].map(key => [key, localStorage.getItem(key)]))), preferences);
  await expect(running.page.locator('#snap')).toHaveValue('7d');
  await expect(running.page.locator('.bottom')).toBeHidden();
  await selectFirstTask(running.page);
  assert.equal((await running.page.locator('.bottom').boundingBox()).width, originalWidth + 48);
  await expect(running.page.locator('#editor [data-field="label"]')).toHaveValue('桌面重開：保留手動設定');
  assert.equal(createHash('sha256').update(await readFile(seedPath)).digest('hex'), seedHash);
});

test('packaged date strip is above the scrolling task body, pans dates, and never intercepts the editor', { timeout: 60000 }, async t => {
  const { instance, page } = await isolated(t);
  // Keep part of the task list below the fold, even on a tall display.
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 700));
  const model = await importModel(page);
  await selectTimelineScale(page, 'Day');
  await settle(page);
  const preview = page.locator('.preview');
  const position = () => preview.evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop }));
  const assertDateDock = async () => {
    const geometry = await page.evaluate(() => {
      const shell = document.querySelector('.timeline-shell');
      const dock = document.querySelector('.timeline-date-dock');
      const header = document.querySelector('.grid-header');
      const preview = document.querySelector('.preview');
      const rect = node => {
        const { x, y, width, height, bottom } = node.getBoundingClientRect();
        return { x, y, width, height, bottom };
      };
      const dockRect = dock.getBoundingClientRect();
      const samples = [0.15, 0.5, 0.85].flatMap(x => [0.25, 0.75].map(y => {
        const stack = document.elementsFromPoint(dockRect.x + dockRect.width * x, dockRect.y + dockRect.height * y);
        return {
          headerHit: stack.some(node => node.closest?.('.timeline-date-dock')),
          taskBodyHit: stack.some(node => node.closest?.('.preview,.bar-wrapper,svg.gantt')),
        };
      }));
      return {
        shell: rect(shell), dock: rect(dock), header: rect(header), preview: rect(preview),
        headerInPreview: !!preview.querySelector('.grid-header'),
        headerPosition: getComputedStyle(header).position,
        headerBackground: getComputedStyle(header).backgroundColor,
        samples,
      };
    });
    assert.ok(Math.abs(geometry.dock.y - geometry.shell.y) <= 1, 'the date dock starts above the task viewport');
    assert.ok(geometry.dock.bottom <= geometry.preview.y + 1, 'date and task viewports occupy separate vertical bands');
    assert.ok(Math.abs(geometry.header.y - geometry.dock.y) <= 1, 'date labels stay at the top of their own dock');
    assert.equal(geometry.headerInPreview, false, 'dates are physically outside the scrolling task body');
    assert.equal(geometry.headerPosition, 'relative');
    assert.match(geometry.headerBackground, /^rgb\(/, 'date header has an opaque background');
    assert.deepEqual(geometry.samples, Array.from({ length: 6 }, () => ({ headerHit: true, taskBodyHit: false })), 'task bars cannot paint or intercept pointers in the date strip');
    return geometry;
  };
  await expect(page.locator('.timeline-shell > .timeline-date-dock')).toBeVisible();
  const dockBefore = await assertDateDock();
  const viewport = await preview.boundingBox();
  const header = await page.locator('.grid-header').boundingBox();
  const start = { x: viewport.x + viewport.width * 0.5, y: header.y + header.height * 0.72 };
  const initial = await position();
  const task = await bar(page).boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 180, start.y, { steps: 10 });
  await page.mouse.up();
  await settle(page);
  const moved = await position();
  assert.ok(Math.abs(moved.left - initial.left - 180) <= 1, 'date-strip drag moves the complete timeline');
  assert.equal(moved.top, initial.top);
  assert.ok(Math.abs((await bar(page).boundingBox()).x - task.x + 180) <= 1, 'task bars follow the date strip');
  assert.deepEqual(await preview.evaluate(node => ({ x: getComputedStyle(node).overflowX, y: getComputedStyle(node).overflowY })), { x: 'hidden', y: 'auto' });

  await preview.evaluate(node => { node.scrollTop += 180; });
  await settle(page);
  const scrolledTop = (await position()).top;
  assert.ok(scrolledTop > initial.top + 100, 'the task body really scrolls vertically');
  const dockAfter = await assertDateDock();
  assert.ok(Math.abs(dockAfter.header.y - dockBefore.header.y) <= 1, 'vertical task scrolling cannot move the date strip');
  await page.screenshot({ path: path.join(evidence, 'packaged-date-dock-after-task-scroll.png'), fullPage: true });

  await selectFirstTask(page);
  const editor = await page.locator('#editor').boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(editor.x + 12, editor.y + 80, { steps: 12 });
  const outsideHits = await page.evaluate(() => {
    const split = document.querySelector('.split').getBoundingClientRect();
    const editor = document.querySelector('#editor').getBoundingClientRect();
    return [[split.x + split.width * 0.7, split.y + split.height / 2], [editor.x + editor.width * 0.7, editor.y + 50]].map(([x, y]) => ({
      inspectorHit: !!document.elementFromPoint(x, y)?.closest('#editor,#split'),
      headerIntercepts: !!document.elementFromPoint(x, y)?.closest('.timeline-date-dock,.grid-header'),
    }));
  });
  assert.deepEqual(outsideHits, [{ inspectorHit: true, headerIntercepts: false }, { inspectorHit: true, headerIntercepts: false }]);
  await page.screenshot({ path: path.join(evidence, 'packaged-date-strip-contained-during-drag.png'), fullPage: true });
  await page.mouse.up();
  await settle(page);
  assert.equal((await position()).top, scrolledTop, 'vertical pointer travel never drags the date strip into another panel');
  assert.ok(Math.abs((await page.locator('.grid-header').boundingBox()).y - header.y) <= 1);
  await expect(page.locator('#gantt')).not.toHaveClass(/is-panning-dates/);
  await page.setViewportSize({width:1024,height:700});
  const label = page.locator('#editor [data-field="label"]');
  await label.click();
  await expect(label).toBeFocused();
  const split = await page.locator('.split').boundingBox();
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await page.mouse.down();
  await page.mouse.move(split.x + split.width / 2 - 120, split.y + split.height / 2, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  await assertDateDock();
  await label.click();
  await expect(label).toBeFocused();
  await page.screenshot({ path: path.join(evidence, 'packaged-date-dock-minimum-pane.png'), fullPage: true });
  assert.deepEqual(await draft(page), model);
  await expect(action(page, 'undo')).toBeDisabled();
  await expect(action(page, 'redo')).toBeDisabled();
});

test('packaged 圖檔 pan in four directions at 100% and 25%, center/reset, and retain full 4K exports', { timeout: 120000 }, async t => {
  const { instance, page, directory } = await isolated(t);
  const model = await importModel(page);
  await expect(page.getByRole('button', {name:'簡報',exact:true})).toHaveCount(0);
  await expect(action(page, 'simple')).toHaveText('圖檔');
  const control = name => page.locator(`[data-picture-action="${name}"]`);
  const zoom = async () => Number.parseFloat(await page.locator('output[data-picture-zoom]').innerText());
  const geometry = () => page.evaluate(() => {
    const viewport = document.querySelector('.picture-viewport');
    const bounds = viewport.getBoundingClientRect();
    const svg = document.querySelector('.picture-canvas > svg').getBoundingClientRect();
    const box = node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { x: bounds.x + viewport.clientLeft, y: bounds.y + viewport.clientTop, width: viewport.clientWidth, height: viewport.clientHeight },
      image: { x: svg.x, y: svg.y, width: svg.width, height: svg.height },
      tools: box(document.querySelector('.picture-tools')),
      preview: box(document.querySelector('.preview')),
      split: box(document.querySelector('.split')),
    };
  });
  const centered = async () => {
    await settle(page);
    await expect.poll(async () => {
      const { image, viewport } = await geometry();
      return Math.max(Math.abs(image.x + image.width / 2 - viewport.x - viewport.width / 2), Math.abs(image.y + image.height / 2 - viewport.y - viewport.height / 2));
    }).toBeLessThanOrEqual(2);
  };
  for (const mode of ['simple']) {
    await clickAction(page, mode);
    await expect(page.locator('.picture-canvas > svg')).toBeVisible();
    assert.equal(await page.locator('.report-controls').evaluate(node => !!node.closest('.toolbar')), true, 'picture settings stay in the upper toolbar');
    await expect(page.locator('#editor [data-editor-section]')).toHaveCount(3);
    await expect(page.locator('.picture-tools')).toHaveAttribute('aria-label', '檢視操作');
    for (const name of ['放大', '縮小', '原尺寸', '適合視窗', '置中']) await expect(page.locator('.picture-tools').getByRole('button', { name, exact: true })).toBeVisible();
    await settle(page);
    const initial = await geometry();
    assert.ok(initial.image.width <= initial.viewport.width && initial.image.height <= initial.viewport.height, 'picture opens fitted');
    await control('actual').click();
    assert.equal(await zoom(), 100);
    assert.ok(Math.abs(await page.locator('.picture-canvas > svg').evaluate(svg => svg.getScreenCTM().a) - 1) < 0.0001, '100% preserves SVG design-unit text size in the packaged app');
    assert.equal(await page.locator('.picture-canvas').evaluate(node => getComputedStyle(node).transform), 'none');
    for (const percent of [100, 25]) {
      if (percent === 25) {
        await control('zoom-menu').click();
        await page.locator('[data-picture-zoom-level="0.25"]').click();
      }
      assert.equal(await zoom(), percent);
      for (const [direction, dx, dy] of [['right', 120, 0], ['left', -120, 0], ['down', 0, 70], ['up', 0, -70]]) {
        await control('center').click();
        assert.equal(await zoom(), percent, 'center retains zoom even when the fitted image has been panned');
        await centered();
        const beforePan = await geometry();
        const start = { x: beforePan.image.x + beforePan.image.width / 2, y: beforePan.image.y + beforePan.image.height / 2 };
        await page.keyboard.down('Shift');
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await expect(page.locator('.picture-viewport')).toHaveClass(/is-panning/);
        await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await settle(page);
        await expect(page.locator('.picture-viewport')).not.toHaveClass(/is-panning/);
        const afterPan = await geometry();
        assert.ok(Math.abs(afterPan.image.x - beforePan.image.x - dx) <= 2, `${mode} ${percent}% ${direction} horizontal pointer movement reaches the image`);
        assert.ok(Math.abs(afterPan.image.y - beforePan.image.y - dy) <= 2, `${mode} ${percent}% ${direction} vertical pointer movement reaches the image`);
        assert.equal(await zoom(), percent, 'panning does not change zoom');
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(afterPan.tools[key] - beforePan.tools[key]) <= 1, 'floating controls remain fixed during pointer panning');
        assert.deepEqual(await draft(page), model);
        await expect(action(page, 'undo')).toBeDisabled();
        await expect(action(page, 'redo')).toBeDisabled();
        if (direction === 'right') await page.screenshot({ path: path.join(evidence, `packaged-${mode}-${percent}-pointer-pan.png`), fullPage: true });
      }
      await control('center').click();
      assert.equal(await zoom(), percent);
      await centered();
    }
    await control('actual').click();
    assert.equal(await zoom(), 100);
    await centered();
    const slider = page.getByRole('slider', { name: '圖片縮放拉桿' });
    await expect(slider).toBeVisible();
    await slider.focus();
    await slider.press('Home');
    assert.equal(await zoom(), 10);
    await slider.press('End');
    assert.equal(await zoom(), 800);
    await control('actual').click();
    assert.equal(await zoom(), 100);
    await centered();
    const baseline = await geometry();
    await control('zoom-in').click();
    assert.equal(await zoom(), 110);
    await settle(page);
    const enlarged = await geometry();
    assert.ok(Math.abs(enlarged.image.width / baseline.image.width - 1.1) < 0.01);
    assert.ok(Math.abs(enlarged.image.height / baseline.image.height - 1.1) < 0.01);
    await control('zoom-out').click();
    assert.equal(await zoom(), 100);
    await control('zoom-menu').click();
    await expect(page.locator('.picture-zoom-menu [role="menuitemradio"]')).toHaveCount(24);
    await page.locator('[data-picture-zoom-level="8"]').click();
    assert.equal(await zoom(), 800);
    await expect(control('zoom-in')).toBeDisabled();
    await control('zoom-menu').click();
    await page.locator('[data-picture-zoom-level="4"]').click();
    assert.equal(await zoom(), 400);
    await expect(control('zoom-in')).toBeEnabled();
    await settle(page);
    const floating = await geometry();
    await page.locator('.picture-viewport').evaluate(node => {
      node.scrollLeft = (node.scrollWidth - node.clientWidth) * 0.8;
      node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.7;
    });
    await settle(page);
    const scrolled = await geometry();
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(scrolled.tools[key] - floating.tools[key]) <= 1, 'floating controls do not move with the image');
    assert.ok(scrolled.tools.x >= scrolled.preview.x && scrolled.tools.y >= scrolled.preview.y);
    assert.ok(scrolled.tools.x + scrolled.tools.width <= scrolled.preview.x + scrolled.preview.width + 1);
    assert.ok(scrolled.tools.y + scrolled.tools.height <= scrolled.preview.y + scrolled.preview.height + 1);
    await control('center').click();
    assert.equal(await zoom(), 400, 'center retains the chosen zoom');
    await centered();
    const png = await download(instance, page, directory, 'png');
    assert.equal(png.filename, `drag-simple.png`);
    assert.equal(png.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.bytes.readUInt32BE(16), 3840);
    assert.equal(png.bytes.readUInt32BE(20), 2160);
    await import('node:fs/promises').then(({ copyFile }) => copyFile(png.target, path.join(evidence, `packaged-${mode}-zoomed-4k.png`)));
    await page.screenshot({ path: path.join(evidence, `packaged-${mode}-floating-zoom.png`), fullPage: true });
    await control('reset').click();
    await centered();
    const reset = await geometry();
    assert.ok(reset.image.width <= reset.viewport.width + 2 && reset.image.height <= reset.viewport.height + 2, 'reset fits the complete image');
    assert.deepEqual(await draft(page), model);
    await expect(action(page, 'undo')).toBeDisabled();
    await expect(action(page, 'redo')).toBeDisabled();
    await expect(page.locator('.hint, .save-state, .action-status, button[title]:not([aria-label]), input[title], select[title]')).toHaveCount(0);
  }
  // A small window still leaves the whole floating dock usable.
  await page.setViewportSize({ width: 820, height: 480 });
  for (const mode of ['simple']) {
    await clickAction(page, mode);
    await settle(page);
    const small = await geometry();
    assert.ok(small.image.height >= 25, 'small panes retain a usable thumbnail');
    assert.ok(small.tools.y >= small.viewport.y && small.tools.y + small.tools.height <= small.preview.y + small.preview.height + 1);
    await control('actual').click();
    for (const name of ['zoom-in', 'zoom-out', 'center', 'reset', 'actual']) await control(name).click();
    await centered();
    assert.deepEqual(await draft(page), model);
    await page.screenshot({ path: path.join(evidence, `packaged-${mode}-minimum-pane.png`), fullPage: true });
  }
});


test('packaged project panel resizes, floats, returns left and remembers view preferences without changing project data', { timeout: 60000 }, async t => {
  const { instance, page } = await isolated(t);
  const model = await importModel(page);
  await globalClick(page, 'settings');
  await page.locator('[data-settings-category="workspace"]').click();
  await page.locator('[data-pref="startupMode"]').selectOption('last');
  await page.keyboard.press('Escape');
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await page.bringToFront();
  const side = page.locator('aside');
  const grab = async (locator, dx, dy) => {
    const rect = await locator.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2 + dy, { steps: 8 });
    await page.mouse.up(); await settle(page);
  };
  await grab(page.locator('.sidebar-resizer'), 100, 0);
  assert.ok(Math.abs((await side.boundingBox()).width - 324) <= 2);
  await grab(page.locator('.sidebar-heading'), 170, 80);
  await expect(side).toHaveClass(/is-floating/);
  const cornerHit = await page.locator('.sidebar-corner-resizer').evaluate(node => {
    const rect=node.getBoundingClientRect(),panel=node.closest('aside'),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    return {targetMatches:hit===node,hit:hit?.className,clientWidth:panel.clientWidth,offsetWidth:panel.offsetWidth,corner:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},focused:document.hasFocus()};
  });
  assert.ok(cornerHit.targetMatches,JSON.stringify(cornerHit));
  // Leave vertical room before growing the panel on shorter physical displays.
  await page.locator('.sidebar-corner-resizer').focus();
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await settle(page);
  const before = await side.boundingBox();
  await grab(page.locator('.sidebar-corner-resizer'), 100, 60);
  const after = await side.boundingBox();
  assert.ok(after.width - before.width > 60);
  assert.ok(after.height - before.height > 30);
  const beforeMode = await side.boundingBox();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('drag.sidebar')));
  assert.equal(saved.mode, 'floating');
  await clickAction(page, 'simple');
  await expect(side).toHaveCount(0);
  await expect(page.locator('.picture-canvas > svg')).toBeVisible();
  assert.deepEqual(await draft(page), model);
  await expect(action(page, 'undo')).toBeDisabled();
  await page.reload();
  await expect(page.locator('.picture-canvas > svg')).toBeVisible();
  await expect(side).toHaveCount(0);
  await clickAction(page,'timeline');
  await expect(side).toHaveClass(/is-floating/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.sidebar'))), saved);
  const reloaded = await side.boundingBox();
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(reloaded[key] - beforeMode[key]) <= 1, `reload preserves panel ${key}`);
  assert.deepEqual(await draft(page), model);
  await page.locator('[data-sidebar-action="dock"]').click();
  await expect(side).not.toHaveClass(/is-floating/);
  assert.ok(Math.abs((await side.boundingBox()).width - 324) <= 2);
  await grab(page.locator('.sidebar-heading'), 120, 60);
  await globalClick(page,'settings');await page.locator('[data-settings-category="workspace"]').click();await page.locator('[data-settings-action="reset-layout"]').click();await page.keyboard.press('Escape');
  await expect(side).not.toHaveClass(/is-floating/);
  assert.ok(Math.abs((await side.boundingBox()).width - 224) <= 2);
  assert.deepEqual(await draft(page), model);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('packaged Settings changes interface density while simple milestones visibly export stars', { timeout: 60000 }, async t => {
  const { instance, page, directory } = await isolated(t);
  const model = await importModel(page);
  const size = async value => { await globalClick(page,'settings'); await page.locator(`button[data-ui-size="${value}"]`).click();await page.keyboard.press('Escape'); await settle(page); };
  const font = () => action(page, 'save').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  const originalFont = await font();
  await size('small'); assert.ok(await font() < originalFont);
  await globalClick(page,'settings');
  const headerHeights=[];
  for (const density of ['compact','normal','comfortable']) {
    await page.locator('[data-pref="density"]').selectOption(density);
    await expect(page.locator('html')).toHaveAttribute('data-ui-density',density);
    headerHeights.push((await page.locator('.workspace-header').boundingBox()).height);
  }
  assert.ok(headerHeights[1]-headerHeights[0]>=12 && headerHeights[2]-headerHeights[1]>=12);
  await page.locator('[data-pref="density"]').selectOption('normal');
  await page.keyboard.press('Escape');
  await page.locator('[data-select-f="0:0"] .tree-label').click();
  for (const [preset,value] of [[3,'100'],[0,'0'],[2,''],[1,'']]) {
    await page.locator(`#editor [data-status-choice="${preset}"]`).click();
    await expect(page.locator('#editor [data-task-progress]')).toHaveValue(value);
  }
  for (let i=0;i<4;i++) await globalClick(page,'undo');
  assert.deepEqual(await draft(page), model); await expect(action(page, 'undo')).toBeDisabled();
  await clickAction(page, 'simple');
  await openViewOptions(page);await page.locator('#report-shape').selectOption('star');
  await expect.poll(() => page.locator('.infographic-preview [data-role="phase-end-marker"] polygon').count()).toBeGreaterThan(0);
  const edited = await draft(page); assert.deepEqual(edited.projects, model.projects);
  assert.equal(edited.presentation.milestoneShape, 'star'); assert.equal(edited.presentation.locks.milestoneShape, true);
  const exported = await download(instance, page, directory, 'svg'); assert.match(exported.bytes.toString('utf8'), /<polygon/);
  await size('large'); assert.ok(await font() > originalFont); assert.deepEqual(await draft(page), edited);
  await size('small');
  await expect(page.locator('aside')).toHaveCount(0);
  await clickAction(page, 'timeline');
  const heading = await page.locator('.sidebar-heading').boundingBox();
  await page.mouse.move(heading.x + 30, heading.y + heading.height / 2);
  await page.mouse.down();
  await page.mouse.move(heading.x + 58, heading.y + heading.height / 2 + 35, { steps: 8 });
  await page.mouse.up(); await settle(page);
  const corner = await page.locator('.sidebar-corner-resizer').boundingBox();
  await page.mouse.move(corner.x + 9, corner.y + 9); await page.mouse.down();
  await page.mouse.move(corner.x + 9, corner.y + 9 - 180, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('aside')).toHaveClass(/is-floating/);
  await clickAction(page, 'simple');
  await expect(page.locator('aside')).toHaveCount(0);
  await page.locator('[data-picture-action="zoom-in"]').click();
  await globalClick(page,'settings');
  await page.screenshot({ path: path.join(evidence, 'packaged-settings-small-star-milestones.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.reload(); await expect(page.locator('#app')).toHaveAttribute('data-ui-size', 'small');
  await clickAction(page, 'simple'); await expect(page.locator('#report-shape')).toHaveValue('star');
  assert.deepEqual(await draft(page), edited);
});

const settingsOpen=async(page,category)=>{if(!await page.locator('#settings-dialog').isVisible())await globalClick(page,'settings');await page.locator(`[data-settings-category="${category}"]`).click();};
const settingsClose=page=>page.keyboard.press('Escape');

test('packaged settings show real version/path, native shortcuts and reject unsupported bridge requests', {timeout:60000},async t=>{
 const {instance,page,profile}=await isolated(t);const model=await importModel(page);
 const info=await page.evaluate(()=>window.dragDesktop.info());assert.equal(info.version,version);assert.equal(info.dataPath,profile);assert.equal(info.platform,process.platform);
 await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('drag-settings').click());await expect(page.locator('#settings-dialog')).toBeVisible();await page.locator('[data-settings-category="about"]').click();await expect(page.locator('#settings-data-path')).toHaveText(profile);await expect(page.locator('[data-settings-action="open-data"]')).toBeVisible();await page.screenshot({path:path.join(evidence,'packaged-settings-about.png'),fullPage:true});
 await page.locator('[data-settings-category="editing"]').click();await page.locator('[data-shortcut="save"]').focus();await page.locator('[data-shortcut="save"]').press(modKey+'+o');await expect(page.locator('#settings-error')).toContainText('重複');await page.locator('[data-shortcut="save"]').press(modKey+'+Shift+s');
 await expect(page.locator('[data-shortcut="save"]')).toHaveValue('Mod+Shift+s');await expect.poll(()=>instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('drag-save').accelerator)).toBe('CmdOrCtrl+Shift+s');
 await settingsClose(page);await selectFirstTask(page);const f=page.locator('[data-field="label"]');await f.fill('原生文字復原');await f.press(modKey+'+z');await expect(f).toHaveValue(model.projects[0].phases[0].label);assert.deepEqual(await draft(page),model);
 const errors=await page.evaluate(async()=>{const out=[];for(const call of[()=>window.dragDesktop.readBackup('../outside'),()=>window.dragDesktop.writeBackup('{}',2,'manual'),()=>window.dragDesktop.stageBackup(JSON.stringify({projects:[]}),{enabled:true,count:999,minutes:1}),()=>window.dragDesktop.configure({rememberSaveDirectory:true,shortcuts:{settings:'Mod+,',save:'Mod+q',import:'Mod+o'}}),()=>window.dragDesktop.captureShortcuts('invalid')]){try{await call();out.push(false);}catch{out.push(true);}}return out;});assert.deepEqual(errors,[true,true,true,true,true]);assert.deepEqual(await draft(page),model);

});

test('packaged English setting updates native Mac menu and backup errors without changing a project', {timeout:60000},async t=>{
 const {instance,page}=await isolated(t);const model=await importModel(page);
 const menuLabels=()=>instance.evaluate(({Menu})=>({file:Menu.getApplicationMenu().items.find(item=>item.label==='File'||item.label==='檔案')?.label,save:Menu.getApplicationMenu().getMenuItemById('drag-save')?.label}));
 const backupError=()=>page.evaluate(async()=>{const id=JSON.parse(localStorage.getItem('drag.documentDraft')).record.id;try{await window.dragDesktop.readBackup('../outside',id,false);return '';}catch(error){return error.message;}});
 await settingsOpen(page,'interface');await page.locator('[data-pref="language"]').selectOption('en');
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect.poll(menuLabels).toEqual({file:'File',save:'Save Project…'});
 assert.match(await backupError(),/Invalid backup ID/);
 assert.deepEqual(await draft(page),model);
 await settingsClose(page);await page.reload();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect.poll(menuLabels).toEqual({file:'File',save:'Save Project…'});
 assert.deepEqual(await draft(page),model);
 await settingsOpen(page,'interface');await page.locator('[data-pref="language"]').selectOption('zh-TW');
 await expect(page.locator('html')).toHaveAttribute('lang','zh-Hant');
 await expect.poll(menuLabels).toEqual({file:'檔案',save:'儲存專案…'});
 assert.match(await backupError(),/備份識別碼無效/);
 assert.deepEqual(await draft(page),model);
});

test('desktop backup list/preview/export/restore uses real rotated files and preserves metadata with undo', {timeout:90000},async t=>{
 const {instance,page,profile,directory}=await isolated(t);const model=await importModel(page);await settingsOpen(page,'storage');await page.locator('[data-pref="autoBackup"]').uncheck();await page.locator('[data-pref="backupCount"]').fill('2');await page.locator('[data-pref="backupCount"]').press('Tab');await page.locator('[data-settings-action="backup"]').click();await expect.poll(()=>page.locator('.backup-row').count()).toBeGreaterThanOrEqual(1);await settingsClose(page);
 await selectFirstTask(page);const f=page.locator('[data-field="label"]');await f.fill('檔案備份二');await f.press('Tab');await f.blur();const changed=await draft(page);await settingsOpen(page,'storage');await page.locator('[data-settings-action="backup"]').click();await expect(page.locator('.backup-row')).toHaveCount(2);
 const list=await page.evaluate(()=>window.dragDesktop.listBackups(JSON.parse(localStorage.getItem('drag.documentDraft')).record.id,false));for(const entry of list){const saved=JSON.parse(await readFile(path.join(profile,'backups',entry.id+'.json'),'utf8'));assert.equal(saved.id,entry.id);assert.deepEqual(JSON.parse(saved.body),JSON.parse(await page.evaluate(id=>window.dragDesktop.readBackup(id,JSON.parse(localStorage.getItem('drag.documentDraft')).record.id,false),entry.id)));}assert.deepEqual(JSON.parse(await page.evaluate(id=>window.dragDesktop.readBackup(id,JSON.parse(localStorage.getItem('drag.documentDraft')).record.id,false),list.at(-1).id)),model);
 await page.locator('[data-backup-preview]').last().click();await expect(page.locator('#backup-preview')).toContainText(model.projects[0].name);
 await instance.evaluate(({session},folder)=>{session.defaultSession.once('will-download',(_e,item)=>{globalThis.__backupDownload={path:folder+'/backup.json',state:'started'};item.setSavePath(globalThis.__backupDownload.path);item.once('done',(_e,state)=>globalThis.__backupDownload.state=state);});},directory);await page.locator('[data-backup-export]').last().click();await expect.poll(()=>instance.evaluate(()=>globalThis.__backupDownload?.state)).toBe('completed');assert.deepEqual(JSON.parse(await readFile(path.join(directory,'backup.json'),'utf8')),model);
 page.once('dialog',d=>d.accept());await page.locator('[data-backup-restore]').last().click();await expect(page.locator('#settings-dialog')).not.toBeVisible();assert.deepEqual(await draft(page),model);const restoredList=await page.evaluate(()=>window.dragDesktop.listBackups(JSON.parse(localStorage.getItem('drag.documentDraft')).record.id,false));assert.equal(restoredList[0].reason,'pre-restore');assert.deepEqual(JSON.parse(await page.evaluate(id=>window.dragDesktop.readBackup(id,JSON.parse(localStorage.getItem('drag.documentDraft')).record.id,false),restoredList[0].id)),changed);await globalClick(page,'undo');assert.deepEqual(await draft(page),changed);
 await settingsOpen(page,'storage');await page.screenshot({path:path.join(evidence,'packaged-settings-backups.png'),fullPage:true});
});

test('desktop quit flushes the latest pending automatic version and prefs survive complete relaunch', {timeout:90000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'drag-desktop-test-')),profile=path.join(directory,'profile');let running;
 t.after(async()=>{if(running)await running.instance.close();await rm(directory,{recursive:true,force:true});});running=await launch(profile);const model=await importModel(running.page);
 await settingsOpen(running.page,'storage');await running.page.locator('[data-pref="backupMinutes"]').fill('60');await running.page.locator('[data-pref="backupMinutes"]').press('Tab');await settingsClose(running.page);
 await settingsOpen(running.page,'interface');await running.page.locator('[data-pref="theme"]').selectOption('dark');await settingsClose(running.page);await selectFirstTask(running.page);const f=running.page.locator('[data-field="label"]');await f.fill('結束前尚未到期的版本');await f.press('Tab');await f.blur();const changed=await draft(running.page);await running.instance.close();running=null;
 const {readdir}=await import('node:fs/promises');const entries=await Promise.all((await readdir(path.join(profile,'backups'))).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await readFile(path.join(profile,'backups',n),'utf8'))));assert.ok(entries.some(e=>JSON.stringify(JSON.parse(e.body))===JSON.stringify(changed)),'quit must flush latest pending body to disk');
 running=await launch(profile);assert.deepEqual(await draft(running.page),changed);await expect(running.page.locator('html')).toHaveAttribute('data-theme','dark');const prefs=await running.page.evaluate(()=>JSON.parse(localStorage.getItem('drag.preferences')).values);assert.equal(prefs.backupMinutes,60);assert.deepEqual(changed.metadata,model.metadata);
});

test('desktop remembered save folder affects actual DownloadItem options only when enabled', {timeout:90000},async t=>{
 const {instance,page,directory,profile}=await isolated(t);await importModel(page);const folder=path.join(directory,'saved');await mkdir(folder);await settingsOpen(page,'storage');await page.locator('[data-pref="rememberSaveDirectory"]').check();await settingsClose(page);await download(instance,page,folder,'save');await expect.poll(async()=>{try{return JSON.parse(await readFile(path.join(profile,'download-preferences.json'),'utf8')).lastDirectory;}catch{return null;}}).toBe(folder);
 const capture=async()=>{await instance.evaluate(({session},folder)=>{globalThis.__saveOptions=null;session.defaultSession.once('will-download',(_e,item)=>{globalThis.__saveOptions=item.getSaveDialogOptions();item.setSavePath(folder+'/next.json');});},directory);await globalClick(page,'save');await expect.poll(()=>instance.evaluate(()=>globalThis.__saveOptions)).not.toBe(null);return instance.evaluate(()=>globalThis.__saveOptions);};
 assert.equal(path.dirname((await capture()).defaultPath),folder);await settingsOpen(page,'storage');await page.locator('[data-reset-pref="rememberSaveDirectory"]').click();await expect(page.locator('[data-pref="rememberSaveDirectory"]')).not.toBeChecked();await settingsClose(page);const options=await capture();const defaultFolder=await instance.evaluate(({app})=>app.getPath('downloads'));assert.equal(path.dirname(options.defaultPath),defaultFolder);
});

test('packaged first launch completes the guide, blocks background menu actions and can reopen it from Settings', {timeout:60000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'drag-desktop-tour-'));let instance;
 t.after(async()=>{if(instance)await instance.close();await rm(directory,{recursive:true,force:true});});
 instance=await electron.launch({executablePath,args:['--user-data-dir='+path.join(directory,'profile')]});const page=await instance.firstWindow();await expect(page.locator('#quick-tour')).toBeVisible();const original=await draft(page);
 await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('drag-settings').click());await expect(page.locator('#settings-dialog')).not.toBeVisible();await expect(page.locator('#quick-tour')).toBeVisible();
 for(let i=0;i<4;i++)await page.locator('[data-tour-action="next"]').click();await expect(page.locator('#quick-tour')).not.toBeVisible();assert.deepEqual(await draft(page),original);await page.reload();await expect(action(page,'global-menu')).toBeVisible();await expect(page.locator('#quick-tour')).not.toBeVisible();
 await globalClick(page,'settings');await page.locator('[data-settings-category="about"]').click();await page.locator('[data-settings-action="quick-tour"]').click();await expect(page.locator('#quick-tour')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#quick-tour')).not.toBeVisible();assert.deepEqual(await draft(page),original);
});

test('packaged timeline files retain independent models, history and scoped disk backups across restart', {timeout:90000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'drag-desktop-documents-')),profile=path.join(directory,'profile');let running;
 t.after(async()=>{if(running)await running.instance.close();await rm(directory,{recursive:true,force:true});});
 running=await launch(profile);let {page}=running;const model=await importModel(page);
 const id=()=>currentDocument(page).getAttribute('data-document-id');const first=await id();
 await settingsOpen(page,'storage');await page.locator('[data-pref="autoBackup"]').uncheck();await page.locator('[data-settings-action="backup"]').click();await expect.poll(()=>page.locator('.backup-row').count()).toBeGreaterThanOrEqual(1);await settingsClose(page);
 const originalBackups=await page.evaluate(documentId=>window.dragDesktop.listBackups(documentId,false),first);assert.ok(originalBackups.length);
 await selectFirstTask(page);const field=page.locator('#editor [data-field="label"]');await field.fill('第一份檔案的獨立修改');await field.press('Tab');await field.blur();const changed=await draft(page);
 await clickAction(page, 'newdocument');await page.locator('#document-name').fill('第二份時間軸');await page.locator('#document-dialog button[type=submit]').click();await expect(currentDocument(page)).toHaveText('第二份時間軸');const second=await id();assert.notEqual(first,second);
 await expect(action(page,'undo')).toBeDisabled();assert.deepEqual((await draft(page)).projects,[]);await clickAction(page, 'newproject');const secondModel=await draft(page);
 await settingsOpen(page,'storage');await expect(page.locator('.backup-row')).toHaveCount(0);await page.locator('[data-settings-action="backup"]').click();await expect(page.locator('.backup-row')).toHaveCount(1);await settingsClose(page);
 const isolation=await page.evaluate(async({backupId,documentId})=>{try{await window.dragDesktop.readBackup(backupId,documentId,false);return false;}catch{return true;}},{backupId:originalBackups[0].id,documentId:second});assert.equal(isolation,true);
 const firstDisk=JSON.parse(await readFile(path.join(profile,'backups',originalBackups[0].id+'.json'),'utf8'));assert.equal(firstDisk.documentId,first);assert.deepEqual(JSON.parse(firstDisk.body),model);
 await chooseDocument(page,first);await expect.poll(()=>draft(page)).toEqual(changed);await globalClick(page,'undo');assert.deepEqual(await draft(page),model);
 await chooseDocument(page,second);await expect.poll(()=>draft(page)).toEqual(secondModel);
 await running.instance.close();running=await launch(profile);page=running.page;await expect(page.locator('[data-action=document-menu]')).toHaveAttribute('data-active-id',second);assert.deepEqual(await draft(page),secondModel);
 await chooseDocument(page,first);await expect.poll(()=>draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
 await page.screenshot({path:path.join(evidence,'packaged-timeline-files.png'),fullPage:true});
});

test('packaged rename, trash and restore preserve the exact file and its disk backups after complete restart', {timeout:90000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'drag-desktop-lifecycle-')),profile=path.join(directory,'profile');let running;
 t.after(async()=>{if(running)await running.instance.close();await rm(directory,{recursive:true,force:true});});
 running=await launch(profile);let {page}=running;const model=await importModel(page);const id=await currentDocument(page).getAttribute('data-document-id');
 await settingsOpen(page,'storage');await page.locator('[data-pref="autoBackup"]').uncheck();await page.locator('[data-settings-action="backup"]').click();await expect.poll(()=>page.locator('.backup-row').count()).toBeGreaterThanOrEqual(1);await settingsClose(page);
 const versions=await page.evaluate(id=>window.dragDesktop.listBackups(id,false),id);
 const menu=async command=>{await clickAction(page, 'document-menu');await page.locator(`[data-document-action="${command}"]`).click();};
 await menu('rename');await page.locator('#document-name').fill('桌面重新命名');await page.locator('#document-dialog button[type=submit]').click();await expect(currentDocument(page)).toHaveText('桌面重新命名');assert.deepEqual(await draft(page),model);
 await menu('delete');await page.locator('#document-delete-dialog button[type=submit]').click();await expect(page.locator('[data-action=document-menu]')).not.toHaveAttribute('data-active-id',id);assert.deepEqual(await page.evaluate(id=>window.dragDesktop.listBackups(id,false),id),versions);
 await running.instance.close();running=await launch(profile);page=running.page;await expect(page.locator('[data-action=document-menu]')).not.toHaveAttribute('data-active-id',id);
 await menu('trash');await expect(page.locator('.document-trash-item span')).toHaveText('桌面重新命名');await page.screenshot({path:path.join(evidence,'packaged-trash.png')});await page.locator(`[data-document-restore="${id}"]`).click();await expect(page.locator('[data-action=document-menu]')).toHaveAttribute('data-active-id',id);assert.deepEqual(await draft(page),model);
 await settingsOpen(page,'storage');await expect(page.locator('.backup-row')).toHaveCount(versions.length);await settingsClose(page);await running.instance.close();running=await launch(profile);page=running.page;await expect(currentDocument(page)).toHaveText('桌面重新命名');assert.deepEqual(await draft(page),model);
});

test('packaged update entry uses the fixed external URL and rejects arguments and an untrusted window', {timeout:60000},async t=>{
 const {instance,page}=await isolated(t),model=await importModel(page);
 await instance.evaluate(({shell})=>{globalThis.__updateCalls=[];shell.openExternal=async url=>{globalThis.__updateCalls.push(url);if(globalThis.__updateCalls.length===1)throw Error('test open failure');};});
 await settingsOpen(page,'about');const button=page.locator('[data-settings-action="get-update"]');await button.click();await expect(page.locator('#settings-error')).toHaveText('無法開啟更新頁面');await expect(button).toBeEnabled();await button.click();await expect(page.locator('#settings-error')).toBeHidden();
 assert.equal(await page.evaluate(async()=>{try{await window.dragDesktop.openUpdates('https://example.invalid');return false;}catch{return true;}}),true);
 const untrusted=await instance.evaluate(async({BrowserWindow,app})=>{
  const preload=app.getAppPath()+'/desktop/preload.cjs';
  const extra=new BrowserWindow({show:false,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try{await extra.loadURL('app://bundle/index.html');return await extra.webContents.executeJavaScript("window.dragDesktop.openUpdates().then(()=>false,()=>true)");}finally{extra.destroy();}
 });assert.equal(untrusted,true);
 assert.deepEqual(await instance.evaluate(()=>globalThis.__updateCalls),['https://github.com/SortingZeal/drag/releases/latest','https://github.com/SortingZeal/drag/releases/latest']);
 assert.deepEqual(await draft(page),model);await page.screenshot({path:path.join(evidence,'packaged-update-entry.png'),fullPage:true});
});

test('packaged properties and icon selection preserve the active document and canvas size', {timeout:60000},async t=>{
 const {page}=await isolated(t),model=await importModel(page);
 await expect(page.locator('.bottom')).toBeHidden();
 await selectFirstTask(page);
 await expect(page.locator('.icon-options')).toBeHidden();
 await page.locator('.icon-picker summary').click();
 await expect(page.locator('.icon-options')).toBeVisible();
 await page.locator('[data-icon="🚀"]').click();
 const changed=await draft(page);
 assert.equal(changed.projects[0].phases[0].icon,'🚀');
 assert.equal(changed.projects[0].phases[0].locks.icon,true);
 await globalClick(page,'undo');
 for(const mode of ['timeline', 'simple']){
  await clickAction(page, mode);
  await selectFirstTask(page);
  const before=await page.locator('.preview').boundingBox();
  await page.locator('[data-outline-close]').click();
  await expect(page.locator('.bottom')).toBeHidden();
  assert.deepEqual(await page.locator('.preview').boundingBox(),before);
  await selectFirstTask(page);
  assert.deepEqual(await draft(page),model);
 }
});

test('packaged pictures align display without changing task dates or locks', {timeout:60000},async t=>{
 const {page}=await isolated(t),model=await importModel(page);
 await clickAction(page, 'simple');
 await openViewOptions(page);await page.locator('#report-start').fill('2030-01-01');await page.locator('#report-start').press('Tab');
 await expect(page.locator('.roadmap-simple')).toHaveAttribute('data-start','2030-01-01');
 const old=page.locator(`.roadmap-simple [data-phase-id="${model.projects[0].phases[0].id}"]`);
 await expect(old).toHaveCount(0);
 const before=await draft(page);await openViewSection(page,'.align-start');await page.locator('#align-mode').selectOption('date');await page.locator('#align-start-date').fill('2030-01-01');
 await page.locator('#align-start-apply').click();
 const changed=await draft(page);assert.deepEqual(changed.projects,before.projects);
 assert.equal(changed.presentation.alignDate,'2030-01-01');
 await expect(page.locator('.roadmap-simple')).toHaveAttribute('data-start','2030-01-01');
 await expect(page.locator('.roadmap-simple [data-phase-id]')).toHaveCount(0);
 assert.deepEqual(changed.projects[0].phases[0].metadata,model.projects[0].phases[0].metadata);
 assert.equal(changed.projects[0].phases[0].locks.label,true);
 await globalClick(page,'undo');assert.deepEqual(await draft(page),before);
});

test('packaged task properties open next to the outline, resize and preserve the canvas', {timeout:60000}, async t=>{
 const {page}=await isolated(t),model=await importModel(page);
 await page.setViewportSize({width:1440,height:1000});
 const canvas=await page.locator('.preview').boundingBox();
 await expect(page.locator('.bottom')).toBeHidden();
 await selectFirstTask(page);
 const panel=page.locator('.bottom');
 const before=await panel.boundingBox();
 const outline=await page.locator('aside').boundingBox();
 assert.ok(Math.abs(before.x-outline.x-outline.width)<=8);
 const split=page.locator('#split');
 await split.focus();
 await page.keyboard.press('ArrowRight');
 assert.equal((await panel.boundingBox()).width,before.width+16);
 await page.locator('[data-outline-close]').click();
 await expect(panel).toBeHidden();
 assert.deepEqual(await page.locator('.preview').boundingBox(),canvas);
 await selectFirstTask(page);
 assert.equal((await panel.boundingBox()).width,before.width+16);
 assert.deepEqual(await draft(page),model);
});
