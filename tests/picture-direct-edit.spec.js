import { test, expect } from './audit-fixture.js';
import { clickAction } from './global-actions.js';
import { readFile } from 'node:fs/promises';

const phase = {
  id: 'build', label: 'Build', status: 'Blocked', start: '2026-11-05', end: '2026-11-19',
  milestone: { label: 'Review', date: '2026-11-24', owner: 'QA' },
};
const model = {
  title: 'Delivery', presentation: { start: '2026-11-01', end: '2026-12-20' },
  projects: [{ id: 'delivery', name: 'Delivery', phases: [phase] }],
};
const stage = page => page.locator('.picture-canvas [data-phase-id="build"]');
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects[0].phases[0]);
async function mount(page) {
  await page.addInitScript(model => localStorage.setItem('drag.draft', JSON.stringify(model)), model);
  await page.goto('/');
  await clickAction(page, 'simple');
  await expect(stage(page)).toBeVisible();
}
async function point(page, day, part = 'phase-bar') {
  return stage(page).evaluate((g, {day, part}) => {
    const svg = g.ownerSVGElement;
    const matrix = svg.getScreenCTM(), bounds = g.querySelector('[data-role="' + part + '"]').getBoundingClientRect();
    return { x: (svg.xAtDate(day) * 0.65 + svg.xAtDate(day, true) * 0.35) * matrix.a + matrix.e, y: bounds.top + bounds.height * 0.60 };
  }, {day,part});
}
async function shift(page, from, to, {cancel = false} = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, {steps: 5});
  await expect(page.locator('.picture-date-preview')).toBeVisible();
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.picture-date-preview')).toBeHidden();
}
async function closeEditor(page) {
  await page.locator('#editor [data-outline-close]').click();
  await expect(page.locator('#editor')).toBeHidden();
}

test('a task, its status and its milestone each open the intended picture editing controls', async ({page}) => {
  await mount(page);
  let bar = await point(page, '2026-11-12');
  await page.mouse.click(bar.x, bar.y);
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue('Build');
  await closeEditor(page);
  await stage(page).locator('[data-edit-field="status"]').click();
  await expect(page.locator('#editor [data-status-choice][aria-pressed="true"]')).toBeFocused();
  await page.locator('#editor [data-status-choice="3"]').click();
  expect(await saved(page)).toMatchObject({status:'已完成',progress:100});
  await closeEditor(page);
  const note = await stage(page).locator('[data-role="milestone-label"]').evaluate(text => text.getBoundingClientRect().toJSON());
  await page.mouse.click(note.x + note.width / 2, note.y + note.height / 2);
  await expect(page.locator('#editor [data-milestone-anchor="start"]')).toBeFocused();
  await page.locator('#editor [data-milestone-anchor="end"]').click();
  expect((await saved(page)).milestone).toEqual({...phase.milestone, date:phase.end});
  await closeEditor(page);
  await stage(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue('Build');
});

test('picture drags move a task or one endpoint, cancel and undo without shifting its milestone or the canvas', async ({page}) => {
  await mount(page);
  const picture = page.locator('.picture-canvas > svg');
  const before = await picture.boundingBox();
  let from = await point(page, '2026-11-10'), to = await point(page, '2026-11-13');
  await shift(page, from, to, {cancel: true});
  expect((await saved(page)).start).toBe(phase.start);
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  await shift(page, from, to);
  expect(await saved(page)).toMatchObject({start:'2026-11-08',end:'2026-11-22',milestone:phase.milestone});
  expect(await picture.boundingBox()).toEqual(before);
  await clickAction(page,'undo');
  expect(await saved(page)).toMatchObject(phase);
  const bar = await stage(page).locator('[data-role="phase-bar"]').boundingBox();
  from = {x:bar.x + 2,y:bar.y + bar.height / 2};
  to = await point(page,'2026-11-08');
  await shift(page, from, {...to,y:from.y});
  expect(await saved(page)).toMatchObject({start:'2026-11-08',end:phase.end});
});

test('picture properties follow the clicked task, stay below the calendar, and carry edits into the timeline', async ({page}) => {
  const second = {id:'ship',label:'Ship',start:'2026-12-03',end:'2026-12-18'};
  const data = structuredClone(model);
  data.projects.push({id:'release',name:'Release',phases:[second]});
  await page.addInitScript(value => localStorage.setItem('drag.draft', JSON.stringify(value)), data);
  await page.goto('/');
  await clickAction(page, 'simple');
  const center = await point(page, '2026-11-09');
  const first = {x:Math.round(center.x), y:Math.round(center.y)};
  await page.mouse.click(first.x, first.y);
  const inspector = page.locator('main[data-inspector-anchor="chart"] .bottom');
  const name = page.locator('#editor [data-field="label"]');
  await expect(inspector).toBeVisible();
  const header = await page.locator('[data-role="calendar-header"]').boundingBox();
  const panel = await inspector.boundingBox();
  expect(panel.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(panel.x - first.x).toBeCloseTo(12, 0);
  await name.fill('Build revised');
  const ship = page.locator('.picture-canvas [data-phase-id="ship"]');
  const bar = await ship.locator('[data-role="phase-bar"]').boundingBox();
  await page.mouse.click(bar.x + bar.width * .92, bar.y + bar.height / 2);
  await expect(name).toHaveValue('Ship');
  await expect(inspector).toHaveCount(1);
  expect((await saved(page)).label).toBe('Build revised');
  await clickAction(page, 'timeline');
  await expect(inspector).toBeVisible();
  await expect(name).toHaveValue('Ship');
  await name.fill('Ship revised');
  await name.press('Tab');
  await clickAction(page, 'simple');
  await expect(name).toHaveValue('Ship revised');
  await page.keyboard.press('Escape');
  await expect(page.locator('.bottom')).toBeHidden();
  await expect(ship).toBeFocused();
  await ship.press('Enter');
  await expect(inspector).toBeVisible();
  const view = await page.locator('.picture-viewport').boundingBox();
  await page.mouse.click(view.x + 6, view.y + 8);
  await expect(page.locator('.bottom')).toBeHidden();
});

test('moving a picture milestone preserves task dates and metadata in JSON and exported SVG', async ({page}) => {
  await mount(page);
  const marker = stage(page).locator('[data-role="milestone"]');
  const box = await marker.boundingBox();
  const from = {x:box.x + box.width / 2,y:box.y + box.height / 2};
  const delta = (await point(page,'2026-12-01')).x - (await point(page,phase.milestone.date)).x;
  await shift(page, from, {x:from.x + delta + 1,y:from.y});
  const current = await saved(page);
  expect(current).toMatchObject({start:phase.start,end:phase.end,milestone:{...phase.milestone,date:'2026-12-01'}});
  await expect(marker).toHaveAttribute('data-date','2026-12-01');
  const downloaded = page.waitForEvent('download');
  await clickAction(page,'svg');
  const file = await downloaded;
  const svg = await readFile(await file.path(),'utf8');
  expect(svg).toContain('data-date="2026-12-01"');
  expect(svg).not.toMatch(/picture-date-preview|tabindex=|role="button"/);
  await clickAction(page,'undo');
  expect(await saved(page)).toMatchObject(phase);
});

test.describe('touch editing', () => {
  test.use({viewport:{width:390,height:844},hasTouch:true});
  test('a tap opens the status control from the fitted mobile picture', async ({page}) => {
    await mount(page);
    const paper = await page.locator('.picture-canvas > svg').boundingBox();
    const view = await page.locator('.picture-viewport').boundingBox();
    expect(paper.x).toBeGreaterThanOrEqual(view.x);
    expect(paper.y).toBeGreaterThanOrEqual(view.y);
    expect(paper.x + paper.width).toBeLessThanOrEqual(view.x + view.width);
    expect(paper.y + paper.height).toBeLessThanOrEqual(view.y + view.height);
    const badge = await stage(page).locator('[data-edit-field="status"]').boundingBox();
    await page.touchscreen.tap(badge.x + badge.width / 2, badge.y + badge.height / 2);
    await expect(page.locator('#editor [data-status-choice="2"]')).toBeFocused();
    await page.locator('#editor [data-status-choice="1"]').tap();
    expect((await saved(page)).status).toBe('進行中');
  });
});
