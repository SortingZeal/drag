import { clickAction, openViewOptions } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const chart = page => page.locator('.infographic-preview svg[data-simple="true"]');
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));

function fixture(exact = false) {
  const model = structuredClone(seed);
  model.metadata = { source: 'simple-milestone-shape', nested: ['保留', { untouched: 512 }] };
  model.locks = { title: true };
  model.presentation = { milestoneShape: 'circle', locks: { end: true }, metadata: { keep: ['shape', false] } };
  model.projects.forEach((project, pi) => {
    project.id = `shape-project-${pi}`;
    project.locks = { color: true, name: true };
    project.metadata = { original: ['project', pi] };
    project.phases.forEach((phase, fi) => {
      phase.id = `shape-phase-${pi}-${fi}`;
      phase.locks = { label: true, start: true, end: true };
      phase.metadata = { original: ['phase', pi, fi] };
    });
  });
  model.projects[0].icon = '★';
  model.projects[0].locks.icon = true;
  model.projects[0].fontSize = 31;
  model.projects[0].phases[0].icon = '✦';
  model.projects[0].phases[0].fontSize = 18;
  model.projects[0].phases[0].locks.icon = true;
  model.projects[0].phases[0].milestone='1/31';
  model.projects[2].phases[0].milestone='2027/5 預計檢查';
  if (exact) {
    model.projects[0].phases[0].milestone = '已確認驗收';
    model.projects[0].phases[0].milestoneDate = '2026-10-28';
  }
  return model;
}

async function mount(page, { exact = false } = {}) {
  const model = fixture(exact);
  await page.addInitScript(value => {
    if (localStorage.getItem('simple-shape.seeded')) return;
    localStorage.setItem('drag.draft', JSON.stringify(value));
    localStorage.setItem('drag.paneHeight', '65');
    localStorage.setItem('simple-shape.seeded', 'true');
  }, model);
  await page.goto('/');
  await clickAction(page, 'simple');
  await expect(chart(page)).toBeVisible();
  expect(await draft(page)).toEqual(model);
  return model;
}

async function selectShape(page, value) {
  await openViewOptions(page);
  const select = page.locator('#report-shape');
  await expect(select).toBeVisible();
  await select.selectOption(value);
  await expect(page.locator('#report-shape')).toHaveValue(value);
}

async function symbols(page, xml) {
  return page.evaluate(value => {
    const root = value ? new DOMParser().parseFromString(value, 'image/svg+xml').documentElement : document.querySelector('svg[data-simple="true"]');
    return {
      errors: root.querySelectorAll('parsererror').length,
      width: root.getAttribute('width'), height: root.getAttribute('height'),
      icons: [...root.querySelectorAll('[data-role="project-icon"]')].map(node => node.outerHTML),
      bars: [...root.querySelectorAll('[data-role="phase-bar"]')].map(node => node.getAttribute('d')),
      markers: [...root.querySelectorAll('g[data-role="milestone"],g[data-role="phase-end-marker"]')].map(marker => {
        const shape = marker.querySelector('[data-role="milestone-symbol"]');
        const points = shape.localName === 'polygon' ? [...shape.points].map(point => ({ x: point.x, y: point.y })) : [];
        const center = points.length ? { x: points.reduce((n, p) => n + p.x, 0) / points.length, y: points.reduce((n, p) => n + p.y, 0) / points.length } : { x: Number(shape.getAttribute('cx')), y: Number(shape.getAttribute('cy')) };
        return { id: marker.closest('[data-phase-id]').getAttribute('data-phase-id'), role: marker.getAttribute('data-role'), date: marker.getAttribute('data-date'), anchor: marker.getAttribute('data-anchor'), tag: shape.localName, shape: shape.getAttribute('data-shape'), fill: shape.getAttribute('fill'), radius: shape.getAttribute('r'), center, points };
      }),
    };
  }, xml);
}

function expectSymbols(rendered, model, kind) {
  expect(rendered.errors).toBe(0);
  expect([rendered.width, rendered.height]).toEqual(['3840', '2160']);
  const expected = model.projects.flatMap(project => project.phases.map((phase, index) => ({ phase, project, boundary: index < project.phases.length - 1 }))).filter(({ phase, boundary }) => phase.milestone || phase.milestoneDate || boundary);
  expect(rendered.markers).toHaveLength(expected.length);
  for (const { phase, project } of expected) {
    const marker = rendered.markers.find(value => value.id === phase.id);
    const milestone = Boolean(phase.milestone || phase.milestoneDate);
    const star = milestone && kind === 'star';
    expect(marker.fill).toBe(project.color);
    expect(marker.shape).toBe(star ? 'star' : 'circle');
    if (phase.milestoneDate) {
      expect(marker.role).toBe('milestone');
      expect(marker.date).toBe(phase.milestoneDate);
      expect(marker.anchor).toBe('date');
    } else {
      expect(marker.role).toBe('phase-end-marker');
      expect(marker.date).toBeNull();
      expect(marker.anchor).toBe('phase-end');
    }
    if (star) {
      expect(marker.tag).toBe('polygon');
      expect(marker.points).toHaveLength(10);
      marker.points.forEach((point, index) => expect(Math.hypot(point.x - marker.center.x, point.y - marker.center.y)).toBeCloseTo(index % 2 ? 5 : 11, 3));
      expect(marker.points[0].x).toBeCloseTo(marker.center.x, 3);
      expect(marker.points[0].y).toBeCloseTo(marker.center.y - 11, 3);
    } else {
      expect(marker.tag).toBe('circle');
      expect(marker.radius).toBe('9');
    }
  }
}

function expectPositionsUnchanged(before, after) {
  expect(after.icons).toEqual(before.icons);
  expect(after.bars).toEqual(before.bars);
  for (const marker of before.markers) {
    const next = after.markers.find(value => value.id === marker.id);
    expect(next.center.x).toBeCloseTo(marker.center.x, 3);
    expect(next.center.y).toBeCloseTo(marker.center.y, 3);
  }
}

async function download(page, name) {
  const pending = page.waitForEvent('download');
  await clickAction(page, name);
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return { file, bytes: await readFile(await file.path()) };
}

async function pngSamples(page, bytes, points) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([3840, 2160]);
  return page.evaluate(async ({ base64, points }) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 3840; canvas.height = 2160;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return points.map(point => [...context.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data]);
  }, { base64: bytes.toString('base64'), points });
}

test.beforeEach(async ({ page }, info) => {
  info.shapeErrors = [];
  page.on('pageerror', error => info.shapeErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.shapeErrors).toEqual([]); });

test('seed-style incomplete milestones really become stars, preserve boundary circles, and survive history/reload', async ({ page }, info) => {
  const model = await mount(page);
  const original = await symbols(page);
  expectSymbols(original, model, 'circle');
  await expect(chart(page).locator('[data-role="project-icon"]').first()).toHaveText('★');
  await expect(chart(page).locator('[data-role="milestone"][data-date]')).toHaveCount(0);
  await selectShape(page, 'star');
  const starred = structuredClone(model);
  starred.presentation.milestoneShape = 'star';
  starred.presentation.locks.milestoneShape = true;
  expect(await draft(page)).toEqual(starred);
  const starSymbols = await symbols(page);
  expectSymbols(starSymbols, model, 'star');
  expectPositionsUnchanged(original, starSymbols);
  await expect(chart(page).locator('[data-role="milestone"][data-date]')).toHaveCount(0);
  await expect(chart(page).locator('[data-phase-id="shape-phase-0-0"] [data-role="milestone-label"]')).toHaveText(model.projects[0].phases[0].milestone);
  expect((await chart(page).locator('[data-phase-id="shape-phase-2-0"] [data-role="milestone-label"]').textContent()).replace(/\s/g,'')).toBe(model.projects[2].phases[0].milestone.replace(/\s/g,''));
  const svg = await download(page, 'svg');
  expect(svg.file.suggestedFilename()).toBe('drag-simple.svg');
  expectSymbols(await symbols(page, svg.bytes.toString()), model, 'star');
  await svg.file.saveAs(info.outputPath('incomplete-milestones-star.svg'));
  await page.screenshot({ path: info.outputPath('incomplete-milestones-star.png'), fullPage: true });

  await selectShape(page, 'circle');
  const circled = structuredClone(starred); circled.presentation.milestoneShape = 'circle';
  expect(await draft(page)).toEqual(circled);
  expectSymbols(await symbols(page), model, 'circle');
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(starred);
  expectSymbols(await symbols(page), model, 'star');
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(circled);
  expectSymbols(await symbols(page), model, 'circle');
  await clickAction(page, 'undo');
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  expectSymbols(await symbols(page), model, 'circle');
  await expect(action(page, 'undo')).toBeDisabled();
  await selectShape(page, 'star');
  await page.reload();
  await clickAction(page, 'simple');
  expect(await draft(page)).toEqual(starred);
  expectSymbols(await symbols(page), model, 'star');
  await expect(action(page, 'undo')).toBeDisabled();
  await selectShape(page, 'star');
  await expect(action(page, 'undo')).toBeDisabled();
  const json = await download(page, 'save');
  expect(JSON.parse(json.bytes.toString())).toEqual(starred);
});

test('exact and incomplete star geometries reach the downloaded SVG and 4K PNG without changing dates or glyphs', async ({ page }, info) => {
  const model = await mount(page, { exact: true });
  const original = await symbols(page);
  expectSymbols(original, model, 'circle');
  const points = await chart(page).evaluate(svg => ['shape-phase-0-0', 'shape-phase-0-1'].map(id => {
    const circle = svg.querySelector(`[data-phase-id="${id}"] [data-role="milestone-symbol"]`);
    const point = new DOMPoint(Number(circle.getAttribute('cx')) + 6, Number(circle.getAttribute('cy')) + 3).matrixTransform(circle.getScreenCTM());
    const box = svg.getBoundingClientRect();
    return { x: (point.x - box.x) / box.width * 3840, y: (point.y - box.y) / box.height * 2160 };
  }));
  const circlePng = await download(page, 'png');
  const circlePixels = await pngSamples(page, circlePng.bytes, points);
  for (const pixel of circlePixels) {
    expect(pixel[3]).toBe(255);
    expect(Math.abs(pixel[0] - 22) + Math.abs(pixel[1] - 115) + Math.abs(pixel[2] - 237)).toBeLessThan(45);
  }
  await circlePng.file.saveAs(info.outputPath('milestones-circle-4k.png'));
  await selectShape(page, 'star');
  const rendered = await symbols(page);
  expectSymbols(rendered, model, 'star');
  expectPositionsUnchanged(original, rendered);
  await expect(chart(page).locator('[data-role="milestone"][data-date="2026-10-28"]')).toHaveCount(1);
  await expect(chart(page).locator('[data-role="milestone"][data-date]')).toHaveCount(1);
  const vector = await download(page, 'svg');
  expectSymbols(await symbols(page, vector.bytes.toString()), model, 'star');
  await vector.file.saveAs(info.outputPath('exact-and-incomplete-stars.svg'));
  const starPng = await download(page, 'png');
  const starPixels = await pngSamples(page, starPng.bytes, points);
  for (const pixel of starPixels) {
    expect(pixel[3]).toBe(255);
    expect(Math.min(...pixel.slice(0, 3))).toBeGreaterThan(235);
  }
  expect(starPng.bytes.equals(circlePng.bytes)).toBe(false);
  await starPng.file.saveAs(info.outputPath('milestones-star-4k.png'));
  const expected = structuredClone(model);
  expected.presentation.milestoneShape = 'star';
  expected.presentation.locks.milestoneShape = true;
  expect(await draft(page)).toEqual(expected);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  expectSymbols(await symbols(page), model, 'circle');
  await expect(action(page, 'undo')).toBeDisabled();
});
