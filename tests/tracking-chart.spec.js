import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { selectTimelineScale, clickAction } from './global-actions.js';

const source = JSON.parse(await readFile(new URL('../public/roadmap.en.json', import.meta.url)));
const rows = [
  { label: 'Review', status: 'Awaiting <review> & QA', progress: '37.5' },
  { label: 'Research', progress: 0 },
  { label: 'Delivery', progress: 100 },
  { label: 'Open issue', status: 'On hold' },
];

function trackingFixture() {
  const phases = rows.map((row, i) => ({
    ...row, id: 'tracking-' + i, start: '2028-03-0' + (i + 1), end: '2028-03-0' + (i + 1), locks: {},
  }));
  return {
    ...source,
    projects: [{ ...source.projects[0], color: '#365887', phases }],
    presentation: { start: '2028-01-01', end: '2028-12-31', locks: {} },
  };
}

test('completed task highlight updates both views and survives reload without altering the roadmap', async ({ page }) => {
  const model = trackingFixture();
  await page.addInitScript(draft => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft', JSON.stringify(draft));
  }, model);
  await page.goto('/');
  const chart = {
    timeline: page.locator('#gantt svg.gantt'),
    simple: page.locator('.picture-canvas svg'),
  };
  const preference = page.locator('#pref-completionLight');
  const peak = view => chart[view].locator('.bar-complete-gradient stop').evaluateAll(stops =>
    Math.max(...stops.map(stop => Number(stop.getAttribute('stop-opacity')))));
  await clickAction(page, 'settings');
  await expect(preference).toHaveValue('original');
  await expect(preference.locator('option')).toHaveText(['原版', '微光', '柔光']);
  await page.keyboard.press('Escape');

  for (const [style, opacity] of [['subtle', .77], ['soft', .87], ['original', .67]]) {
    await clickAction(page, 'settings');
    await preference.selectOption(style);
    await expect.poll(() => peak('timeline')).toBe(opacity);
    await page.keyboard.press('Escape');
    await clickAction(page, 'simple');
    await expect.poll(() => peak('simple')).toBe(opacity);
    await clickAction(page, 'timeline');
  }

  await page.locator('#workspace-language').selectOption('en');
  await clickAction(page, 'simple');
  await clickAction(page, 'settings');
  await expect(preference.locator('option')).toHaveText(['Original', 'Subtle glow', 'Soft glow']);
  await preference.selectOption('soft');
  await expect.poll(() => peak('simple')).toBe(.87);
  await page.keyboard.press('Escape');
  await page.reload();
  await clickAction(page, 'settings');
  await expect(preference).toHaveValue('soft');
  await page.locator('[data-reset-pref="completionLight"]').click();
  await expect(preference).toHaveValue('original');
  await page.keyboard.press('Escape');
  const [json] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'save')]);
  expect(JSON.parse(await readFile(await json.path(), 'utf8'))).toEqual(model);
});

for (const mode of ['timeline', 'simple']) {
  test(`${mode} shows reported phase tracking in the preview and the exported drawing`, async ({ page }) => {
    const model = trackingFixture();
    await page.addInitScript(value => localStorage.setItem('drag.draft', JSON.stringify(value)), model);
    await page.goto('/');
    await clickAction(page, mode);
    const timeline = mode === 'timeline';
    const rowSelector = timeline ? '.bar-wrapper[data-id]' : 'g[data-phase-id]';
    const chartSelector = timeline ? '#gantt svg.gantt' : '.infographic-preview svg';
    const chart = page.locator(chartSelector);
    await expect(chart.locator(rowSelector)).toHaveCount(rows.length);

    function readRows(svg, timeline) {
      const nodes = svg.querySelectorAll(timeline ? '.bar-wrapper[data-id]' : 'g[data-phase-id]');
      return Array.from(nodes, node => {
        const label = node.querySelector(timeline ? '.bar-label' : '[data-role=phase-label]');
        const badge = node.querySelector(timeline ? '.bar-status-badge' : '[data-role=phase-status-badge]');
        const status = badge?.querySelector(timeline ? '.bar-status-text' : '[data-role=phase-status]');
        const track = node.querySelector('.bar-progress-track');
        const bar = node.querySelector(timeline ? '.bar' : '[data-role=phase-bar]');
        const fill = node.querySelector('.bar-progress');
        const n = (el, attr) => Number(el.getAttribute(attr));
        const inset = track && n(track, 'y') > n(bar, 'y') &&
          n(track, 'y') + n(track, 'height') < n(bar, 'y') + n(bar, 'height');
        return {
          label: label.textContent, status: status?.textContent ?? null, inset,
          ratio: fill && track ? n(fill, 'width') / n(track, 'width') : null,
        };
      });
    }
    const drawn = await chart.evaluate(readRows, timeline);
    expect(drawn.map(row => row.status)).toEqual(rows.map(row => row.status ?? null));
    expect(drawn[0].label).toContain('Review');
    expect(drawn[0].label).not.toContain(rows[0].status);
    expect(drawn[0].label).toContain('37.5%');
    expect(drawn[1].label).toContain('0%');
    expect(drawn[2].label).toContain('100%');
    expect(drawn[3].label).toContain('Open issue');
    expect(drawn[3].label).not.toContain(rows[3].status);
    expect(drawn[3].label).not.toContain('%');
    expect(drawn.map(row => row.ratio)).toEqual([.375, 0, 1, null].map(ratio => ratio === null ? null : expect.closeTo(ratio, 5)));
    expect(drawn.map(row => row.inset)).toEqual([true, true, true, null]);
    await expect(chart.locator('.bar-progress-texture')).toHaveCount(1);
    await expect(chart.locator('pattern .bar-progress-motion')).toHaveCount(1);
    const shortComplete = chart.locator(rowSelector).nth(2);
    await expect(shortComplete.locator('.bar-complete-check')).toHaveAttribute('visibility', 'hidden');
    await expect(shortComplete.locator('.bar-complete-texture')).toHaveCount(1);
    await expect(chart.locator('review')).toHaveCount(0);

    if (!timeline) {
      const boxes = await chart.locator('[data-role=phase-label], [data-role=phase-status-badge]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
      for (let i = 0; i < boxes.length; i++) {
        for (const other of boxes.slice(i + 1)) {
          const a = boxes[i];
          expect(a.right <= other.left || other.right <= a.left || a.bottom <= other.top || other.bottom <= a.top).toBe(true);
        }
      }
    }

    const [svgDownload] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'svg')]);
    const xml = await readFile(await svgDownload.path(), 'utf8');
    const exported = await page.evaluateHandle(xml => new DOMParser().parseFromString(xml, 'image/svg+xml').documentElement, xml);
    expect(await exported.evaluate(readRows, timeline)).toEqual(drawn);
    expect(await exported.evaluate(svg => svg.querySelectorAll('.bar-progress-texture, .bar-progress-motion').length)).toBe(0);
    const [pngDownload] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'png')]);
    const bytes = await readFile(await pngDownload.path());
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(bytes.readUInt32BE(16)).toBeGreaterThan(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(model);
  });
}

for (const mode of ['timeline', 'simple']) {
  test(`${mode} distinguishes empty, partial and complete progress on screen and in static exports`, async ({ page }) => {
    const percentages = [null, 0, 0.5, 10, 30, 50, 70, 80, 90, 95, 99, 100];
    const model = {
      title: 'Release progress',
      projects: percentages.map((progress, index) => ({
        id: 'project-' + index, name: 'Project ' + index, color: '#267c83', locks: {},
        phases: [{
          id: 'task-' + index, label: 'Delivery', start: '2027-01-11', end: '2027-05-28',
          ...(progress === null ? {} : { progress }), locks: {},
        }],
      })),
      presentation: { start: '2027-01-01', end: '2027-06-30', dateLineMode: 'off', locks: {} },
    };
    await page.addInitScript(draft => localStorage.setItem('drag.draft', JSON.stringify(draft)), model);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await clickAction(page, mode);
    const timeline = mode === 'timeline';
    const chart = page.locator(timeline ? '#gantt svg.gantt' : '.picture-canvas svg');
    const rowSelector = timeline ? '.bar-wrapper[data-id]' : 'g[data-phase-id]';
    const rows = chart.locator(rowSelector);
    await expect(rows).toHaveCount(percentages.length);
    const empty = rows.nth(1).locator('.bar-progress-track');
    await expect(rows.first().locator('.bar-progress-track')).toHaveCount(0);
    await expect(empty).not.toHaveCSS('stroke-dasharray', 'none');
    await expect(rows.nth(1).locator('.bar-progress-texture, .bar-complete-texture')).toHaveCount(0);

    const partials = await rows.evaluateAll(nodes => nodes.slice(2, -1).map(node => {
      const fill = node.querySelector('.bar-progress');
      const track = node.querySelector('.bar-progress-track');
      const stripes = node.querySelector('.bar-progress-texture');
      const id = stripes.getAttribute('fill').match(/^url\(#(.+)\)$/)[1];
      const pattern = stripes.ownerSVGElement.getElementById(id);
      const motion = pattern.querySelector('.bar-progress-motion');
      const animation = motion.getAnimations()[0].effect;
      const keyframes = animation.getKeyframes();
      const offset = frame => new DOMMatrixReadOnly(frame.transform === 'none' ? undefined : frame.transform).m41;
      const travel = offset(keyframes.at(-1)) - offset(keyframes[0]);
      const seconds = animation.getTiming().duration / 1000;
      return {
        ratio: fill.width.baseVal.value / track.width.baseVal.value,
        fillOpacity: Number(getComputedStyle(fill).fillOpacity),
        stripeOpacity: Number(getComputedStyle(stripes).opacity),
        speed: travel / seconds,
        path: pattern.querySelector('path').getAttribute('d'),
        tile: [pattern.width.baseVal.value, pattern.height.baseVal.value],
        sizedToFill: ['x','y','width','height'].every(attr => stripes.getAttribute(attr) === fill.getAttribute(attr)),
        pattern: id,
        tip: Boolean(node.querySelector('.bar-progress-tip')),
      };
    }));
    for (const [index, partial] of partials.entries()) {
      expect(partial.ratio).toBeCloseTo(percentages[index + 2] / 100, 5);
      expect(partial.tip).toBe(false);
      expect(partial.sizedToFill).toBe(true);
      expect(partial.path).toBe('M-16 16l16-16 M0 16L16 0 M16 16L32 0 M32 16L48 0');
      expect(partial.tile).toEqual([16, 16]);
      expect(partial.fillOpacity).toBeCloseTo(.50 + .46 * partial.ratio, 5);
      expect(partial.stripeOpacity).toBeCloseTo(.35 + .65 * partial.ratio, 5);
      if (index > 0) {
        expect(partial.fillOpacity).toBeGreaterThan(partials[index - 1].fillOpacity);
        expect(partial.stripeOpacity).toBeGreaterThan(partials[index - 1].stripeOpacity);
      }
    }
    const milestones = partials.slice(1, -1);
    expect(partials[0].pattern).toBe(milestones[0].pattern);
    expect(new Set(milestones.map(p => p.pattern)).size).toBe(milestones.length);
    for (let i = 0; i < milestones.length; i++) {
      expect(milestones[i].speed).toBeCloseTo(16 * (i + 1) / 3.6, 3);
    }

    const completed = rows.last();
    const sheen = completed.locator('.bar-complete-texture');
    const check = completed.locator('.bar-complete-check');
    const sweep = chart.locator('.bar-complete-pattern');
    await expect(sweep).toHaveAttribute('patternUnits', 'userSpaceOnUse');
    await expect(sweep).toHaveCount(1);
    await expect(check).toBeVisible();
    await expect(completed.locator('.bar-progress-texture')).toHaveCount(0);
    const crop = () => sheen.screenshot({ animations: 'allow' });
    const initial = await crop();
    await expect.poll(async () => initial.equals(await crop())).toBe(false);

    const motion = chart.locator('.bar-complete-motion');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(motion).toHaveCSS('animation-name', 'none');
    const stopped = () => chart.locator('.bar-progress-motion').evaluateAll(nodes =>
      nodes.every(node => getComputedStyle(node).animationName === 'none'));
    expect(await stopped()).toBe(true);
    await expect(check).toBeVisible();
    const still = await completed.screenshot({ animations: 'allow' });
    expect(await completed.screenshot({ animations: 'allow' })).toEqual(still);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await clickAction(page, 'settings');
    await page.locator('[data-pref="reduceMotion"]').check();
    await page.keyboard.press('Escape');
    await expect(motion).toHaveCSS('animation-name', 'none');
    expect(await stopped()).toBe(true);

    const [download] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'svg')]);
    const xml = await readFile(await download.path(), 'utf8');
    const exported = await page.evaluateHandle(xml => new DOMParser().parseFromString(xml, 'image/svg+xml'), xml);
    const drawing = await exported.evaluate((doc, rowSelector) => {
      const rows = Array.from(doc.querySelectorAll(rowSelector));
      const emptyTrack = rows[1].querySelector('.bar-progress-track');
      return {
        dash: emptyTrack.style.strokeDasharray || emptyTrack.getAttribute('stroke-dasharray'),
        check: Boolean(rows.at(-1).querySelector('.bar-complete-check')),
        tips: rows.map(row => Boolean(row.querySelector('.bar-progress-tip'))),
        motion: doc.querySelectorAll('.bar-complete-texture, .bar-complete-pattern, .bar-complete-gradient, .bar-complete-motion, .bar-progress-texture, .bar-progress-motion').length,
      };
    }, rowSelector);
    expect(drawing.dash).toBeTruthy();
    expect(drawing.dash).not.toBe('none');
    expect(drawing.check).toBe(true);
    expect(drawing.tips).not.toContain(true);
    expect(drawing.motion).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(model);
  });
}


for (const mode of ['timeline', 'simple']) {
  test(`${mode} completed tasks reveal one field of evenly spaced diagonal bands`, async ({ page }) => {
    const model = {
      title: 'Completed tasks',
      projects: ['2027-01-15','2027-01-24','2027-02-15','2027-04-30'].map((end, i) => ({
        name: 'Project ' + i, id: 'p' + i, color: '#23786b',
        phases: [{ id: 'done-' + i, label: 'Finished', start:['2027-01-03','2027-01-12','2027-01-09','2027-01-01'][i], end, progress:100 }],
      })),
      presentation: {start:'2027-01-01',end:'2027-05-01',dateLineMode:'off'},
    };
    await page.addInitScript(draft => localStorage.setItem('drag.draft', JSON.stringify(draft)), model);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await clickAction(page, mode);
    const chart = page.locator(mode === 'simple' ? '.picture-canvas svg' : '#gantt svg.gantt');
    await expect(chart.locator('.bar-complete-texture')).toHaveCount(4);
    for (const zoomed of [false, true]) {
      if (zoomed) {
        if (mode === 'simple') await page.locator('[data-picture-action="zoom-in"]').click();
        else await selectTimelineScale(page, 'Week');
      }
      const field = await chart.evaluate(svg => {
        const patterns = svg.querySelectorAll('.bar-complete-pattern');
        const pattern = patterns[0];
        const motion = pattern.querySelector('.bar-complete-motion');
        const duration = motion.getAnimations()[0].effect.getTiming().duration / 1000;
        const root = svg.getScreenCTM();
        const pitch = pattern.width.baseVal.value * root.a;
        const tile = pattern.viewBox.baseVal.width;
        const bandWidth = motion.querySelector('rect').width.baseVal.value * pitch / tile;
        const shear = pattern.patternTransform.baseVal.consolidate().matrix.c;
        const rows = Array.from(svg.querySelectorAll('.bar-complete-texture'), node => {
          const screen = node.getScreenCTM();
          const box = node.getBoundingClientRect();
          return { fill: node.getAttribute('fill'), x: box.x, width: box.width,
            offsetX: screen.e - root.e, offsetY: screen.f - root.f };
        });
        return { count: patterns.length, paint: `url(#${pattern.id})`, rows, pitch, bandWidth,
          tilt: Math.atan(-shear * root.a / root.d) * 180 / Math.PI, duration };
      });
      expect(field.count).toBe(1);
      expect(field.pitch).toBeCloseTo(96, 1);
      expect(field.bandWidth).toBeCloseTo(42, 1);
      expect(field.tilt).toBeCloseTo(45, 1);
      expect(field.duration).toBeCloseTo(0.9, 3);
      const [early, later, medium, long] = field.rows;
      expect(later.x).toBeGreaterThan(early.x);
      expect(later.width).toBeCloseTo(early.width, 1);
      expect(medium.width).toBeGreaterThan(early.width);
      expect(long.width).toBeGreaterThan(2 * field.pitch + field.bandWidth);
      for (const row of field.rows) {
        expect(row.fill).toBe(field.paint);
        expect(row.offsetX).toBeCloseTo(0, 1);
        expect(row.offsetY).toBeCloseTo(0, 1);
      }
    }
  });
}
