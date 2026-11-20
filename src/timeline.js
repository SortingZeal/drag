import Gantt from 'frappe-gantt';
import 'frappe-gantt/style.css';
import { assertTimelineRenderBudget } from './model.js';
import { t, localeTag } from './i18n.js';

const DAY = 86400000;
export const ordinal = iso => Date.parse(`${iso}T00:00:00Z`) / DAY;
export const isoDay = n => new Date(Math.round(n) * DAY).toISOString().slice(0, 10);
const localISO = d => `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthName = d => t(`${d.getMonth() + 1}月`, new Intl.DateTimeFormat(localeTag(), { month: 'short' }).format(d));

function svgElement(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function trackingDefs(svg, bars) {
  const defs = svgElement('defs', {});
  svg.prepend(defs);
  if (bars.some(({task}) => task.progress > 0 && task.progress < 100)) {
    const stripes = svgElement('pattern', {
      id: 'timeline-progress-stripes', patternUnits: 'userSpaceOnUse', width: 16, height: 16,
    });
    // Extend the diagonals one tile either side so translating a period is seamless.
    stripes.append(svgElement('path', {
      class: 'bar-progress-motion', d: 'M-16 16l16-16 M0 16L16 0 M16 16L32 0 M32 16L48 0',
      fill: 'none', stroke: '#fff', 'stroke-opacity': '.27', 'stroke-width': 4,
    }));
    defs.append(stripes);
  }
  return defs;
}

function addProgressLayer(bar, defs) {
  const trackId = 'timeline-track-' + bar.task.id;
  const clipId = 'timeline-clip-' + bar.task.id;
  const clip = svgElement('clipPath', {id: clipId});
  clip.append(svgElement('use', {href: '#' + trackId}));
  defs.append(clip);
  const layer = svgElement('g', {
    class: 'bar-tracking-layer', 'aria-hidden': 'true', 'pointer-events': 'none',
  });
  const y = bar.y + 4, height = bar.height - 8;
  bar.progressTrack = svgElement('rect', {
    id: trackId, class: 'bar-progress-track', y, height, rx: 3, ry: 3,
    fill: bar.labelInk, 'fill-opacity': '.1', stroke: bar.labelInk, 'stroke-opacity': '.55', 'stroke-width': '.75',
  });
  const paint = svgElement('g', {'clip-path': `url(#${clipId})`});
  const fill = bar.$bar_progress;
  fill.replaceWith(layer);
  layer.append(bar.progressTrack, paint);
  paint.append(fill);
  fill.setAttribute('rx', 0);
  fill.setAttribute('ry', 0);
  fill.setAttribute('y', y);
  fill.setAttribute('height', height);
  fill.style.fill = bar.labelInk;
  fill.setAttribute('fill-opacity', '.47');
  if (bar.task.progress > 0 && bar.task.progress < 100) {
    bar.progressTexture = svgElement('rect', {
      class: 'bar-progress-texture', y, height, fill: 'url(#timeline-progress-stripes)',
    });
    paint.append(bar.progressTexture);
  }
}

function addStatusBadge(bar) {
  const status = bar.task.status;
  if (!status) return;
  // The badge sits in the gap above its own row, independent of the date span.
  const badge = svgElement('svg', {
    class: 'bar-status-badge', y: bar.y - 10, height: 13, overflow: 'hidden',
    'pointer-events': 'none', role: 'img', 'aria-label': status,
  });
  const background = svgElement('rect', {
    x: .5, y: .5, height: 12, rx: 4, fill: '#f6f8fa', stroke: '#a0abb5', 'stroke-width': .8,
  });
  const label = svgElement('text', {
    class: 'bar-status-text', x: 5, y: 6.8, 'dominant-baseline': 'central',
    fill: '#263746', 'font-size': 10, 'font-weight': 600,
  });
  label.textContent = status;
  badge.append(background, label);
  bar.bar_group.append(badge);
  const width = Math.min(180, Math.ceil(label.getComputedTextLength()) + 11);
  badge.setAttribute('width', width);
  background.setAttribute('width', width - 1);
  bar.statusBadge = badge;
}

function viewMode(name, left, right, snapDays) {
  const common = { name, padding: [`${left}m`, `${right}m`], date_format: 'YYYY-MM-DD', upper_text_frequency: 1 };
  const year = (d, prev) => !prev || d.getFullYear() !== prev.getFullYear() ? String(d.getFullYear()) : '';
  const modes = {
    Day: { step: '1d', column_width: 38, lower_text: 'D', upper_text: (d, p) => !p || d.getMonth() !== p.getMonth() ? `${d.getFullYear()} / ${monthName(d)}` : '', upper_text_frequency: 30 },
    Week: { step: '7d', column_width: 80, lower_text: 'MM-DD', upper_text: (d, p) => !p || d.getMonth() !== p.getMonth() ? `${d.getFullYear()} / ${monthName(d)}` : '', upper_text_frequency: 4 },
    Month: { step: '1m', column_width: 100, lower_text: monthName, upper_text: year, upper_text_frequency: 12 },
    Quarter: { step: '3m', column_width: 130, lower_text: d => `Q${Math.floor(d.getMonth() / 3) + 1}`, upper_text: year, upper_text_frequency: 4 },
    Year: { step: '1y', column_width: 130, lower_text: 'YYYY', upper_text: (d, p) => !p || Math.floor(d.getFullYear() / 10) !== Math.floor(p.getFullYear() / 10) ? `${Math.floor(d.getFullYear() / 10) * 10}` : '', upper_text_frequency: 10 },
  };
  const mode = { ...common, ...modes[name] };
  // Whole-pixel pointers must resolve every snap interval in coarse views.
  // Two pixels per interval keep rounding at both endpoints below half a step.
  const maximumDays = { Day: 1, Week: 7, Month: 31, Quarter: 92, Year: 366 }[name];
  mode.column_width = Math.max(mode.column_width, Math.ceil(maximumDays * 2 / snapDays));
  return mode;
}

// This hook is intentionally version-pinned to 1.2.2. Upstream gestures use
// fractional month arithmetic and a document listener without a destroy API.
class CalendarGantt extends Gantt {
  bind_bar_events() {}
  setup_gantt_dates(refresh) {
    super.setup_gantt_dates(refresh);
    if (this.config.view_mode.name === 'Quarter') this.gantt_start.setMonth(Math.floor(this.gantt_start.getMonth() / 3) * 3, 1);
    if (this.config.view_mode.name === 'Year') this.gantt_start.setMonth(0, 1);
    if (this.config.view_mode.name === 'Week') this.gantt_start.setDate(this.gantt_start.getDate() - (this.gantt_start.getDay() + 6) % 7);
  }
}

export class Timeline {
  constructor(host, { tasks, view, snap, left, right, onCommit, onSelect, onExtend, autoPan=true }) {
    assertTimelineRenderBudget(tasks, view, left, right);
    this.tasks = tasks;
    this.host = host;
    this.viewport = host.closest('.preview');
    this.snap = snap === 'auto' ? ({ Day: 1, Week: 1, Month: 7, Quarter: 7, Year: 30 })[view] : Number.parseInt(snap);
    this.autoPan=autoPan;
    this.onCommit = onCommit;
    this.onSelect = onSelect;
    this.onExtend = onExtend;
    this.left = left;
    this.right = right;
    this.abort = new AbortController();
    this.hostLayout = new Map(['width', 'height', '--timeline-header-height'].map(name => [name, host.style.getPropertyValue(name)]));
    // The date ruler and task viewport are separate grid rows. Task content is
    // clipped by its own scrolling viewport instead of sliding under a sticky
    // date overlay. Keep .preview as the scroll element used by the editor.
    this.shell = document.createElement('div');
    this.shell.className = 'timeline-shell';
    this.dateDock = document.createElement('div');
    this.dateDock.className = 'timeline-date-dock';
    this.dateTrack = document.createElement('div');
    this.dateTrack.className = 'timeline-date-track gantt-container';
    this.dateDock.append(this.dateTrack);
    this.viewport.before(this.shell);
    this.shell.append(this.dateDock, this.viewport);
    this.viewport.classList.add('timeline-viewport');
    this.chart = new CalendarGantt(host, tasks, {
      view_mode: viewMode(view, left, right, this.snap), infinite_padding: false,
      bar_height: 25, padding: 20, readonly_progress: true, move_dependencies: false,
      scroll_to: null, today_button: false, popup: false, snap_at: `${this.snap}d`,
    });
    this.align();
    const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: this.abort.signal });
    listen(host, 'pointerdown', e => this.start(e), { capture: true });
    listen(this.dateDock, 'pointerdown', e => this.startHeaderPan(e), { capture: true });
    // Frappe 1.2.2 resolves hover highlights below its task container. The
    // date dock now lives outside that container, so retain the same delayed
    // highlight using the bar's actual node instead of that stale lookup.
    const hover = e => {
      if (!e.target.matches?.('.bar-wrapper')) return;
      e.stopPropagation();
      const bar = this.chart.bars.find(candidate => candidate.group === e.target);
      if (!bar) return;
      clearTimeout(this.hoverTimer);
      if (e.type === 'mouseleave') bar.$date_highlight.classList.add('hide');
      else this.hoverTimer = setTimeout(() => {
        if (bar.$date_highlight.isConnected) bar.$date_highlight.classList.remove('hide');
      }, 200);
    };
    listen(host, 'mouseenter', hover, { capture: true });
    listen(host, 'mouseleave', hover, { capture: true });
    listen(window, 'pointermove', e => this.move(e));
    listen(window, 'pointerup', e => this.finish(e));
    listen(window, 'pointercancel', () => this.cancel());
    listen(window, 'blur', () => this.cancel());
    listen(window, 'keydown', e => { if (e.key === 'Escape') this.cancel(); });
    listen(host, 'lostpointercapture', () => { if (this.active || this.headerPan) this.cancel(); });
    listen(this.dateDock, 'dragstart', e => {
      if (e.target.closest('.grid-header')) { e.preventDefault(); e.stopPropagation(); }
    }, { capture: true });
    listen(this.viewport, 'scroll', () => {
      this.syncHeader();
      if(this.scrollAnchor&&Math.abs(this.viewport.scrollLeft-this.scrollAnchor.left)>.1)this.scrollAnchor=null;
      // Toolbar navigation and date-bound changes must not undo themselves by
      // immediately scheduling another automatic extension at the reached edge.
      if (this.programmaticScroll != null && Math.abs(this.viewport.scrollLeft - this.programmaticScroll) < 1) { this.programmaticScroll = null; return; }
      this.programmaticScroll = null;
      this.scheduleExtend();
    });
    const wheel = e => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewport.clientWidth : 1;
      const dx = (e.deltaX || (e.shiftKey ? e.deltaY : 0)) * unit;
      const dy = e.shiftKey ? 0 : e.deltaY * unit;
      if (!dx && !dy) return;
      // Horizontal overflow is hidden so the date strip is the primary handle.
      // Apply both axes explicitly so WebKit cannot latch a new vertical wheel
      // event to the preceding horizontal gesture. Keep trackpad momentum deltas.
      e.preventDefault();
      this.viewport.scrollLeft += dx;
      if (dy) this.viewport.scrollTop += dy;
      this.syncHeader();
      const max = this.viewport.scrollWidth - this.viewport.clientWidth;
      // At an already reached boundary there is no new scroll event. An
      // outward horizontal wheel gesture must still be able to add dates.
      if ((dx < 0 && this.viewport.scrollLeft < 40) || (dx > 0 && this.viewport.scrollLeft > max - 40)) this.scheduleExtend();
    };
    listen(this.viewport, 'wheel', wheel, { passive: false });
    listen(this.dateDock, 'wheel', wheel, { passive: false });
  }

  // Calendar ticks remain evenly spaced, while dates interpolate by the actual
  // number of days in each month/quarter/year, including leap years and DST.
  ticks() { return this.chart.dates.map(d => ordinal(localISO(d))); }
  dateToX(iso) {
    const n = typeof iso === 'number' ? iso : ordinal(iso), ticks = this.ticks();
    let i = Math.max(0, ticks.findIndex((d, j) => j < ticks.length - 1 && n >= d && n < ticks[j + 1]));
    if (n >= ticks.at(-1)) i = ticks.length - 2;
    return (i + (n - ticks[i]) / (ticks[i + 1] - ticks[i])) * this.chart.config.column_width;
  }
  xToDay(x) {
    const ticks = this.ticks(), unit = x / this.chart.config.column_width;
    const i = Math.max(0, Math.min(ticks.length - 2, Math.floor(unit)));
    return ticks[i] + (unit - i) * (ticks[i + 1] - ticks[i]);
  }
  drawBar(bar, start, end) {
    const x = this.dateToX(start), width = this.dateToX(ordinal(end) + 1) - x;
    bar.x = x; bar.width = width;
    bar.$bar.setAttribute('x', x); bar.$bar.setAttribute('width', width);
    bar.$date_highlight.style.left = `${x}px`; bar.$date_highlight.style.width = `${width}px`;
    bar.update_label_position(); bar.update_handle_position();
    bar.statusBadge?.setAttribute('x', x);
    if (bar.task.hasProgress) {
      // Narrow date ranges retain a proportional inset even below one pixel.
      const inset = Math.min(4, width * .1);
      const trackWidth = width - 2 * inset, trackX = x + inset;
      bar.progressTrack.setAttribute('x', trackX);
      bar.progressTrack.setAttribute('width', trackWidth);
      const completedWidth = trackWidth * bar.task.progress / 100;
      bar.$bar_progress.setAttribute('x', trackX);
      bar.$bar_progress.setAttribute('width', completedWidth);
      bar.progressTexture?.setAttribute('x', trackX);
      bar.progressTexture?.setAttribute('width', completedWidth);
    }
    const label = bar.group.querySelector('.bar-label');
    if (!label.classList.contains('big') && (!bar.task.light || bar.task.hasProgress)) label.style.fill = bar.labelInk;
    else label.style.removeProperty('fill');
    bar.group.dataset.start = start; bar.group.dataset.end = end;
  }
  align() {
    // Upstream SMIL replays its approximate widths after rendering. Static bar
    // geometry must remain the calendar geometry used for pointer hit testing.
    this.host.querySelectorAll('animate, animateMotion, animateTransform').forEach(node => node.remove());
    const bars = this.chart.bars;
    const defs = bars.some(bar => bar.task.hasProgress) ? trackingDefs(this.chart.$svg, bars) : null;
    for (const bar of bars) {
      if (bar.task.fontSize) bar.group.querySelector('.bar-label').style.fontSize = `${bar.task.fontSize}px`;
      bar.$bar.style.fill = bar.task.color;
      const [r, g, b] = bar.task.color.slice(1).match(/../g).map(hex => {
        const value = parseInt(hex, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      bar.labelInk = bar.task.light || r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? '#17221a' : '#ffffff';
      if (bar.task.hasProgress) {
        bar.group.style.setProperty('--progress-label-halo', bar.labelInk === '#ffffff' ? '#17221a' : '#fff');
        addProgressLayer(bar, defs);
      } else {
        // Frappe normalizes a missing percentage to zero on its task copy.
        bar.$bar_progress.remove();
      }
      addStatusBadge(bar);
      this.drawBar(bar, bar.task.start, bar.task.end);
      // Upstream hover builds CSS selectors from task.id without escaping.
      // Keep that id internal and safe while exposing the user's stable id.
      bar.group.dataset.id = bar.task._modelId;
      bar.group.classList.toggle('light', bar.task.light);
      bar.$bar.style.opacity = bar.task.light ? '0.4' : '1';
    }
    // Upstream holiday rectangles also use approximate month arithmetic.
    this.host.querySelectorAll('.holiday-highlight').forEach(el => {
      const date = [...el.classList].find(c => /^\d{4}-\d{2}-\d{2}$/.test(c));
      if (date) { el.setAttribute('x', this.dateToX(date)); el.setAttribute('width', this.dateToX(ordinal(date) + 1) - this.dateToX(date)); }
    });
    const today = this.host.querySelector('.current-highlight');
    if (today) today.style.left = `${this.dateToX(localISO(new Date()))}px`;
    const ball = this.host.querySelector('.current-ball-highlight');
    if (ball) ball.style.left = `${this.dateToX(localISO(new Date())) - 2.5}px`;
    this.dockHeader();
  }
  dockHeader() {
    const height = this.chart.config.header_height;
    this.shell.style.setProperty('--timeline-header-height', `${height}px`);
    this.host.style.setProperty('--timeline-header-height', `${height}px`);
    this.host.style.width = `${this.chart.dates.length * this.chart.config.column_width}px`;
    this.host.style.height = `${Math.max(0, this.chart.grid_height - height)}px`;
    for (const name of ['--gv-upper-header-height', '--gv-lower-header-height', '--gv-column-width']) {
      this.dateTrack.style.setProperty(name, this.chart.$container.style.getPropertyValue(name));
    }
    // Upstream may mark the first upper label sticky during render. All dock
    // labels retain their authored date coordinates; one track handles panning.
    this.chart.$header.querySelectorAll('.current-upper').forEach(node => node.classList.remove('current-upper'));
    this.dateTrack.replaceChildren(this.chart.$header);
    this.syncHeader();
  }
  syncHeader() {
    this.dateTrack.style.transform = `translateX(${-this.viewport.scrollLeft}px)`;
  }
  visibleDay() {
    return this.scrollAnchor&&Math.abs(this.viewport.scrollLeft-this.scrollAnchor.left)<.1
      ? this.scrollAnchor.day : this.xToDay(this.viewport.scrollLeft);
  }
  scrollTo(left, top = this.viewport.scrollTop) {
    clearTimeout(this.edgeTimer);
    const bounded=Math.max(0,Math.min(left,this.viewport.scrollWidth-this.viewport.clientWidth));
    this.viewport.scrollLeft = bounded;
    // Preserve the requested civil-date anchor across integer scroll rounding.
    // Rebuilding padding repeatedly must not accumulate a pixel error per pass.
    this.scrollAnchor={day:this.xToDay(bounded),left:this.viewport.scrollLeft};
    this.viewport.scrollTop = top;
    this.programmaticScroll = this.viewport.scrollLeft;
    this.syncHeader();
  }
  canvasX(clientX) { return clientX - this.chart.$svg.getBoundingClientRect().left; }
  startHeaderPan(e) {
    if (!e.target.closest('.grid-header') || e.target.closest('button, input, select, a')) return false;
    if (e.button !== 0 || !e.isPrimary || this.active || this.headerPan) return false;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(this.edgeTimer);
    this.headerPan = { pointerId: e.pointerId, clientX: e.clientX, top: this.viewport.scrollTop };
    this.host.setPointerCapture(e.pointerId);
    this.host.classList.add('is-panning-dates');
    this.shell.classList.add('is-panning-dates');
    return true;
  }
  moveHeaderPan(e) {
    const pan = this.headerPan;
    if (!pan || e.pointerId !== pan.pointerId) return false;
    e.preventDefault();
    const delta = pan.clientX - e.clientX;
    pan.clientX = e.clientX;
    this.programmaticScroll = null;
    this.viewport.scrollLeft += delta;
    this.viewport.scrollTop = pan.top;
    this.syncHeader();
    const max = this.viewport.scrollWidth - this.viewport.clientWidth;
    if ((delta < 0 && this.viewport.scrollLeft < 40) || (delta > 0 && this.viewport.scrollLeft > max - 40)) this.scheduleExtend();
    return true;
  }
  stopHeaderPan() {
    const pan = this.headerPan;
    this.headerPan = null;
    clearTimeout(this.edgeTimer);
    this.host.classList.remove('is-panning-dates');
    this.shell.classList.remove('is-panning-dates');
    if (pan && this.host.hasPointerCapture(pan.pointerId)) this.host.releasePointerCapture(pan.pointerId);
  }
  start(e) {
    if (this.startHeaderPan(e)) return;
    const wrapper = e.target.closest('.bar-wrapper');
    if (!wrapper || e.button !== 0 || !e.isPrimary || this.headerPan) return;
    const bar = this.chart.bars.find(candidate => candidate.group === wrapper);
    if (!bar) return;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(this.edgeTimer);
    this.onSelect(bar.task._modelId);
    const mode = e.target.closest('.handle.left') ? 'start' : e.target.closest('.handle.right') ? 'end' : 'move';
    this.active = { id: bar.task.id, bar, mode, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
      originDay: this.xToDay(this.canvasX(e.clientX)), start: bar.task.start, end: bar.task.end,
      nextStart: bar.task.start, nextEnd: bar.task.end };
    this.host.setPointerCapture(e.pointerId);
    this.host.classList.add('is-dragging');
    this.frameTime = null;
    this.frame = requestAnimationFrame(t => this.pan(t));
  }
  move(e) {
    if (this.moveHeaderPan(e)) return;
    if (!this.active || e.pointerId !== this.active.pointerId) return;
    this.active.clientX = e.clientX; this.active.clientY = e.clientY;
    this.update();
  }
  update() {
    const a = this.active;
    if (!a) return;
    const raw = this.xToDay(this.canvasX(a.clientX)) - a.originDay;
    // Symmetric nearest-interval rounding; avoid JS's asymmetric negative .5.
    const delta = Math.sign(raw) * Math.floor(Math.abs(raw) / this.snap + 0.5 + 1e-7) * this.snap;
    const start = ordinal(a.start), end = ordinal(a.end);
    a.nextStart = isoDay(a.mode === 'end' ? start : a.mode === 'start' ? Math.min(start + delta, end) : start + delta);
    a.nextEnd = isoDay(a.mode === 'start' ? end : a.mode === 'end' ? Math.max(end + delta, start) : end + delta);
    this.drawBar(a.bar, a.nextStart, a.nextEnd);
  }
  pan(time) {
    if (!this.active) return;
    const box = this.viewport.getBoundingClientRect(), a = this.active, edge = Math.min(70, box.width / 5);
    const elapsed = Math.min(40, time - (this.frameTime ?? time)); this.frameTime = time;
    let velocity = 0;
    if (a.clientX < box.left + edge) velocity = -Math.min(1, (box.left + edge - a.clientX) / edge);
    else if (a.clientX > box.right - edge) velocity = Math.min(1, (a.clientX - box.right + edge) / edge);
    if (velocity && this.autoPan) {
      const max = this.viewport.scrollWidth - this.viewport.clientWidth;
      if ((velocity < 0 && this.viewport.scrollLeft <= 1 && this.left < 120) || (velocity > 0 && this.viewport.scrollLeft >= max - 1 && this.right < 120)) {
        this.extend(velocity < 0 ? 'left' : 'right');
      }
      this.viewport.scrollLeft += velocity * elapsed * 0.65;
      this.syncHeader();
      this.update();
    }
    this.frame = requestAnimationFrame(t => this.pan(t));
  }
  extend(side) {
    const nextLeft = side === 'left' ? Math.min(120, this.left + 2) : this.left;
    const nextRight = side === 'right' ? Math.min(120, this.right + 2) : this.right;
    try { assertTimelineRenderBudget(this.tasks, this.chart.config.view_mode.name, nextLeft, nextRight); }
    catch { return; }
    const before = this.active ? this.dateToX(this.active.start) : 0;
    const scroll = this.viewport.scrollLeft;
    if (!this.onExtend(side)) return;
    if (side === 'left') this.left = Math.min(120, this.left + 2);
    else this.right = Math.min(120, this.right + 2);
    this.chart.options.view_mode = viewMode(this.chart.config.view_mode.name, this.left, this.right, this.snap);
    this.chart.change_view_mode(this.chart.options.view_mode);
    this.align();
    const shift = this.active ? this.dateToX(this.active.start) - before : 0;
    this.viewport.scrollLeft = scroll + shift;
    this.syncHeader();
    if (this.active) { this.active.bar = this.chart.get_bar(this.active.id); this.update(); }
  }
  scheduleExtend() {
    if (this.active) return;
    clearTimeout(this.edgeTimer);
    this.edgeTimer = setTimeout(() => {
      if (this.active || performance.now() < (this.nextExtend ?? 0)) return;
      const max = this.viewport.scrollWidth - this.viewport.clientWidth;
      if (max <= 0) return;
      const side = this.viewport.scrollLeft < 40 ? 'left' : this.viewport.scrollLeft > max - 40 ? 'right' : null;
      if (!side || (side === 'left' ? this.left : this.right) >= 120) return;
      this.nextExtend = performance.now() + 1800;
      // Preserve the same calendar date at the left edge after adding columns.
      const day = this.xToDay(this.viewport.scrollLeft);
      this.extend(side);
      this.viewport.scrollLeft = this.dateToX(day);
      this.syncHeader();
    }, 300);
  }
  finish(e) {
    if (this.headerPan && e.pointerId === this.headerPan.pointerId) {
      this.moveHeaderPan(e);
      this.stopHeaderPan();
      return;
    }
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.move(e);
    this.stop();
    if (a.nextStart !== a.start || a.nextEnd !== a.end) this.onCommit(a.bar.task._modelId, a.nextStart, a.nextEnd);
  }
  stop() {
    const a = this.active; this.active = null;
    cancelAnimationFrame(this.frame);
    this.host.classList.remove('is-dragging');
    if (a && this.host.hasPointerCapture(a.pointerId)) this.host.releasePointerCapture(a.pointerId);
  }
  cancel() { this.stopHeaderPan(); const a = this.active; this.stop(); if (a) this.drawBar(a.bar, a.start, a.end); }
  destroy() {
    this.cancel();
    clearTimeout(this.edgeTimer);
    clearTimeout(this.hoverTimer);
    this.abort.abort();
    this.viewport.classList.remove('timeline-viewport');
    for (const [name, value] of this.hostLayout) {
      if (value) this.host.style.setProperty(name, value);
      else this.host.style.removeProperty(name);
    }
    this.shell.before(this.viewport);
    this.shell.remove();
  }
}
