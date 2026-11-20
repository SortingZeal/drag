import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { clickAction } from './global-actions.js';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const chart = page => page.locator('.infographic-preview svg[data-simple="true"]');
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
function fixture() {
  const model = structuredClone(seed);
  model.projects[0].phases[0].milestone='1/31';
  model.custom = { preserved: ['simple', { revision: 5 }] };
  model.projects.forEach((project, pi) => {
    project.id = `simple-project-${pi}`; project.locks = { color: true };
    project.phases.forEach((phase, fi) => { phase.id = `simple-phase-${pi}-${fi}`; phase.locks = { label: true }; phase.custom = { preserve: true }; });
  });
  return model;
}
async function mount(page, model = fixture()) {
  await page.addInitScript(value => localStorage.setItem('drag.draft', JSON.stringify(value)), model);
  await page.goto('/');
  await page.locator('[data-action="simple"]').click();
  await expect(chart(page)).toBeVisible();
  return model;
}
test.beforeEach(async ({ page }, testInfo) => {
  testInfo.pageErrors = [];
  page.on('pageerror', error => testInfo.pageErrors.push(error.message));
});
test.afterEach(async ({}, testInfo) => expect(testInfo.pageErrors).toEqual([]));

test('simple view keeps one project row and consecutive phases on a shared bar baseline', async ({ page }, testInfo) => {
  const model = await mount(page);
  await expect(chart(page).locator('g[data-project-id]')).toHaveCount(7);
  await expect(chart(page).locator('[data-role="project-row"]')).toHaveCount(7);
  await expect(chart(page).locator('g[data-phase-id]')).toHaveCount(15);
  await expect(chart(page).locator('[data-role="month"]')).toHaveCount(12);
  await expect(chart(page).locator('[data-role="quarter"]')).toHaveCount(2);
  for (const project of model.projects) {
    const group = chart(page).locator(`[data-project-id="${project.id}"]`);
    await expect(group.locator('[data-role="project-name"]')).toHaveText(project.name);
    const baselines = await group.locator('[data-role="phase-bar"]').evaluateAll(bars => bars.map(bar => bar.getAttribute('y')));
    expect(new Set(baselines).size).toBe(1);
  }
  expect(await draft(page)).toEqual(model);
  await page.screenshot({ path: testInfo.outputPath('simple-preview.png'), fullPage: true });
});

test('English picture labels wrap at spaces and split only oversized words', async ({ page }) => {
  const model = fixture();
  model.projects[0].name = 'Website Planning';
  model.projects[0].fontSize = 40;
  model.projects[1].name = 'Supercalifragilisticexpialidocious Planning';
  model.projects[1].fontSize = 40;
  await page.addInitScript(() => localStorage.setItem('drag.preferences', JSON.stringify({ version: 1, values: { language: 'en' } })));
  await mount(page, model);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const words = await chart(page).locator('[data-project-id="simple-project-0"] [data-role="project-name"] tspan').allTextContents();
  expect(words.map(line => line.trim())).toEqual(['Website', 'Planning']);
  expect(words.join('')).toBe(model.projects[0].name);
  const longWord = await chart(page).locator('[data-project-id="simple-project-1"] [data-role="project-name"] tspan').allTextContents();
  expect(longWord.length).toBeGreaterThan(1);
  expect(longWord.some(line => line.includes('Planning'))).toBe(true);
  expect(longWord.join('')).toBe(model.projects[1].name);
  expect(await draft(page)).toEqual(model);
});

test('simple calendar positions use exact leap dates and only explicitly dated milestones', async ({ page }) => {
  const model = fixture();
  const phase = { ...model.projects[0].phases[0], start:'2028-02-28', end:'2028-03-01', milestone:'已確認節點', milestoneDate:'2028-02-29' };
  const unknown = { ...model.projects[0].phases[1], start:'2028-03-02', end:'2028-03-10', milestone:'2028/3 預計發表' };
  model.projects = [{ ...model.projects[0], phases: [phase, unknown] }];
  model.presentation = { start:'2028-02-01', end:'2028-03-31', milestoneShape:'star', locks:{start:true,end:true,milestoneShape:true} };
  await mount(page, model);
  const first = chart(page).locator(`[data-phase-id="${phase.id}"]`);
  const x = Number(await first.locator('[data-role="phase-bar"]').getAttribute('x'));
  expect(x).toBeCloseTo(420 + 744 * 27 / 29, 5);
  const marker = first.locator('[data-role="milestone"][data-date="2028-02-29"]');
  await expect(marker.locator('[data-role="milestone-symbol"]')).toHaveAttribute('data-shape', 'star');
  await expect(first.locator('[data-role="milestone-label"]')).toContainText('2028-02-29');
  await expect(first.locator('[data-role="milestone-label"]')).toContainText('已確認節點');
  const captionBox=await first.locator('[data-role="phase-label"]').boundingBox();
  for(const selector of ['[data-role="milestone-callout"]','[data-role="milestone-symbol"]']){
    const box=await first.locator(selector).boundingBox();
    expect(box.x+box.width<=captionBox.x || box.x>=captionBox.x+captionBox.width || box.y+box.height<=captionBox.y || box.y>=captionBox.y+captionBox.height,JSON.stringify({selector,box,captionBox})).toBe(true);
  }
  await expect(chart(page).locator('[data-role="milestone"]')).toHaveCount(1);
  const unknownGroup = chart(page).locator(`[data-phase-id="${unknown.id}"]`);
  const milestoneText = (await unknownGroup.locator('[data-role="milestone-label"]').allTextContents()).join('').replace(/\s/g, '');
  expect(milestoneText).toContain('2028/3預計發表');
  await expect(unknownGroup.locator('[data-role="phase-end-marker"]')).toHaveCount(1);
  expect(await unknownGroup.locator('[data-role="phase-end-marker"]').getAttribute('data-date')).toBeNull();
  await expect(unknownGroup.locator('[data-role="milestone"][data-date]')).toHaveCount(0);
  expect(await draft(page)).toEqual(model);
});

test('simple view displays manual visual settings and explicit status without inferring progress', async ({ page }) => {
  const model = fixture();
  model.projects[0].icon = '✦'; model.projects[0].fontSize = 28; model.projects[0].color = '#0f766e';
  Object.assign(model.projects[0].phases[0], { icon:'♜', fontSize:24, status:'暫緩', progress:27, light:true, open_end:true });
  await mount(page, model);
  const project = chart(page).locator('[data-project-id="simple-project-0"]');
  const phase = project.locator('[data-phase-id="simple-phase-0-0"]');
  await expect(project.locator('[data-role="project-icon"]')).toHaveText('✦');
  await expect(project.locator('[data-role="project-name"]')).toHaveAttribute('font-size','28');
  await expect(phase.locator('[data-role="phase-label"]')).toHaveAttribute('font-size','24');
  await expect(phase.locator('[data-role="phase-label"]')).toContainText('♜');
  await expect(phase.locator('[data-role="phase-status"]')).toHaveText('暫緩');
  await expect(phase.locator('[data-role="phase-label"]')).not.toContainText('暫緩');
  await expect(phase.locator('[data-role="phase-label"]')).toContainText('27%');
  await expect(phase.locator(':scope > title')).toContainText('結束未定');
  await expect(phase.locator('[data-role="phase-date-range"]')).toHaveCount(0);
  await expect(phase.locator('[data-role="open-end"]')).toHaveCount(1);
  const bar = phase.locator('[data-role="phase-bar"]');
  const manualColors = await bar.evaluate(el => {
    const fill = el.getAttribute('fill') || '';
    const id = /^url\(#([^)]*)\)$/.exec(fill)?.[1];
    if (!id) return [fill];
    const gradient = [...el.ownerSVGElement.querySelectorAll('linearGradient')].find(item => item.id === id);
    return [...(gradient?.querySelectorAll('stop') || [])].map(stop => stop.getAttribute('stop-color'));
  });
  await expect(bar).toHaveAttribute('opacity','0.4');
  expect(manualColors).toContain('#0f766e');
  const progress = Number(await phase.locator('[data-role="phase-progress"]').getAttribute('width'));
  const track = phase.locator('.bar-progress-track');
  expect(progress / Number(await track.getAttribute('width'))).toBeCloseTo(.27,5);
  await expect(chart(page).locator('[data-role="phase-progress"]')).toHaveCount(1);
  expect(await draft(page)).toEqual(model);
});

test('picture badges wrap full custom text and stay separate from narrow captions and dated milestones', async ({ page }) => {
  const model = fixture();
  const project = model.projects[0];
  const status = 'Awaiting <review> & sign-off from both the product team and the release coordinator';
  const phases = ['12', '30', '31'].map((day, index) => ({
    id: 'badge-' + index, label: 'Task ' + index, start: '2028-12-' + day, end: '2028-12-' + day,
    status, progress: index * 20, milestoneDate: '2028-12-31', milestone: 'Review ' + index,
  }));
  model.projects = [{...project, phases}];
  model.presentation = { start:'2028-01-01', end:'2028-12-31', locks:{start:true, end:true} };
  await mount(page, model);
  const root = chart(page);
  await expect(root.locator('review')).toHaveCount(0);
  const badges = root.locator('[data-role=phase-status-badge]');
  await expect(badges).toHaveCount(3);
  for (const badge of await badges.all()) {
    await expect(badge).toHaveAttribute('aria-label', status);
    expect(await badge.locator('[data-role=phase-status]').textContent()).toBe(status);
    expect(await badge.locator('tspan').count()).toBeGreaterThan(1);
  }
  const boxes = await root.evaluate(svg => [...svg.querySelectorAll('[data-role=phase-status-badge], [data-role=phase-label], [data-role=milestone-symbol], [data-role=milestone-callout]')].map(el => ({
    box: el.getBoundingClientRect().toJSON(), role: el.dataset.role, id: el.closest('[data-phase-id]').dataset.phaseId,
  })));
  for (let i = 0; i < boxes.length; i++) {
    for (const other of boxes.slice(i + 1)) {
      const a = boxes[i].box, b = other.box;
      expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        `${boxes[i].id} ${boxes[i].role} overlaps ${other.id} ${other.role}`).toBe(true);
    }
  }
  for (const phase of await root.locator('[data-phase-id]').all()) {
    const bar = await phase.locator('[data-role=phase-bar]').boundingBox();
    const badge = await phase.locator('[data-role=phase-status-badge]').boundingBox();
    expect(badge.y + badge.height).toBeLessThan(bar.y);
    expect(badge.x).toBeLessThanOrEqual(bar.x + 1);
    expect(badge.x + badge.width).toBeGreaterThan(bar.x);
    const grid = await root.locator('[data-role=project-row]').boundingBox();
    expect(badge.x + badge.width).toBeLessThanOrEqual(grid.x + grid.width);
  }
});

test('picture partial fills share one 16-unit animation and respect both reduced-motion settings', async ({ page }) => {
  const model = fixture();
  const phases = model.projects[0].phases;
  phases[0].progress = 35;
  phases[1].progress = 65;
  await page.emulateMedia({reducedMotion:'no-preference'});
  await mount(page, model);
  const root = chart(page);
  const texture = root.locator('.bar-progress-texture');
  await expect(texture).toHaveCount(2);
  const pattern = root.locator('pattern:has(.bar-progress-motion)');
  await expect(pattern).toHaveCount(1);
  await expect(pattern).toHaveAttribute('width', '16');
  await expect(pattern).toHaveAttribute('height', '16');
  const motion = pattern.locator('.bar-progress-motion');
  await expect(motion).not.toHaveCSS('animation-name', 'none');
  const transform = () => motion.evaluate(el => getComputedStyle(el).transform);
  const initial = await transform();
  await expect.poll(transform).not.toBe(initial);
  for (const rect of await texture.all()) {
    const geometry = await rect.evaluate(el => {
      const attrs = node => ['x','y','width','height'].map(attr => node.getAttribute(attr));
      return { texture: attrs(el), fill: attrs(el.previousElementSibling), pattern: el.getAttribute('fill') };
    });
    expect(geometry.texture).toEqual(geometry.fill);
    expect(geometry.pattern).toBe('url(#simple-progress-stripes)');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(motion).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await clickAction(page, 'settings');
  await page.locator('[data-pref=reduceMotion]').check();
  await page.keyboard.press('Escape');
  await expect(motion).toHaveCSS('animation-name', 'none');
  await expect(root.locator('.bar-progress')).toHaveCount(2);
});

test('overlaps stay inside a project row and long labels retain complete SVG descriptions', async ({ page }) => {
  const model = fixture();
  const project = model.projects[0];
  project.name = '跨部門產品設計整合與驗收完整專案名稱';
  project.fontSize = 60; project.status = '使用者明確填寫的專案狀態，需完整保留';
  project.phases[0].label = '此為很長的原始階段名稱，色塊內需完整換行並在SVG保留原始內容';
  project.phases[1].start = project.phases[0].start;
  await mount(page, model);
  const first = chart(page).locator('[data-phase-id="simple-phase-0-0"]');
  await expect(first.locator(':scope > title')).toContainText(project.phases[0].label);
  await expect(first.locator('[data-role="phase-label"]')).toContainText(project.phases[0].label);
  expect(await first.locator('[data-role="phase-label"]').textContent()).not.toContain('…');
  const bars = await chart(page).locator('[data-project-id="simple-project-0"] [data-role="phase-bar"]').evaluateAll(bars => bars.map(bar => Number(bar.getAttribute('y'))));
  expect(bars[0]).not.toBe(bars[1]);
  const overflow = await chart(page).evaluate(svg => {
    const canvas = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].filter(text => {
      const box = text.getBoundingClientRect();
      return box.left < canvas.left - 1 || box.right > canvas.right + 1 || box.top < canvas.top - 1 || box.bottom > canvas.bottom + 1;
    }).map(text => text.textContent);
  });
  expect(overflow).toEqual([]);
  const group = chart(page).locator('[data-project-id="simple-project-0"]');
  const row = await group.locator('[data-role="project-row"]').boundingBox();
  const status = await group.locator('[data-role="project-status"]').boundingBox();
  expect(status.y + status.height).toBeLessThanOrEqual(row.y + row.height);
  expect(await draft(page)).toEqual(model);
});

test('simple custom ranges clip outside work without rewriting dates', async ({ page }) => {
  const model = fixture();
  model.presentation = { start:'2028-02-01', end:'2028-02-29', milestoneShape:'circle', locks:{start:true,end:true} };
  await mount(page, model);
  await expect(chart(page)).toHaveAttribute('data-start','2028-02-01');
  await expect(chart(page)).toHaveAttribute('data-end','2028-02-29');
  const visible = model.projects.flatMap(project => project.phases).filter(phase => phase.end >= model.presentation.start && phase.start <= model.presentation.end);
  await expect(chart(page).locator('g[data-phase-id]')).toHaveCount(visible.length);
  for (const project of model.projects) for (const phase of project.phases) {
    const group = chart(page).locator(`[data-phase-id="${phase.id}"]`);
    if (!visible.includes(phase)) { await expect(group).toHaveCount(0); continue; }
    await expect(group.locator(':scope > title')).toContainText(phase.label);
    await expect(group).toHaveAttribute('data-start',phase.start);
    await expect(group).toHaveAttribute('data-end',phase.end);
  }
  await expect(chart(page)).not.toContainText('範圍外');
  await expect(chart(page).locator('[data-role="project-notes"]')).toHaveCount(0);
  expect(await draft(page)).toEqual(model);
});

test('reference style keeps captions inside thick bars and removes secondary date and note rows', async ({ page }) => {
  const model = await mount(page);
  const root = chart(page);
  await expect(root.locator('[data-role="phase-date-range"], [data-role="project-notes"], [data-role="legend"], [data-role="date-range"]')).toHaveCount(0);
  await expect(root.locator('circle[data-role="project-badge"]')).toHaveCount(7);
  expect(await root.locator('[data-phase-id="simple-phase-1-0"] [data-role="phase-label"] tspan').count()).toBeLessThanOrEqual(2);
  expect(await root.locator('[data-phase-id="simple-phase-4-0"] [data-role="phase-label"] tspan').count()).toBeLessThanOrEqual(2);
  await expect(root.locator('[data-phase-id="simple-phase-0-0"] [data-role="milestone-label"] tspan')).toHaveCount(1);
  await expect(root.locator('[data-phase-id="simple-phase-0-0"] [data-role="milestone-label"]')).toHaveText(model.projects[0].phases[0].milestone);
  const captionLines=await root.locator('[data-phase-id="simple-phase-6-1"] [data-role="phase-label"] tspan').allTextContents();
  if(captionLines.length>1)expect(captionLines.at(-1).trim().length).toBeGreaterThan(2);
  for(const project of model.projects){const group=root.locator(`[data-project-id="${project.id}"]`);for(const callout of await group.locator('[data-role="milestone-callout"]').all()){
    const a=await callout.boundingBox();for(const marker of await group.locator('[data-role="phase-end-marker"]').all()){const b=await marker.boundingBox();expect(a.x+a.width<=b.x || a.x>=b.x+b.width || a.y+a.height<=b.y || a.y>=b.y+b.height).toBe(true);}
  }}
  expect(await root.locator('linearGradient').count()).toBeGreaterThan(0);
  expect(Number(await root.locator('[data-role="title"]').getAttribute('font-size'))).toBeGreaterThanOrEqual(60);
  for (const project of model.projects) for (const phase of project.phases) {
    const stage = root.locator(`[data-phase-id="${phase.id}"]`);
    const bar = await stage.locator('[data-role="phase-bar"]').boundingBox();
    const caption = await stage.locator('[data-role="phase-label"]').evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
    expect(bar).toBeTruthy(); expect(caption).toBeTruthy();
    expect(Number(await stage.locator('[data-role="phase-bar"]').getAttribute('height'))).toBeGreaterThanOrEqual(48);
    expect(caption.x).toBeGreaterThanOrEqual(bar.x - 1);
    expect(caption.x + caption.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
    expect(caption.y).toBeGreaterThanOrEqual(bar.y - 1);
    expect(caption.y + caption.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
  }
  await expect(root.locator('[data-phase-id="simple-phase-3-1"] [data-role="phase-label"]')).toHaveText(model.projects[3].phases[1].label);
  await expect(root.locator('[data-phase-id="simple-phase-3-1"] [data-role="phase-label"]')).toBeVisible();
  expect(await draft(page)).toEqual(model);
});
