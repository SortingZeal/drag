import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { clickAction } from './global-actions.js';

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
