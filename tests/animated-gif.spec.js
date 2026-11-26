import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { clickAction, globalClick } from './global-actions.js';
import { GifEncoder } from '../src/gif.js';

const seed = JSON.parse(await readFile(new URL('../public/roadmap.en.json', import.meta.url)));
async function mount(page, progressValues, mode, equalLengths = false) {
  const projects = progressValues.map((progress, i) => ({
    ...seed.projects[i],
    phases: [{ id: 'review-' + i, label: 'Design review', status: 'Approval pending',
      start: progress === 100 && i === 1 ? '2028-02-04' : '2028-02-01',
      end: equalLengths || i === 0 ? '2028-04-30' : '2028-02-10',
      ...(progress === null ? {} : { progress }), locks: {} }],
  }));
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

const charts = { partial: [55], complete: [100, 100], mixed: [55, 100, 0, null], stages: [10, 30, 50, 70, 80, 90, 95] };
for (const mode of ['timeline', 'simple']) for (const [sample, values] of Object.entries(charts)) {
  test(`${mode} exports ${sample} progress as a looping GIF with changes confined to moving fills`, async ({ page }) => {
    const compareCadences = sample === 'stages';
    const model = await mount(page, values, mode, compareCadences);
    const chart = page.locator(mode === 'simple' ? '.infographic-preview svg' : '#gantt svg.gantt');
    const motions = chart.locator('.bar-progress-motion, .bar-complete-motion');
    const animatedBars = values.filter(progress => progress > 0).length;
    const hasStripes = values.some(progress => progress > 0 && progress < 100);
    const hasBeam = values.includes(100);
    await expect(motions).toHaveCount(values.filter(p => p > 0 && p < 100).length + Number(hasBeam));
    for (const motion of await motions.all()) await expect(motion).toHaveCSS('animation-name', 'none');
    const gif = await downloadGif(page, mode);
    expect(gif.loops).toBe(0);
    const delay = hasBeam ? 5 : 10;
    expect(gif.frames.every(f => f.delay === delay)).toBe(true);
    const duration = gif.frames.length * delay / 100;
    expect(duration).toBe(hasStripes ? 3.6 : .9);
    expect(gif.width * gif.height).toBeLessThanOrEqual(1920 * 1080);
    expect(Math.max(gif.width, gif.height)).toBeLessThanOrEqual(3200);
    const { width, height } = gif;
    const observed = await chart.evaluate(async (svg, { width, height, frames }) => {
      const view = svg.viewBox.baseVal;
      const scale = view.width ? Math.min(width / view.width, height / view.height) : 1;
      const ox = view.width ? (width - view.width * scale) / 2 : 0;
      const oy = view.height ? (height - view.height * scale) / 2 : 0;
      const regions = Array.from(svg.querySelectorAll('.bar-progress-texture, .bar-complete-texture'), rect => {
        const matrix = svg.getScreenCTM().inverse().multiply(rect.getScreenCTM());
        const bounds = rect.getBBox();
        const corner = new DOMPoint(bounds.x, bounds.y).matrixTransform(matrix);
        const far = new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height).matrixTransform(matrix);
        const row = rect.closest('[data-phase-id], .bar-wrapper[data-id]');
        return { left: corner.x * scale + ox - 2, right: far.x * scale + ox + 2,
          top: corner.y * scale + oy - 2, bottom: far.y * scale + oy + 2,
          area: (far.x - corner.x) * (far.y - corner.y) * scale ** 2,
          task: row.dataset.phaseId || row.dataset.id, changed: 0, halfLoopChanged: 0 };
      });
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      async function draw(frame) {
        const img = new Image();
        img.src = 'data:image/gif;base64,' + frame.body;
        await img.decode();
        ctx.drawImage(img, frame.x, frame.y);
      }
      const pixels = () => new Uint32Array(ctx.getImageData(0, 0, width, height).data.buffer);
      const advance = async i => {
        const previous = frames[i - 1];
        if (previous?.disposal === 2) ctx.clearRect(previous.x, previous.y, previous.w, previous.h);
        await draw(frames[i]);
      };
      await advance(0);
      const first = pixels();
      await advance(1);
      const next = pixels();
      const hasBeam = !!svg.querySelector('.bar-complete-texture');
      for (let i = 2; i < frames.length; i++) {
        await advance(i);
        // A short completed bar can sit entirely between bands in the first two frames.
        if (hasBeam) for (const region of regions) {
          if (region.changed > 12) continue;
          const x = Math.max(0,Math.ceil(region.left)), y = Math.max(0,Math.ceil(region.top));
          const w = Math.min(width - x,Math.floor(region.right) - x), h = Math.min(height - y,Math.floor(region.bottom) - y);
          const crop = new Uint32Array(ctx.getImageData(x, y, w, h).data.buffer);
          for (let j = 0; j < crop.length; j++) {
            if (crop[j] !== first[(y + Math.floor(j / w)) * width + x + j % w]) region.changed++;
          }
        }
      }
      const halfLoop = frames.length > 2 ? pixels() : null;
      let outside = 0, transparent = 0;
      const colors = new Set();
      for (let i = 0; i < first.length; i++) {
        colors.add(first[i]);
        if (first[i] === 0) transparent++;
        const changed = first[i] !== next[i];
        const halfwayChanged = halfLoop && first[i] !== halfLoop[i];
        if (!changed && !halfwayChanged) continue;
        const x = i % width, y = Math.floor(i / width);
        const region = regions.find(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
        if (!region) outside++;
        else {
          if (changed) region.changed++;
          if (halfwayChanged) region.halfLoopChanged++;
        }
      }
      return { regions, outside, transparent, colors: colors.size };
    }, { width, height, frames: gif.frames.slice(0, hasBeam ? 36 : compareCadences ? 19 : 2) });
    expect(observed.colors).toBeGreaterThan(30);
    expect(observed.regions).toHaveLength(animatedBars);
    for (const region of observed.regions) {
      const minimumChange = Math.min(12, region.area * .025);
      expect(region.changed, region.task).toBeGreaterThan(minimumChange);
      if (compareCadences) {
        const task = model.projects.flatMap(p => p.phases).find(task => task.id === region.task);
        // After 1.8 s only an even number of traversals returns to the initial stripe phase.
        const cycles = [0,30,50,70,80,90,95].filter(level => task.progress >= level).length;
        if (cycles % 2 === 0) expect(region.halfLoopChanged, region.task).toBe(0);
        else expect(region.halfLoopChanged, region.task).toBeGreaterThan(minimumChange);
      }
    }
    expect(observed.outside).toBe(0);
    if (sample === 'complete') {
      expect(Math.max(...observed.regions.map(r => r.right - r.left))).toBeGreaterThan(2 * 96);
      const phases = await page.evaluate(measureSharedField, {width, height, frames: gif.frames, regions: observed.regions});
      // Every row must carry the same 45° wave at the same phase in output coordinates.
      for (const phase of phases) {
        expect(phase.coherence).toBeGreaterThan(.9);
        const offset = Math.abs(phase.offset - phases[0].offset);
        expect(Math.min(offset, 96 - offset)).toBeLessThan(4);
      }
    }
    if (mode === 'simple') expect(observed.transparent).toBeGreaterThan(0);
    else expect(observed.transparent).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(model);
  });
}

// Measure the temporal phase of decoded pixel brightness over one whole loop.
// Subtract the expected spatial phase to compare staggered bars and detect a
// restart at either the row's left edge or its top, even through labels.
async function measureSharedField({width, height, frames, regions}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const samples = regions.map(region => {
    const points = [];
    for (let y = Math.ceil(region.top) + 5; y < region.bottom - 5; y += 4) {
      for (let x = Math.ceil(region.left) + 5; x < region.right - 5; x += 4) {
        points.push({x, y, re: 0, im: 0, min: 255, max: 0});
      }
    }
    return points;
  });
  for (const [index, frame] of frames.entries()) {
    const previous = frames[index - 1];
    if (previous?.disposal === 2) ctx.clearRect(previous.x, previous.y, previous.w, previous.h);
    const image = new Image();
    image.src = 'data:image/gif;base64,' + frame.body;
    await image.decode();
    ctx.drawImage(image, frame.x, frame.y);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const theta = 2 * Math.PI * index / frames.length;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    for (const points of samples) for (const point of points) {
      const i = (point.y * width + point.x) * 4;
      const value = .2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2];
      point.min = Math.min(point.min, value);
      point.max = Math.max(point.max, value);
      point.re += value * cos;
      point.im += value * sin;
    }
  }
  return samples.map(points => {
    const wave = 2 * Math.PI / 96;
    let re = 0, im = 0, weight = 0;
    for (const p of points) {
      const a = wave * (p.x + p.y);
      re += p.re * Math.cos(a) + p.im * Math.sin(a);
      im += p.im * Math.cos(a) - p.re * Math.sin(a);
      weight += Math.hypot(p.re, p.im);
    }
    const peaks = points.filter(p => p.max - p.min > 30).map(p => p.max).sort((a,b) => a-b);
    return {offset: Math.atan2(im, re) / wave, coherence: Math.hypot(re, im) / weight,
      medianPeak: peaks[Math.floor(peaks.length / 2)]};
  });
}

for (const mode of ['timeline', 'simple']) {
  test(`${mode} GIF uses the completion light selected in Settings`, async ({page}) => {
    const model = await mount(page, [100], mode);
    const peaks = [];
    for (const style of ['original', 'subtle', 'soft']) {
      await globalClick(page, 'settings');
      await page.locator('[data-settings-category="interface"]').click();
      const select = page.locator('[data-pref="completionLight"]');
      await select.selectOption(style);
      await page.keyboard.press('Escape');
      await expect(page.locator('#settings-dialog')).not.toBeVisible();
      const gif = await downloadGif(page, mode);
      expect(gif.frames).toHaveLength(18);
      expect(gif.frames.every(frame => frame.delay === 5)).toBe(true);
      // This fixture has one moving fill; its second frame encloses that task.
      const {x, y, w, h} = gif.frames[1];
      const regions = [{left: x, top: y, right: x+w, bottom: y+h}];
      const [field] = await page.evaluate(measureSharedField, {...gif, regions});
      expect(field.coherence).toBeGreaterThan(.9);
      peaks.push(field.medianPeak);
    }
    expect(peaks[1]).toBeGreaterThan(peaks[0] + 4);
    expect(peaks[2]).toBeGreaterThan(peaks[1] + 4);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')))).toEqual(model);
  });

  test(`${mode} exports zero and unreported progress as a single GIF frame`, async ({ page }) => {
    await mount(page, [0, null], mode);
    expect((await downloadGif(page, mode)).frames).toHaveLength(1);
  });
}

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

test('transparent GIF patches clear erased pixels across frames and the loop boundary', async ({ page }) => {
  const encoder = new GifEncoder(6, 1, true);
  const colors = { R: [255,0,0,255], B: [0,0,255,255], G: [0,255,0,255], '.': [0,0,0,0] };
  const rgba = text => Uint8Array.from([...text].flatMap(letter => colors[letter]));
  const expected = ['R.B.G.', 'R.BBG.', '..BBG.', '..BBGG'];
  encoder.addFrame(rgba(expected[0]), 15);
  for (const [x, letter] of [[3, 'B'], [0, '.'], [5, 'G']]) {
    encoder.addFrame(rgba(letter), 15, { x, y: 0, width: 1, height: 1 });
  }
  const { frames } = readGif(Buffer.from(await encoder.finish().arrayBuffer()));
  const actual = await page.evaluate(async frames => {
    const canvas = document.createElement('canvas');
    canvas.width = 6; canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (const frame of [...frames, frames[0]]) {
      const image = new Image();
      image.src = 'data:image/gif;base64,' + frame.body;
      await image.decode();
      ctx.drawImage(image, frame.x, frame.y);
      samples.push([...ctx.getImageData(0, 0, 6, 1).data]);
      if (frame.disposal === 2) ctx.clearRect(frame.x, frame.y, frame.w, frame.h);
    }
    return samples;
  }, frames);
  expect(actual).toEqual([...expected, expected[0]].map(text => [...rgba(text)]));
});
