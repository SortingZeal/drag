import { t } from './i18n.js';
import { GifEncoder } from './gif.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const STYLE_PROPERTIES = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'opacity', 'display', 'visibility', 'filter', 'clip-path',
  'mask', 'paint-order', 'vector-effect', 'color', 'font-family', 'font-size',
  'font-style', 'font-weight', 'font-variant', 'font-stretch', 'letter-spacing',
  'word-spacing', 'text-anchor', 'dominant-baseline', 'alignment-baseline',
  'text-decoration', 'shape-rendering', 'text-rendering',
];

const number = value => Number.parseFloat(value) || 0;
const element = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

function localReferences(value) {
  // Computed styles can turn an internal paint-server URL into an absolute URL.
  return value.replace(/url\(["']?[^)]*#([^\s"')]+)["']?\)/g, 'url(#$1)');
}

function inlineStyles(source, clone) {
  const originals = [source, ...source.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index], copy = copies[index];
    const computed = getComputedStyle(original);
    copy.removeAttribute('style');
    for (const property of STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) copy.style.setProperty(property, localReferences(value));
    }
    for (const attribute of [...copy.attributes]) {
      if (attribute.name.startsWith('on')) copy.removeAttribute(attribute.name);
    }
  }
  clone.querySelectorAll('style, script, animate, animateMotion, animateTransform, set, .drag-anchor')
    .forEach(node => node.remove());
}

function addHeader(host, svg, width) {
  const header = host.querySelector('.grid-header') || host.closest('.timeline-shell')?.querySelector('.grid-header');
  if (!header) return;
  const headerStyle = getComputedStyle(header);
  const height = header.getBoundingClientRect().height || number(headerStyle.height);
  const group = element('g', { 'data-export-header': 'true' });
  group.append(element('rect', {
    x: 0, y: 0, width, height,
    fill: headerStyle.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#f8fafc' : headerStyle.backgroundColor,
  }));

  for (const label of header.querySelectorAll('.upper-text, .lower-text')) {
    const style = getComputedStyle(label);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    // Use the authored canvas coordinate, not the scrolled/sticky screen position.
    const left = number(label.style.left) + number(style.marginLeft);
    const top = number(label.style.top) + number(style.marginTop);
    const rect = label.getBoundingClientRect();
    const labelWidth = rect.width || number(style.width);
    const labelHeight = rect.height || number(style.height) || number(style.fontSize);
    const centered = style.textAlign === 'center';
    const right = style.textAlign === 'right' || style.textAlign === 'end';
    const text = element('text', {
      x: left + (centered ? labelWidth / 2 : right ? labelWidth : 0),
      y: top + labelHeight / 2,
      fill: style.color,
      'text-anchor': centered ? 'middle' : right ? 'end' : 'start',
      'dominant-baseline': 'central',
      'font-family': style.fontFamily,
      'font-size': style.fontSize,
      'font-weight': style.fontWeight,
      'font-style': style.fontStyle,
      'letter-spacing': style.letterSpacing,
      'xml:space': 'preserve',
    });
    text.textContent = label.textContent;
    group.append(text);
  }
  if (number(headerStyle.borderBottomWidth)) group.append(element('line', {
    x1: 0, y1: height, x2: width, y2: height,
    stroke: headerStyle.borderBottomColor,
    'stroke-width': headerStyle.borderBottomWidth,
  }));
  svg.append(group);
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('圖片讀取失敗，請重試', 'Could not read the image. Try again.')));
    reader.readAsDataURL(blob);
  });
}

async function embedImages(svg) {
  await Promise.all([...svg.querySelectorAll('image')].map(async image => {
    const href = image.getAttribute('href') || image.getAttributeNS(XLINK_NS, 'href');
    if (!href || href.startsWith('#') || href.startsWith('data:')) return;
    let response;
    try {
      response = await fetch(href, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await blobDataUrl(await response.blob());
      image.setAttribute('href', data);
      image.removeAttributeNS(XLINK_NS, 'href');
    } catch {
      throw new Error(t('圖表中的圖片讀取失敗，請確認圖片可開啟後再匯出', 'Could not read an image in the chart. Check that it opens, then export again.'));
    }
  }));
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function asPng(svgBlob, width, height, scaleLimit = 2, transparent = false) {
  // Retain the complete timeline while bounding the canvas memory allocation.
  const maxDimension = 16384, maxPixels = 24000000;
  const scale = Math.min(scaleLimit, maxDimension / width, maxDimension / height,
    Math.sqrt(maxPixels / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('瀏覽器無法處理 PNG 圖片，請改用 SVG 匯出', 'This browser cannot create a PNG. Export an SVG instead.'));
  await paintSvg(context, svgBlob, transparent);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    result => result ? resolve(result) : reject(new Error(t('PNG 圖片處理失敗，請重試', 'Could not create the PNG. Try again.'))), 'image/png'));
  return { blob, width: canvas.width, height: canvas.height, scale };
}

async function paintSvg(context, svgBlob, transparent) {
  const { width, height } = context.canvas;
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (transparent) context.clearRect(0, 0, width, height);
    else {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function svgBlob(svg) {
  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
}

function removeMotion(svg) {
  svg.querySelectorAll('.bar-progress-texture, .bar-progress-pattern, #timeline-progress-stripes')
    .forEach(node => node.remove());
}

/** Rasterize a prepared chart copy in deterministic phases, including when preview motion is reduced. */
export async function exportGIF(svg, width, height, options = {}) {
  const scale = Math.min(1, 3200 / width, 3200 / height, Math.sqrt(1920 * 1080 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error(t('瀏覽器無法處理 GIF 圖片', 'This browser cannot create a GIF.'));
  const transparent = options.background === 'transparent';
  const encoder = new GifEncoder(canvas.width, canvas.height, transparent);
  const paths = [...svg.querySelectorAll('.bar-progress-motion')];
  const frames = paths.length && svg.querySelector('.bar-progress-texture') ? 12 : 1;
  const filename = options.filename || 'drag-roadmap.gif';
  svg.setAttribute('width', canvas.width);
  svg.setAttribute('height', canvas.height);
  try {
    for (let i = 0; i < frames; i++) {
      const phase = -16 + 16 * i / frames;
      for (const path of paths) path.setAttribute('transform', `translate(${phase} 0)`);
      await paintSvg(context, svgBlob(svg), transparent);
      encoder.addFrame(context.getImageData(0, 0, canvas.width, canvas.height).data, 15);
      if (i + 1 < frames) await new Promise(resolve => setTimeout(resolve, 0));
    }
    download(encoder.finish(), filename);
    return { filename, format: 'gif', width: canvas.width, height: canvas.height, frames };
  } finally {
    canvas.width = canvas.height = 1;
  }
}

/** Export the standalone presentation renderer at its declared pixel size. */
export async function exportInfographicImage(source, format, options={}) {
  if (!source || !['svg', 'png', 'gif'].includes(format)) throw new Error(t('找不到可下載的圖片，或選擇的格式不受支援', 'No picture is available to download, or the selected format is unsupported.'));
  await document.fonts?.ready;
  const svg = source.cloneNode(true);
  const factor=({fullhd:.5,'2k':2/3,'4k':1})[options.pictureSize]??1;
  const width = Math.round(Number(svg.getAttribute('width'))*factor), height = Math.round(Number(svg.getAttribute('height'))*factor);
  svg.setAttribute('width',width);svg.setAttribute('height',height);
  if(options.background==='transparent')svg.querySelector(':scope > rect')?.remove();
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error(t('圖片尺寸不正確，請重新產生圖片', 'Invalid picture dimensions. Generate the picture again.'));
  svg.setAttribute('xmlns', SVG_NS);
  const filename = options.filename || `drag-simple.${format}`;
  if (format === 'gif') return exportGIF(svg, width, height, { ...options, filename });
  removeMotion(svg);
  const blob = svgBlob(svg);
  if (format === 'svg') {
    download(blob, filename);
    return { filename, format, width, height };
  }
  const raster = await asPng(blob, width, height, 1,options.background==='transparent');
  download(raster.blob, filename);
  return { filename, format, width: raster.width, height: raster.height };
}

/** Download the entire rendered chart, including its HTML date headers. */
export async function exportTimeline(host, format, title = '',options={}) {
  if (!['svg', 'png', 'gif'].includes(format)) throw new Error(t('僅支援 SVG、PNG 或 GIF 圖片', 'Only SVG, PNG and GIF pictures are supported.'));
  if (!host?.querySelector) throw new Error(t('找不到時間軸圖表，請先新增任務', 'No timeline chart found. Add a task first.'));
  const source = host.matches?.('svg') ? host : host.querySelector('svg');
  if (!source) throw new Error(t('請先新增任務後再匯出', 'Add a task before exporting.'));
  await document.fonts?.ready;
  const bounds = source.getBBox();
  const width = Math.ceil(Math.max(source.width.baseVal.value,
    bounds.x + bounds.width, number(source.querySelector('.grid-background')?.getAttribute('width'))));
  const height = Math.ceil(Math.max(source.height.baseVal.value, bounds.y + bounds.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error(t('時間軸圖片尺寸不正確，請重新產生圖表', 'Invalid timeline picture dimensions. Generate the chart again.'));

  const svg = source.cloneNode(true);
  const shell=host.closest('.timeline-shell');
  shell?.classList.add('export-capture');
  try {
    inlineStyles(source, svg);
    addHeader(host, svg, width);
  } finally { shell?.classList.remove('export-capture'); }
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  const background = element('rect', { x: 0, y: 0, width, height, fill: '#fff' });
  if(options.background!=='transparent')svg.prepend(background);
  if (title) {
    const description = element('title');
    description.textContent = title;
    svg.prepend(description);
  }
  await embedImages(svg);
  const filename = options.filename || `drag-roadmap.${format}`;
  if (format === 'gif') return exportGIF(svg, width, height, { ...options, filename });
  removeMotion(svg);
  const blob = svgBlob(svg);
  if (format === 'svg') {
    download(blob, filename);
    return { filename, format, width, height, scale: 1 };
  }
  const raster = await asPng(blob, width, height,options.timelineScale||2,options.background==='transparent');
  download(raster.blob, filename);
  return { filename, format, width: raster.width, height: raster.height, scale: raster.scale };
}
