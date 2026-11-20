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

function makePalette(rgba) {
  const histogram = new Map();
  for (let pos = 0; pos < rgba.length; pos += 4) {
    if (rgba[pos + 3] < 128) continue;
    const r = rgba[pos], g = rgba[pos + 1], b = rgba[pos + 2];
    const key = colorBin(r, g, b);
    let sample = histogram.get(key);
    if (!sample) { sample = [0, 0, 0, 0]; histogram.set(key, sample); }
    sample[0] += r; sample[1] += g; sample[2] += b; sample[3]++;
  }
  const colors = Array.from(histogram.values(), sample => {
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
  for (let i = 0; i < out.length; i++) {
    const pos = i * 4;
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
    out[i] = palette.lookup[bin];
  }
  return out;
}

function changedRegion(current, previous, width, height) {
  if (!previous) return { x: 0, y: 0, width, height, pixels: current };
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (current[i] === previous[i]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = y;
    }
  }
  if (right < 0) return { x: 0, y: 0, width: 1, height: 1, pixels: new Uint8Array(1) };
  const w = right - left + 1, h = bottom - top + 1, pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let from = (top + y) * width + left, to = y * w;
    for (let x = 0; x < w; x++, from++, to++) {
      if (current[from] !== previous[from]) pixels[to] = current[from];
    }
  }
  return { x: left, y: top, width: w, height: h, pixels };
}

function lzwBlocks(pixels) {
  // Write GIF's little-endian codes directly into length-prefixed subblocks.
  const bytes = new Uint8Array(pixels.length * 2 + 32);
  let offset = 1, lengthAt = 0, bits = 0, buffer = 0, codeSize = 9, next = 258;
  const dictionary = new Map();
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
    const match = dictionary.get(key);
    if (match !== undefined) { prefix = match; continue; }
    phrase(prefix);
    if (next < 4096) dictionary.set(key, next++);
    else { code(256); dictionary.clear(); next = 258; codeSize = 9; }
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

  addFrame(rgba, delay) {
    if (!this.palette) {
      this.palette = makePalette(rgba);
      this.parts.push(ascii('GIF89a'), Uint8Array.of(...word(this.width), ...word(this.height), 0xf7, 0, 0),
        this.palette.table, Uint8Array.of(0x21, 0xff, 11), ascii('NETSCAPE2.0'), Uint8Array.of(3, 1, 0, 0, 0));
    }
    const current = indexedPixels(rgba, this.palette);
    // Transparent canvases restore the background between full frames. Opaque
    // canvases keep the preceding image and store only the changed rectangle.
    const frame = changedRegion(current, this.previous, this.width, this.height);
    this.parts.push(Uint8Array.of(0x21, 0xf9, 4, this.transparent ? 9 : 5, ...word(delay), 0, 0,
      0x2c, ...word(frame.x), ...word(frame.y), ...word(frame.width), ...word(frame.height), 0, 8),
      lzwBlocks(frame.pixels));
    if (!this.transparent) this.previous = current;
  }

  finish() {
    return new Blob([...this.parts, Uint8Array.of(0x3b)], { type: 'image/gif' });
  }
}
