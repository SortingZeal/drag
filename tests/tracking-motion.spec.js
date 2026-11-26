import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { selectTimelineScale, clickAction } from './global-actions.js';

const selector = id => '#gantt .bar-wrapper[data-id="' + id + '"]';
const motion = '#gantt .bar-progress-motion';

function geometry(group) {
  const rect = node => node && Object.fromEntries(['x','y','width','height'].map(key => [key, Number(node.getAttribute(key))]));
  return {
    bar: rect(group.querySelector('.bar')),
    track: rect(group.querySelector('.bar-progress-track')),
    fill: rect(group.querySelector('.bar-progress')),
    texture: rect(group.querySelector('.bar-progress-texture')),
    badge: rect(group.querySelector('.bar-status-badge')),
  };
}

function checkGeometry({ bar, track, fill, texture, badge }, progress, withTexture = true) {
  if (badge) {
    expect(badge.x).toBeCloseTo(bar.x, 5);
    expect(badge.y).toBeLessThan(bar.y);
    expect(badge.y + badge.height).toBeLessThan(bar.y + bar.height / 2);
  }
  if (progress === null) {
    expect(track).toBeNull();
    expect(fill).toBeNull();
    expect(texture).toBeNull();
    return;
  }
  expect(track.x).toBeGreaterThan(bar.x);
  expect(track.x + track.width).toBeLessThan(bar.x + bar.width);
  expect(track.y).toBeGreaterThan(bar.y);
  expect(track.y + track.height).toBeLessThan(bar.y + bar.height);
  expect(fill).toMatchObject({ x: track.x, y: track.y, height: track.height });
  expect(fill.width).toBeCloseTo(track.width * progress / 100, 5);
  if (withTexture && progress > 0 && progress < 100) expect(texture).toEqual(fill);
  else expect(texture).toBeNull();
}

test.beforeEach(async ({page}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const phases=['active', 'new', 'done', 'unreported'].map((id, index) => ({
    id, label:id, start:'2028-04-03', end:'2028-04-17',
    ...[ { progress:35, status:'審查 <QA> & sign-off' }, { progress:'0' }, { progress:100 }, { status:'Pending' } ][index],
  }));
  await page.addInitScript(phases => {
    if (!localStorage.getItem('drag.draft')) {
      localStorage.setItem('drag.draft', JSON.stringify({ title:'Tracking', projects:[{id:'launch', name:'Launch', phases}] }));
    }
  }, phases);
  await page.goto('/');
});

test('the fractional completion layer follows scale and pointer dragging without intercepting edits', async ({page}) => {
  for (const [id, percent] of [['active', 35], ['new', 0], ['done', 100], ['unreported', null]]) {
    checkGeometry(await page.locator(selector(id)).evaluate(geometry), percent);
  }
  const wrapper=page.locator(selector('active'));
  await expect(wrapper.locator('.bar-status-text')).toHaveText('審查 <QA> & sign-off');
  await expect(wrapper.locator('.bar-status-badge')).toHaveAttribute('data-edit-field','status');
  await expect(wrapper.locator('.bar-label')).toHaveText('active · 35%');
  await expect(page.locator(selector('done')+' .bar-status-badge')).toHaveCount(0);
  await expect(page.locator(selector('unreported')+' .bar-status-text')).toHaveText('Pending');
  await expect(wrapper.locator('.bar-tracking-layer')).toHaveCSS('pointer-events','none');
  const original=await wrapper.evaluate(geometry);
  await selectTimelineScale(page, 'Week');
  const scaled=await wrapper.evaluate(geometry);
  expect(scaled.bar.width).not.toBeCloseTo(original.bar.width, 1);
  checkGeometry(scaled, 35);

  const bar=wrapper.locator('.bar');
  await bar.scrollIntoViewIfNeeded();
  const box=await bar.boundingBox();
  const point={x:box.x+box.width*.2, y:box.y+box.height*.65};
  expect(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('.bar-wrapper')?.dataset.id,point)).toBe('active');
  expect(await page.evaluate(({x,y}) => !!document.elementFromPoint(x,y)?.closest('.bar-tracking-layer'),point)).toBe(false);
  await page.mouse.move(point.x,point.y);
  await page.mouse.down();
  try {
    await page.mouse.move(point.x+box.width/2,point.y,{steps:8});
    await expect.poll(async()=> (await wrapper.evaluate(geometry)).bar.x).toBeGreaterThan(scaled.bar.x);
    checkGeometry(await wrapper.evaluate(geometry),35);
  } finally {
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')).projects[0].phases[0].start)).not.toBe('2028-04-03');
  checkGeometry(await wrapper.evaluate(geometry),35);
});

test('the in-progress texture moves forward, respects reduced motion and exports as a static completion layer', async ({page}) => {
  const pattern=page.locator(motion);
  await expect(pattern).toHaveCount(1);
  await expect(pattern).not.toHaveCSS('animation-name','none');
  const forward = await pattern.evaluate(path => {
    const [animation]=path.getAnimations();
    const frames=animation.effect.getKeyframes();
    const position=frame=>new DOMMatrixReadOnly(frame.transform === 'none' ? undefined : frame.transform).m41;
    return position(frames.at(-1)) > position(frames[0]);
  });
  expect(forward).toBe(true);
  const transform=()=>pattern.evaluate(path=>getComputedStyle(path).transform);
  const start=await transform();
  await expect.poll(transform).not.toBe(start);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(pattern).toHaveCSS('animation-name','none');
  await expect(page.locator(selector('active')+' .bar-progress')).toBeVisible();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(pattern).not.toHaveCSS('animation-name','none');
  await clickAction(page,'settings');
  await page.locator('[data-pref="reduceMotion"]').check();
  await page.keyboard.press('Escape');
  await expect(pattern).toHaveCSS('animation-name','none');
  await clickAction(page,'settings');
  await page.locator('[data-pref="reduceMotion"]').uncheck();
  await page.keyboard.press('Escape');
  await expect(pattern).not.toHaveCSS('animation-name','none');

  const download=async kind=>{
    const [file]=await Promise.all([page.waitForEvent('download'),clickAction(page,kind)]);
    return readFile(await file.path());
  };
  const bytes=await download('svg');
  const exported=await page.evaluateHandle(xml=>new DOMParser().parseFromString(xml,'image/svg+xml').documentElement,bytes.toString());
  expect(await exported.evaluate(svg=>svg.querySelectorAll('.bar-progress-texture,.bar-progress-motion,#timeline-progress-stripes,animate,animateTransform').length)).toBe(0);
  const active=await exported.evaluateHandle(svg=>svg.querySelector('.bar-wrapper[data-id="active"]'));
  const staticBar=await active.evaluate(geometry);
  checkGeometry(staticBar,35,false);
  expect(await active.evaluate(group=>group.querySelector('.bar-status-text').textContent)).toBe('審查 <QA> & sign-off');
  await active.dispose();await exported.dispose();
  const normal=await download('png');
  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await download('png');
  expect(normal.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  expect(reduced.equals(normal)).toBe(true);
});

test('task labels move outside short spans and recenter when the scale expands', async ({page}) => {
  const row = page.locator(selector('active'));
  for (const [view, outside] of [['Month', true], ['Week', false], ['Month', true]]) {
    await selectTimelineScale(page, view);
    const metrics = await row.evaluate(group => {
      const bar = group.querySelector('.bar');
      const label = group.querySelector('.bar-label');
      const badge = group.querySelector('.bar-status-badge');
      return {
        x: Number(bar.getAttribute('x')),
        width: Number(bar.getAttribute('width')),
        labelX: Number(label.getAttribute('x')),
        labelWidth: label.getBBox().width,
        outside: label.classList.contains('big'),
        badgeWidth: Number(badge.getAttribute('width')),
        statusWidth: badge.querySelector('text').getComputedTextLength(),
      };
    });
    expect(metrics.outside).toBe(outside);
    const offset = outside ? metrics.width + 5 : (metrics.width - metrics.labelWidth) / 2;
    expect(metrics.labelX).toBeCloseTo(metrics.x + offset, 3);
    expect(metrics.badgeWidth).toBe(Math.min(180, Math.ceil(metrics.statusWidth) + 21));
  }
});
