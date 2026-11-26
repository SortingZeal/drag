export function svgNode(tag, attributes = {}, parent) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) node.setAttribute(key, String(value));
  }
  parent?.append(node);
  return node;
}

// The reported percentage controls both the filled length and its visual weight.
export function progressPaint(progress) {
  const fraction = progress / 100;
  return {fillOpacity: .50 + .46 * fraction, stripeOpacity: .35 + .65 * fraction};
}

const speedThresholds = [30, 50, 70, 80, 90, 95];

function stripeCycles(progress) {
  return 1 + speedThresholds.filter(start => progress >= start).length;
}

export function progressStripes(prefix, progress) {
  return `url(#${prefix}-progress-stripes-${stripeCycles(progress)})`;
}

export function addProgressPatterns(defs, prefix, percentages) {
  const used = new Set(percentages.filter(p => p > 0 && p < 100).map(stripeCycles));
  for (const cycles of used) {
    const pattern = svgNode('pattern', {id: `${prefix}-progress-stripes-${cycles}`, class: 'bar-progress-pattern',
      patternUnits: 'userSpaceOnUse', width: 16, height: 16}, defs);
    // Extend the diagonals one tile either side so translating a period is seamless.
    const stripes = svgNode('path', {class: 'bar-progress-motion', 'data-motion-cycles': cycles,
      d: 'M-16 16l16-16 M0 16L16 0 M16 16L32 0 M32 16L48 0', fill: 'none',
      stroke: '#fff', 'stroke-opacity': .48, 'stroke-width': 4}, pattern);
    stripes.style.setProperty('--stripe-duration', `${3.6 / cycles}s`);
  }
}

// One tile spans a fixed number of screen or export pixels on any chart.
const sheenPitch = 96;
const sheenWidth = 42;
const sheenPeriod = .9;

const completionStops = {
  original: [
    [0, '#163646', 0], [.12, '#163646', .12], [.22, '#fff', .15],
    [.34, '#fff', .43], [.43, '#fff', .56], [.68, '#fff', .67],
    [.78, '#fff', .63], [.91, '#fff', .25], [1, '#fff', 0],
  ],
  subtle: [
    [0, '#26363b', 0], [.12, '#26363b', .09], [.22, '#fff7e9', .13],
    [.34, '#fff8ec', .40], [.45, '#fff9ef', .55], [.56, '#fffbf2', .65],
    [.66, '#fffcf5', .74], [.72, '#fffdf7', .77], [.78, '#fffcf5', .72],
    [.85, '#fffaf0', .49], [.93, '#fff7e9', .20], [1, '#fff7e9', 0],
  ],
  soft: [
    [0, '#163646', 0], [.10, '#163646', .08], [.21, '#fff', .16],
    [.32, '#fff', .33], [.43, '#fffdf5', .48], [.51, '#fffdf6', .63],
    [.61, '#fffef7', .80], [.68, '#fffef9', .87], [.75, '#fffdf5', .78],
    [.82, '#fff', .58], [.91, '#fff', .27], [1, '#fff', 0],
  ],
};

export function setCompletionLight(gradient, style) {
  if (!gradient) return;
  const stops = Object.hasOwn(completionStops, style) ? completionStops[style] : completionStops.original;
  gradient.replaceChildren(...stops.map(([offset, color, opacity]) =>
    svgNode('stop', {offset, 'stop-color': color, 'stop-opacity': opacity})));
}

export function addCompletionSheen(defs, id, style) {
  const gradient = svgNode('linearGradient', {id: id + '-light', class: 'bar-complete-gradient',
    x1: 0, y1: 0, x2: 1, y2: 0}, defs);
  setCompletionLight(gradient, style);

  const pattern = svgNode('pattern', {id, class: 'bar-complete-pattern', patternUnits: 'userSpaceOnUse',
    viewBox: `0 0 ${sheenPitch} 16`, preserveAspectRatio: 'none'}, defs);
  const motion = svgNode('g', {class: 'bar-complete-motion', 'data-motion-distance': sheenPitch,
    'data-motion-seconds': sheenPeriod}, pattern);
  motion.style.setProperty('--beam-travel', `${sheenPitch}px`);
  motion.style.setProperty('--beam-period', `${sheenPeriod}s`);
  // The neighbouring copy enters as the first copy leaves this tile.
  for (const x of [-sheenPitch, 0]) {
    svgNode('rect', {x, y: 0, width: sheenWidth, height: 16, fill: `url(#${id}-light)`}, motion);
  }
  sizeCompletionSheen(pattern);
}

export function sizeCompletionSheen(pattern, pixelsPerUnitX = 1, pixelsPerUnitY = pixelsPerUnitX) {
  pattern.setAttribute('width', sheenPitch / pixelsPerUnitX);
  pattern.setAttribute('height', 16 / pixelsPerUnitY);
  // Shear the entire grid so the 45° bands continue through gaps between rows.
  const shear = -pixelsPerUnitY / pixelsPerUnitX;
  pattern.setAttribute('patternTransform', `matrix(1 0 ${shear} 1 0 0)`);
}

export function addCompletionCheck(layer) {
  const mark = svgNode('g', {class: 'bar-complete-check', 'aria-hidden': 'true', 'pointer-events': 'none'}, layer);
  svgNode('circle', {r: 6, fill: '#163b3b', stroke: '#fff', 'stroke-width': 1}, mark);
  svgNode('path', {d: 'M-3 .1 -1 2.2 3.2 -2.4', fill: 'none', stroke: '#fff',
    'stroke-width': 1.65, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}, mark);
  return mark;
}

export function placeCompletionCheck(mark, x, y, width, height, maxSize, labelLeft, labelRight) {
  const diameter = Math.min(height - 2, maxSize);
  const left = x + 2;
  const right = left + diameter;
  const fits = width >= diameter + 4 && (right + 2 <= labelLeft || left >= labelRight + 2);
  mark.setAttribute('visibility', fits ? 'visible' : 'hidden');
  mark.setAttribute('transform', `translate(${left + diameter / 2} ${y + height / 2}) scale(${diameter / 13})`);
}
