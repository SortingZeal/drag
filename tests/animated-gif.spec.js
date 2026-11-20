import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { clickAction } from './global-actions.js';
import { GifEncoder } from '../src/gif.js';

const seed = JSON.parse(await readFile(new URL('../public/roadmap.en.json', import.meta.url)));
async function mount(page, progress, mode) {
  const phase = { id: 'review', label: 'Design review', status: 'Approval pending',
    start: '2028-02-01', end: '2028-04-30', progress, locks: {} };
  const projects = [{ ...seed.projects[0], phases: [phase] }];
  const model = { ...seed, projects, presentation: { start: '2028-01-01', end: '2028-06-30', locks: {} } };
  await page.addInitScript(({ model, mode }) => {
    localStorage.setItem('drag.draft', JSON.stringify(model));
    const values = { background: mode === 'simple' ? 'transparent' : 'white' };
    localStorage.setItem('drag.preferences', JSON.stringify({ version: 1, values }));
  }, { model, mode });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await clickAction(page, mode);
  return model;
}

// Isolate each image block, keeping the original LZW stream for the browser's
// native GIF decoder. The local image dimensions let us composite frame deltas.
function readGif(bytes) {
  expect(bytes.toString('ascii', 0, 6)).toBe('GIF89a');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  const prefix = bytes.subarray(0, 13 + 3 * (2 << (bytes[10] & 7)));
  let pos = prefix.length, loops = null, control = null;
  const frames = [];
  while (bytes[pos] !== 0x3b) {
    const start = pos, marker = bytes[pos++];
    if (marker === 0x21) {
      const extension = bytes[pos++];
      if (extension === 0xff && bytes.toString('ascii', pos + 1, pos + 12) === 'NETSCAPE2.0') {
        loops = bytes.readUInt16LE(pos + 14);
      }
      while (bytes[pos] > 0) pos += 1 + bytes[pos];
      pos++;
      if (extension === 0xf9) control = bytes.subarray(start, pos);
      continue;
    }
    expect(marker).toBe(0x2c);
    const x = bytes.readUInt16LE(pos), y = bytes.readUInt16LE(pos + 2);
    const w = bytes.readUInt16LE(pos + 4), h = bytes.readUInt16LE(pos + 6);
    expect(bytes[pos + 8] & 128).toBe(0);
    pos += 10; // left, top, width, height, flags and minimum code size
    while (bytes[pos] > 0) pos += 1 + bytes[pos];
    pos++;
    const header = Buffer.from(prefix), block = Buffer.from(bytes.subarray(start, pos));
    header.writeUInt16LE(w, 6);
    header.writeUInt16LE(h, 8);
    block.fill(0, 1, 5); // local image now starts at (0, 0)
    const standalone = Buffer.concat([header, control, block, Buffer.from([0x3b])]);
    frames.push({ x, y, w, h, disposal: control[3] >> 2 & 7, delay: control.readUInt16LE(4),
      body: standalone.toString('base64') });
  }
  expect(pos + 1).toBe(bytes.length);
  return { width, height, loops, frames };
}

async function downloadGif(page, mode) {
  const [file] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'gif')]);
  expect(file.suggestedFilename()).toBe(mode === 'simple' ? 'drag-simple.gif' : 'drag-roadmap.gif');
  return readGif(await readFile(await file.path()));
}

for (const mode of ['timeline', 'simple']) {
  test(`${mode} exports a looping GIF with changes confined to reported completion`, async ({ page }) => {
    const model = await mount(page, 55, mode);
    const chart = page.locator(mode === 'simple' ? '.infographic-preview svg' : '#gantt svg.gantt');
    await expect(chart.locator('.bar-progress-motion')).toHaveCSS('animation-name', 'none');
    const gif = await downloadGif(page, mode);
    expect(gif.loops).toBe(0);
    expect(gif.frames).toHaveLength(12);
    expect(gif.frames.every(f => f.delay === 15)).toBe(true);
    expect(gif.width * gif.height).toBeLessThanOrEqual(1920 * 1080);
    expect(Math.max(gif.width, gif.height)).toBeLessThanOrEqual(3200);
    const { width, height } = gif;
    const observed = await chart.evaluate(async (svg, { width, height, frames }) => {
      const rect = svg.querySelector('.bar-progress-texture');
      const matrix = svg.getScreenCTM().inverse().multiply(rect.getScreenCTM());
      const bounds = rect.getBBox();
      const corner = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
      const far = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix);
      const view = svg.viewBox.baseVal;
      const scale = view.width ? Math.min(width / view.width, height / view.height) : 1;
      const ox = view.width ? (width - view.width * scale) / 2 : 0;
      const oy = view.height ? (height - view.height * scale) / 2 : 0;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      async function draw(frame) {
        const img = new Image();
        img.src = 'data:image/gif;base64,' + frame.body;
        await img.decode();
        ctx.drawImage(img, frame.x, frame.y);
        return new Uint32Array(ctx.getImageData(0, 0, width, height).data.buffer);
      }
      const first = await draw(frames[0]);
      if (frames[0].disposal === 2) ctx.clearRect(0, 0, width, height);
      const next = await draw(frames[1]);
      let changed = 0, outside = 0, transparent = 0;
      const colors = new Set();
      for (let i = 0; i < first.length; i++) {
        colors.add(first[i]);
        if (first[i] === 0) transparent++;
        if (first[i] === next[i]) continue;
        changed++;
        const x = i % width, y = Math.floor(i / width);
        if (x < corner.x * scale + ox - 2 || x > far.x * scale + ox + 2 ||
            y < corner.y * scale + oy - 2 || y > far.y * scale + oy + 2) outside++;
      }
      return { changed, outside, transparent, colors: colors.size };
    }, { width, height, frames: gif.frames.slice(0, 2) });
    expect(observed.colors).toBeGreaterThan(30);
    expect(observed.changed).toBeGreaterThan(12);
    expect(observed.outside).toBe(0);
    if (mode === 'simple') expect(observed.transparent).toBeGreaterThan(0);
    else expect(observed.transparent).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(model);
  });
}

test('a completed task produces a single GIF frame', async ({ page }) => {
  await mount(page, 100, 'simple');
  await expect(page.locator('.infographic-preview .bar-progress-texture')).toHaveCount(0);
  const gif = await downloadGif(page, 'simple');
  expect(gif.frames).toHaveLength(1);
});

test('native GIF decoding reproduces every pixel across LZW code-size changes and resets', async ({ page }) => {
  const width = 256, height = 128;
  const rgba = new Uint8Array(width * height * 4);
  let random = 123;
  for (let pos = 0; pos < rgba.length; pos += 4) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    rgba[pos] = ((random >>> 26) & 3) * 85;
    rgba[pos + 1] = ((random >>> 28) & 3) * 85;
    rgba[pos + 2] = (random >>> 30) * 85;
    rgba[pos + 3] = 255;
  }
  const encoder = new GifEncoder(width, height, false);
  encoder.addFrame(rgba, 15);
  const gif = Buffer.from(await encoder.finish().arrayBuffer());
  const matches = await page.evaluate(async ({ gif, expected }) => {
    const image = new Image();
    image.src = 'data:image/gif;base64,' + gif;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const decoded = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const original = atob(expected);
    return decoded.length === original.length && decoded.every((value, i) => value === original.charCodeAt(i));
  }, { gif: gif.toString('base64'), expected: Buffer.from(rgba).toString('base64') });
  expect(matches).toBe(true);
});
