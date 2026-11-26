// GIF89a with one adaptive palette for the whole loop. Keeping the palette fixed
// prevents stationary labels and gradients from changing color between frames.
const colorBin = (r, g, b) => ((r >>> 3) << 10) | ((g >>> 3) << 5) | (b >>> 3);
const word = value => [value & 255, value >>> 8];
const ascii = value => Uint8Array.from(value, char => char.charCodeAt(0));

function paletteBox(colors) {
  const lo = [255, 255, 255], hi = [0, 0, 0];
  let weight = 0;
  for (const color of colors) {
    for (let channel = 0; channel < 3; channel++) {
      lo[channel] = Math.min(lo[channel], color[channel]);
      hi[channel] = Math.max(hi[channel], color[channel]);
    }
    weight += color[3];
  }
  const ranges = hi.map((value, channel) => value - lo[channel]);
  const channel = ranges.indexOf(Math.max(...ranges));
  return { colors, weight, channel, priority: colors.length > 1 ? ranges[channel] * Math.sqrt(weight) : 0 };
}

// Compare complete RGBA pixels independently of native byte order.
function pixelWords(rgba) {
  const aligned = rgba.byteOffset % 4 ? rgba.slice() : rgba;
  return new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 4);
}

function makePalette(rgba) {
  const histogram = new Array(32768);
  const samples = [];
  const pixels = pixelWords(rgba);
  for (let i = 0; i < pixels.length;) {
    const first = i++, word = pixels[first];
    while (i < pixels.length && pixels[i] === word) i++;
    const pos = first * 4;
    if (rgba[pos + 3] < 128) continue;
    const count = i - first, r = rgba[pos], g = rgba[pos + 1], b = rgba[pos + 2];
    const key = colorBin(r, g, b);
    let sample = histogram[key];
    if (!sample) {
      sample = histogram[key] = [0, 0, 0, 0];
      samples.push(sample);
    }
    sample[0] += count * r; sample[1] += count * g; sample[2] += count * b; sample[3] += count;
  }
  const colors = samples.map(sample => {
    const count = sample[3];
    return [sample[0] / count, sample[1] / count, sample[2] / count, Math.sqrt(count)];
  });
  if (!colors.length) colors.push([255, 255, 255, 1]);
  const boxes = [paletteBox(colors)];
  while (boxes.length < 255) {
    let best = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i].priority > boxes[best].priority) best = i;
    const box = boxes[best];
    if (!box.priority) break;
    const sorted = box.colors.sort((a, b) => a[box.channel] - b[box.channel]);
    let split = 0, weight = 0;
    do { weight += sorted[split++][3]; } while (split < sorted.length - 1 && weight < box.weight / 2);
    boxes[best] = paletteBox(sorted.slice(0, split));
    boxes.push(paletteBox(sorted.slice(split)));
  }
  // Index zero is transparent, also used for unchanged pixels in later frames.
  const table = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    for (let channel = 0; channel < 3; channel++) {
      const sum = box.colors.reduce((total, color) => total + color[channel] * color[3], 0);
      table[3 * (i + 1) + channel] = Math.round(sum / box.weight);
    }
  });
  return { table, count: boxes.length, lookup: new Uint8Array(32768) };
}

function indexedPixels(rgba, palette) {
  const out = new Uint8Array(rgba.length / 4);
  const pixels = pixelWords(rgba);
  for (let i = 0; i < out.length;) {
    const first = i++, word = pixels[first];
    while (i < out.length && pixels[i] === word) i++;
    const pos = first * 4;
    if (rgba[pos + 3] < 128) continue;
    const r = rgba[pos], g = rgba[pos + 1], b = rgba[pos + 2];
    const bin = colorBin(r, g, b);
    if (!palette.lookup[bin]) {
      let nearest = 1, distance = Infinity;
      for (let j = 1; j <= palette.count; j++) {
        const dr = r - palette.table[j * 3], dg = g - palette.table[j * 3 + 1], db = b - palette.table[j * 3 + 2];
        const score = 2 * dr * dr + 4 * dg * dg + db * db;
        if (score < distance) { distance = score; nearest = j; }
      }
      palette.lookup[bin] = nearest;
    }
    out[first] = palette.lookup[bin];
    if (i > first + 1) out.fill(out[first], first + 1, i);
  }
  return out;
}

// Compare a canvas patch against the full preceding image. A transparent GIF
// pixel skips painting, so erasing an opaque pixel requires background disposal.
function changedRegion(current, previous, stride, patch) {
  const { x, y, width, height } = patch;
  let left = width, top = height, right = -1, bottom = -1;
  for (let row = 0; row < height; row++) {
    let src = row * width, dst = (y + row) * stride + x;
    for (let col = 0; col < width; col++, src++, dst++) {
      if (current[src] === previous[dst]) continue;
      if (current[src] === 0) return null;
      left = Math.min(left, col); right = Math.max(right, col);
      top = Math.min(top, row); bottom = row;
    }
  }
  if (right < 0) return { x: 0, y: 0, width: 1, height: 1, pixels: new Uint8Array(1) };
  const w = right - left + 1, h = bottom - top + 1, pixels = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    let src = (row + top) * width + left, dst = (row + top + y) * stride + x + left;
    let to = row * w;
    for (let col = 0; col < w; col++, src++, dst++, to++) {
      if (current[src] !== previous[dst]) pixels[to] = current[src];
    }
  }
  return { x: x + left, y: y + top, width: w, height: h, pixels };
}

function lzwBlocks(pixels) {
  // Write GIF's little-endian codes directly into length-prefixed subblocks.
  const bytes = new Uint8Array(pixels.length * 2 + 32);
  let offset = 1, lengthAt = 0, bits = 0, buffer = 0, codeSize = 9, next = 258;
  // At most 3838 dictionary entries are live. A half-full table keeps probing
  // short without allocating a JS object for each new prefix/suffix pair.
  const dictionary = new Uint32Array(8192);
  function byte(value) {
    bytes[offset++] = value;
    if (offset - lengthAt === 256) { bytes[lengthAt] = 255; lengthAt = offset++; }
  }
  function code(value) {
    buffer |= value << bits;
    bits += codeSize;
    while (bits >= 8) { byte(buffer & 255); bits -= 8; buffer >>>= 8; }
  }
  function phrase(value) {
    code(value);
    // The decoder installs each dictionary entry one emitted phrase later.
    if (next === 1 << codeSize && codeSize < 12) codeSize++;
  }
  code(256);
  let prefix = pixels[0];
  for (let pos = 1; pos < pixels.length; pos++) {
    const suffix = pixels[pos], key = (prefix << 8) | suffix;
    let slot = Math.imul(key, 0x9e3779b1) >>> 19;
    while (dictionary[slot] && (dictionary[slot] >>> 12) !== key) slot = (slot + 1) & 8191;
    if (dictionary[slot]) { prefix = dictionary[slot] & 4095; continue; }
    phrase(prefix);
    if (next < 4096) dictionary[slot] = (key << 12) | next++;
    else { code(256); dictionary.fill(0); next = 258; codeSize = 9; }
    prefix = suffix;
  }
  phrase(prefix); code(257);
  if (bits) byte(buffer & 255);
  const last = offset - lengthAt - 1;
  bytes[lengthAt] = last;
  if (last) bytes[offset++] = 0;
  return bytes.slice(0, offset);
}

export class GifEncoder {
  constructor(width, height, transparent) {
    this.width = width;
    this.height = height;
    this.transparent = transparent;
    this.parts = [];
  }

  writeFrame(frame, delay, dispose = 1) {
    this.parts.push(Uint8Array.of(0x21, 0xf9, 4, dispose * 4 + 1, ...word(delay), 0, 0,
      0x2c, ...word(frame.x), ...word(frame.y), ...word(frame.width), ...word(frame.height), 0, 8),
      lzwBlocks(frame.pixels));
    this.lastDelay = delay;
  }

  clearAfterPreviousFrame() {
    // Disposal clears the previous image descriptor's rectangle. Expand it to
    // the full canvas so a newly transparent pixel can occur anywhere.
    this.parts.splice(-2);
    this.writeFrame({ x: 0, y: 0, width: this.width, height: this.height, pixels: this.previous }, this.lastDelay, 2);
  }

  addFrame(rgba, delay, patch = { x: 0, y: 0, width: this.width, height: this.height }) {
    if (!this.palette) {
      this.palette = makePalette(rgba);
      this.parts.push(ascii('GIF89a'), Uint8Array.of(...word(this.width), ...word(this.height), 0xf7, 0, 0),
        this.palette.table, Uint8Array.of(0x21, 0xff, 11), ascii('NETSCAPE2.0'), Uint8Array.of(3, 1, 0, 0, 0));
      this.previous = indexedPixels(rgba, this.palette);
      if (this.transparent) this.first = this.previous;
      this.writeFrame({ ...patch, pixels: this.previous }, delay);
      return;
    }

    const current = indexedPixels(rgba, this.palette);
    if (this.previous === this.first) this.previous = this.previous.slice();
    const delta = changedRegion(current, this.previous, this.width, patch);
    if (!delta) this.clearAfterPreviousFrame();
    for (let row = 0; row < patch.height; row++) {
      const start = row * patch.width;
      this.previous.set(current.subarray(start, start + patch.width), (row + patch.y) * this.width + patch.x);
    }
    this.writeFrame(delta || { x: 0, y: 0, width: this.width, height: this.height, pixels: this.previous }, delay);
  }

  finish() {
    // The last-to-first transition needs the same transparency rules as the
    // other frames. Retain the original canvas for the next loop.
    if (this.first && this.first !== this.previous) {
      for (let i = 0; i < this.first.length; i++) {
        if (!this.first[i] && this.previous[i]) {
          this.clearAfterPreviousFrame();
          break;
        }
      }
    }
    return new Blob([...this.parts, Uint8Array.of(0x3b)], { type: 'image/gif' });
  }
}
