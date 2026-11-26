import Gantt from 'frappe-gantt';
import 'frappe-gantt/style.css';
import { assertTimelineRenderBudget } from './model.js';
import { t, localeTag } from './i18n.js';
import { taskScrollDelta } from './reveal-task.js';
import { statusTone } from './task-glyphs.js';
import { svgNode as svgElement, progressPaint, progressStripes, addProgressPatterns, addCompletionSheen, setCompletionLight, addCompletionCheck, placeCompletionCheck } from './progress-appearance.js';

const DAY = 86400000;
export const ordinal = iso => Date.parse(`${iso}T00:00:00Z`) / DAY;
export const isoDay = n => new Date(Math.round(n) * DAY).toISOString().slice(0, 10);
const localISO = d => `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function taskFontSize(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const size = Number(value);
  return size >= 8 && size <= 160 ? size : 0;
}

const CHECK_SIZE = 14;
const CHECK_GUTTER = CHECK_SIZE + 10;

function trackingDefs(svg, bars, completionLight) {
  const defs = svgElement('defs', {});
  svg.prepend(defs);
  addProgressPatterns(defs, 'timeline', bars.map(({task}) => task.progress));
  if (bars.some(({task}) => task.hasProgress && task.progress === 100)) addCompletionSheen(defs, 'timeline-complete-sheen', completionLight);
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
  const progress = bar.task.progress;
  const empty = progress === 0;
  bar.progressTrack = svgElement('rect', {
    id: trackId, class: 'bar-progress-track', y, height, rx: 3, ry: 3,
    fill: empty ? bar.task.color : '#eaf0f2', 'fill-opacity': empty ? .05 : .9,
    stroke: '#61717c', 'stroke-opacity': empty ? .72 : .84, 'stroke-width': 1,
    'stroke-dasharray': empty ? '4 3' : null,
  });
  const paint = svgElement('g', {'clip-path': `url(#${clipId})`, opacity: bar.task.light ? .72 : null});
  const fill = bar.$bar_progress;
  fill.replaceWith(layer);
  layer.append(bar.progressTrack, paint);
  paint.append(fill);
  fill.setAttribute('rx', 0);
  fill.setAttribute('ry', 0);
  fill.setAttribute('y', y);
  fill.setAttribute('height', height);
  fill.style.fill = bar.task.color;
  const paintWeight = progressPaint(progress);
  fill.setAttribute('fill-opacity', progress === 100 ? 1 : paintWeight.fillOpacity);
  if (progress > 0 && progress < 100) {
    bar.progressTexture = svgElement('rect', {
      class: 'bar-progress-texture', y, height, fill: progressStripes('timeline', progress),
      opacity: paintWeight.stripeOpacity,
    });
    paint.append(bar.progressTexture);
  } else if (progress === 100) {
    bar.progressTexture = svgElement('rect', {
      class: 'bar-complete-texture', y, height, fill: 'url(#timeline-complete-sheen)',
    }, paint);
    bar.completionCheck = addCompletionCheck(layer);
  }
}

function addStatusBadge(bar) {
  const status = bar.task.status;
  if (!status) return;
  const tone = statusTone(status);
  const badge = svgElement('svg', {
    class: 'bar-status-badge', y: bar.y - 18, height: 16, overflow: 'hidden',
    'data-edit-field': 'status', role: 'button', tabindex: 0, 'aria-label': t('編輯階段狀態', 'Edit status') + ' · ' + status,
  });
  const background = svgElement('rect', {
    x: .5, y: .5, height: 15, rx: 7.5, fill: tone.paper, stroke: tone.line, 'stroke-width': 1,
  });
  const dot = svgElement('circle', { cx: 8, cy: 8, r: 2.5, fill: tone.accent });
  const label = svgElement('text', {
    class: 'bar-status-text', x: 15, y: 8, 'dominant-baseline': 'central',
    fill: tone.ink, 'font-size': 10, 'font-weight': 600,
  });
  label.textContent = status;
  const title = svgElement('title', {});
  title.textContent = status;
  badge.append(background, dot, title, label);
  bar.bar_group.append(badge);
  bar.statusBadge = badge;
}

// Use a fixed annotation band below the bar. Dates and task captions stay
// readable even when a milestone and both ends of a short task coincide.
function addMilestone(bar) {
  const milestone = bar.task.milestone;
  if (!milestone || (!milestone.label && !milestone.date)) return;
  const group = svgElement('g', {
    class: 'bar-milestone', 'data-role': 'milestone', 'data-edit-field': 'milestone',
    tabindex: 0, role: 'button',
  });
  const title = svgElement('title', {});
  const symbol = bar.task.milestoneShape === 'star'
    ? svgElement('path', {d: 'M0 -6 1.6 -2 5.8 -1.8 2.6 1 3.6 5.2 0 2.8 -3.6 5.2 -2.6 1 -5.8 -1.8 -1.6 -2 Z'})
    : svgElement('circle', {cx: 0, cy: 0, r: 4});
  symbol.setAttribute('fill', bar.task.color);
  symbol.setAttribute('stroke', '#fff');
  symbol.setAttribute('stroke-width', '1.1');
  symbol.dataset.shape = bar.task.milestoneShape || 'circle';
  symbol.dataset.role = 'milestone-symbol';
  const edge = svgElement('path', {fill: 'none', stroke: bar.task.color, 'stroke-width': 1.5});
  const leader = svgElement('line', {x1: 0, x2: 0, y1: -13, y2: -4, stroke: bar.task.color, 'stroke-width': 1});
  const label = svgElement('text', {x: 8, y: 0, 'dominant-baseline': 'central',
    class: 'bar-milestone-text', 'font-size': 11, 'font-weight': 500, fill: '#334155'});
  const name = svgElement('tspan', {'font-weight': 600});
  const dateNote = svgElement('tspan', {class: 'milestone-date', 'font-weight': 400, fill: '#526178'});
  label.append(name, dateNote);
  const hit = svgElement('rect', {x: -7, y: -8, width: 14, height: 16, fill: 'transparent'});
  group.append(title, hit, leader, symbol, edge, label);
  bar.bar_group.append(group);
  bar.milestoneMark = {group, title, label, name, dateNote, leader, edge, hit};
  setMilestoneCaption(bar, milestone.date);
}

// Keep the complete wording available to the inspector, keyboard users and
// SVG titles. Truncate only the visible line, using the font actually drawn.
function fitCaption(node, text, maxWidth) {
  const width = node.getComputedTextLength();
  if (width <= maxWidth) return { width, text };
  // SVG collapses whitespace and engines count astral characters differently.
  // Measure the actual displayed prefix for both wide CJK characters and emoji.
  const prefix = count => text.slice(0, count).replace(/[\uD800-\uDBFF]$/u, '') + '…';
  // Most labels fit fewer than 32 characters. Only examine more when needed,
  // including when a long imported label starts with whitespace.
  let lo = 0, hi = Math.min(32, text.length);
  while (hi < text.length) {
    node.textContent = prefix(hi);
    if (node.getComputedTextLength() > maxWidth) break;
    lo = hi;
    hi = Math.min(hi * 2, text.length);
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    node.textContent = prefix(mid);
    if (node.getComputedTextLength() <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return { width: maxWidth, text: prefix(lo) };
}

function setMilestoneCaption(bar, date) {
  const {group, title, name, dateNote, leader} = bar.milestoneMark;
  const label = bar.task.milestone.label;
  const showName = label && label !== date;
  name.textContent = showName ? label : '';
  dateNote.textContent = (showName ? ' · ' : '') + (date || t('日期待定','Date TBD'));
  title.textContent = name.textContent + dateNote.textContent;
  group.setAttribute('aria-label', t('編輯里程碑', 'Edit milestone') + ' · ' + title.textContent);
  group.dataset.date = date || '';
  leader.setAttribute('stroke-dasharray', date ? 'none' : '2 2');
}

function measureMilestone(mark, gridWidth) {
  const dateWidth = mark.dateNote.getComputedTextLength();
  const limit = Math.max(0, Math.min(245, gridWidth / 2 - 15) - dateWidth);
  const measured = fitCaption(mark.name, mark.name.textContent, limit);
  mark.width = Math.ceil(dateWidth + measured.width);
  return measured.text;
}

function positionLabel() {
  const gutter = this.completionCheck && this.width >= CHECK_GUTTER ? CHECK_GUTTER : 0;
  const outside = this.labelWidth > this.width - gutter;
  this.label.classList.toggle('big', outside);
  const x = outside ? this.x + this.width + 5 : this.x + (this.width + gutter - this.labelWidth) / 2;
  this.label.setAttribute('x', x);
}

function viewMode(name, left, right, snapDays) {
  const common = { name, padding: [`${left}m`, `${right}m`], date_format: 'YYYY-MM-DD', upper_text_frequency: 1 };
  const monthFormatter = new Intl.DateTimeFormat(localeTag(), { month: 'short' });
  const monthName = d => t(`${d.getMonth() + 1}月`, monthFormatter.format(d));
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
  constructor(host, { tasks, view, snap, left, right, onCommit, onSelect, onEdit, onMilestoneDate, onExtend, onScaleChange, autoPan=true, completionLight }) {
    assertTimelineRenderBudget(tasks, view, left, right);
    this.tasks = tasks;
    this.completionLight = completionLight;
    this.host = host;
    this.viewport = host.closest('.preview');
    this.snap = snap === 'auto' ? ({ Day: 1, Week: 1, Month: 7, Quarter: 7, Year: 30 })[view] : Number.parseInt(snap);
    this.autoPan=autoPan;
    this.onCommit = onCommit;
    this.onSelect = onSelect;
    this.onEdit = onEdit;
    this.onMilestoneDate = onMilestoneDate;
    this.onExtend = onExtend;
    this.view = view;
    this.onScaleChange = onScaleChange;
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
    this.dateDock.dataset.scale = view;
    this.dateDock.tabIndex = 0;
    this.dateDock.setAttribute('role', 'button');
    this.dateDock.setAttribute('aria-haspopup', 'menu');
    this.dateDock.setAttribute('aria-expanded', 'false');
    this.dateDock.setAttribute('aria-controls', 'timeline-scale-menu');
    const scaleLabels = { Day: t('日','Day'), Week: t('週','Week'), Month: t('月','Month'), Quarter: t('季','Quarter'), Year: t('年','Year') };
    const scaleName = t('時間尺度', 'Time scale');
    this.dateDock.setAttribute('aria-label', scaleName + ' · ' + scaleLabels[view]);
    this.dateDock.title = t('點選日期切換尺度，左右拖曳移動時間軸', 'Click a date to change scale. Drag to pan.');
    this.scaleMenu = document.createElement('div');
    this.scaleMenu.id = 'timeline-scale-menu';
    this.scaleMenu.hidden = true;
    this.scaleMenu.setAttribute('role', 'menu');
    this.scaleMenu.setAttribute('aria-label', scaleName);
    for (const [value, label] of Object.entries(scaleLabels)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.scale = value;
      item.textContent = label;
      item.tabIndex = -1;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(value === view));
      this.scaleMenu.append(item);
    }
    this.dateTrack = document.createElement('div');
    this.dateTrack.className = 'timeline-date-track gantt-container';
    const scaleHint = document.createElement('span');
    scaleHint.className = 'timeline-scale-hint';
    scaleHint.setAttribute('aria-hidden', 'true');
    scaleHint.dataset.short = t('尺度','Scale');
    const hintText = document.createElement('span');
    hintText.textContent = t('點日期切換尺度','Click a date to change scale');
    scaleHint.append(hintText);
    this.dateDock.append(this.dateTrack,scaleHint);
    this.viewport.before(this.shell);
    this.shell.append(this.dateDock, this.viewport, this.scaleMenu);
    this.viewport.classList.add('timeline-viewport');
    this.chart = new CalendarGantt(host, tasks, {
      view_mode: viewMode(view, left, right, this.snap), infinite_padding: false,
      bar_height: Math.max(25, ...tasks.map(task => Math.ceil(taskFontSize(task.fontSize) * 1.2))),
      padding: tasks.some(task => task.status || task.milestone?.date || task.milestone?.label) ? 46 : 20,
      readonly_progress: true, move_dependencies: false,
      scroll_to: null, today_button: false, popup: false, snap_at: `${this.snap}d`,
    });
    this.align();
    const listen = (target, event, callback, options = {}) => target.addEventListener(event, callback, { ...options, signal: this.abort.signal });
    listen(host, 'keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const wrapper = event.target.closest('.bar-wrapper');
      if (!wrapper) return;
      event.preventDefault();
      const marker = event.target.closest('[data-edit-field]');
      const box = marker?.getBoundingClientRect();
      this.onEdit?.(wrapper.dataset.id, marker?.dataset.editField || 'task', box && {
        clientX: box.left + box.width / 2, clientY: box.top + box.height / 2
      });
    });
    listen(host, 'pointerdown', e => this.start(e), { capture: true });
    listen(this.dateDock, 'pointerdown', e => this.startHeaderPan(e), { capture: true });
    listen(this.dateDock, 'keydown', event => {
      if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      this.openScaleMenu();
    });
    listen(this.dateDock, 'click', event => {
      if (event.detail === 0) this.openScaleMenu();
    });
    listen(this.scaleMenu, 'click', event => {
      const item = event.target.closest('button[data-scale]');
      if (!item) return;
      const position = this.scalePosition;
      this.closeScaleMenu(true);
      if (item.dataset.scale !== this.view) this.onScaleChange?.(item.dataset.scale, position);
    });
    listen(this.scaleMenu, 'keydown', event => {
      const items = [...this.scaleMenu.children];
      const index = items.indexOf(event.target);
      let next;
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          event.stopPropagation();
          this.closeScaleMenu(true);
          return;
        case 'ArrowDown': next = (index + 1) % items.length; break;
        case 'ArrowUp': next = (index + items.length - 1) % items.length; break;
        case 'Home': next = 0; break;
        case 'End': next = items.length - 1; break;
        default: return;
      }
      event.preventDefault();
      items[next].focus({preventScroll:true});
    });
    listen(document, 'pointerdown', event => {
      if (!this.scaleMenu.hidden && !this.scaleMenu.contains(event.target) && !this.dateDock.contains(event.target)) this.closeScaleMenu();
    }, {capture:true});
    listen(this.scaleMenu, 'focusout', event => {
      if (!this.scaleMenu.contains(event.relatedTarget)) this.closeScaleMenu();
    });
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
  dateToX(iso) {
    const n = typeof iso === 'number' ? iso : ordinal(iso), ticks = this.dayTicks;
    let i = 0, last = ticks.length - 2;
    while (i < last) {
      const middle = Math.ceil((i + last) / 2);
      if (ticks[middle] <= n) i = middle;
      else last = middle - 1;
    }
    return (i + (n - ticks[i]) / (ticks[i + 1] - ticks[i])) * this.chart.config.column_width;
  }
  xToDay(x) {
    const ticks = this.dayTicks, unit = x / this.chart.config.column_width;
    const i = Math.max(0, Math.min(ticks.length - 2, Math.floor(unit)));
    return ticks[i] + (unit - i) * (ticks[i + 1] - ticks[i]);
  }
  drawBar(bar, start, end) {
    const x = this.dateToX(start), width = this.dateToX(ordinal(end) + 1) - x;
    bar.x = x; bar.width = width;
    bar.$bar.setAttribute('x', x); bar.$bar.setAttribute('width', width);
    bar.$date_highlight.style.left = `${x}px`; bar.$date_highlight.style.width = `${width}px`;
    bar.update_label_position(); bar.update_handle_position();
    bar.statusBadge?.setAttribute('x', Math.max(0, Math.min(x, this.gridWidth - bar.badgeWidth)));
    this.positionMilestone(bar, end);
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
      if (bar.completionCheck) {
        const labelX = Number(bar.label.getAttribute('x'));
        placeCompletionCheck(bar.completionCheck, trackX, bar.y + 4, trackWidth, bar.height - 8,
          CHECK_SIZE, labelX, labelX + bar.labelWidth);
      }
    }
    const label = bar.label;
    if (bar.task.hasProgress && bar.task.progress === 0) label.style.removeProperty('fill');
    else if (!label.classList.contains('big') && (!bar.task.light || bar.task.hasProgress)) label.style.fill = bar.labelInk;
    else label.style.removeProperty('fill');
    bar.group.dataset.start = start; bar.group.dataset.end = end;
  }
  positionMilestone(bar, end, date = bar.task.milestone?.date) {
    const mark = bar.milestoneMark;
    if (!mark) return;
    const x = this.dateToX(date || end);
    const outside = x < 0 || x > this.gridWidth;
    const margin = outside ? 13 : 7;
    const anchor = Math.max(margin, Math.min(this.gridWidth - margin, x));
    const left = anchor + 8 + mark.width > this.gridWidth;
    mark.group.setAttribute('transform', `translate(${anchor} ${bar.y + bar.height + 13})`);
    mark.group.dataset.rangeState = x < 0 ? 'before' : x > this.gridWidth ? 'after' : 'inside';
    mark.edge.setAttribute('d', outside ? (x < 0 ? 'M-8 -3l-3 3 3 3' : 'M8 -3l3 3 -3 3') : '');
    mark.leader.setAttribute('visibility', outside ? 'hidden' : 'visible');
    mark.label.setAttribute('x', left ? -8 : 8);
    mark.label.setAttribute('text-anchor', left ? 'end' : 'start');
    mark.hit.setAttribute('x', left ? -mark.width - 8 : -7);
    mark.hit.setAttribute('width', mark.width + 15);
  }
  setCompletionLight(style) {
    this.completionLight = style;
    setCompletionLight(this.chart.$svg.querySelector('.bar-complete-gradient'), style);
  }
  align() {
    // Upstream SMIL replays its approximate widths after rendering. Static bar
    // geometry must remain the calendar geometry used for pointer hit testing.
    this.host.querySelectorAll('animate, animateMotion, animateTransform').forEach(node => node.remove());
    const bars = this.chart.bars;
    this.dayTicks = this.chart.dates.map(d => ordinal(localISO(d)));
    this.gridWidth = this.dayTicks.length * this.chart.config.column_width;
    const defs = bars.some(bar => bar.task.hasProgress) ? trackingDefs(this.chart.$svg, bars, this.completionLight) : null;
    for (const bar of bars) {
      bar.label = bar.group.querySelector('.bar-label');
      const fontSize = taskFontSize(bar.task.fontSize);
      if (fontSize) bar.label.style.fontSize = `${fontSize}px`;
      bar.$bar.style.fill = bar.task.color;
      const [r, g, b] = bar.task.color.slice(1).match(/../g).map(hex => {
        const value = parseInt(hex, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      bar.labelInk = bar.task.light || r * 0.2126 + g * 0.7152 + b * 0.0722 > 0.179 ? '#17221a' : '#ffffff';
      if (bar.task.hasProgress) {
        const halo = bar.task.progress === 0 ? 'var(--g-row-color)' : bar.labelInk === '#ffffff' ? '#17221a' : '#fff';
        bar.group.style.setProperty('--progress-label-halo', halo);
        addProgressLayer(bar, defs);
      } else {
        // Frappe normalizes a missing percentage to zero on its task copy.
        bar.$bar_progress.remove();
      }
      addStatusBadge(bar);
      addMilestone(bar);
      bar.$bar.setAttribute('role', 'button');
      bar.$bar.setAttribute('tabindex', 0);
      bar.$bar.setAttribute('aria-label', bar.label.textContent);
      // Upstream hover builds CSS selectors from task.id without escaping.
      // Keep that id internal and safe while exposing the user's stable id.
      bar.group.dataset.id = bar.task._modelId;
      bar.group.classList.toggle('light', bar.task.light);
      const barOpacity = !bar.task.hasProgress ? 1 : bar.task.progress === 0 ? .10 : .28;
      bar.$bar.style.opacity = String(barOpacity * (bar.task.light ? .4 : 1));
    }
    // Read all text metrics together. Interleaving an SVG measurement with
    // writes to the preceding row forces a chart layout on every iteration.
    for (const bar of bars) {
      bar.labelWidth = bar.label.getBBox().width;
      if (bar.statusBadge) {
        const measured = fitCaption(bar.statusBadge.lastElementChild, bar.task.status, Math.min(159, this.gridWidth - 21));
        bar.badgeText = measured.text;
        bar.badgeWidth = Math.ceil(measured.width) + 21;
      }
      if (bar.milestoneMark) {
        const mark = bar.milestoneMark;
        mark.text = measureMilestone(mark, this.gridWidth);
        mark.initialWidth = mark.width;
      }
    }
    for (const bar of bars) {
      if (bar.milestoneMark) bar.milestoneMark.name.textContent = bar.milestoneMark.text;
      // Frappe also schedules this callback on the next frame after creating
      // each label. Reuse its measured width there and during drag previews.
      if (!bar.task.thumbnail) bar.update_label_position = positionLabel;
      if (bar.statusBadge) {
        bar.statusBadge.lastElementChild.textContent = bar.badgeText;
        bar.statusBadge.setAttribute('width', bar.badgeWidth);
        bar.statusBadge.firstElementChild.setAttribute('width', bar.badgeWidth - 1);
      }
      this.drawBar(bar, bar.task.start, bar.task.end);
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
  revealTask(project, phase) {
    const bar = this.chart.bars.find(({task}) => task._pi === project && task._fi === phase);
    if (!bar) return false;
    const {dx, dy} = taskScrollDelta(this.viewport, bar.$bar);
    if (dx || dy) this.scrollTo(this.viewport.scrollLeft + dx, this.viewport.scrollTop + dy);
    return true;
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
  openScaleMenu(clientX) {
    const dock = this.dateDock.getBoundingClientRect();
    const x = clientX ?? (dock.left + dock.width / 2);
    const offset = this.canvasX(x) - this.viewport.scrollLeft;
    // Browsers round scrollLeft. Use the requested civil-day origin so a zoom
    // out and back in at one screen position does not magnify that rounding.
    const origin = this.dateToX(this.visibleDay());
    this.scalePosition = {day:this.xToDay(origin + offset), offset, top:this.viewport.scrollTop};
    this.scaleMenu.hidden = false;
    this.dateDock.setAttribute('aria-expanded', 'true');
    const left = Math.max(4, Math.min(x - dock.left, dock.width - this.scaleMenu.offsetWidth - 4));
    this.scaleMenu.style.left = left + 'px';
    this.scaleMenu.querySelector('[aria-checked=true]').focus({preventScroll:true});
  }
  closeScaleMenu(focus = false) {
    this.scaleMenu.hidden = true;
    this.dateDock.setAttribute('aria-expanded', 'false');
    if (focus) this.dateDock.focus({preventScroll:true});
  }
  startHeaderPan(e) {
    if (!this.dateDock.contains(e.target)) return false;
    if (e.button !== 0 || !e.isPrimary || this.active || this.headerPan) return false;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(this.edgeTimer);
    const openOnClick = this.scaleMenu.hidden;
    if (!openOnClick) this.closeScaleMenu();
    this.headerPan = { pointerId: e.pointerId, openOnClick, startX: e.clientX, startY: e.clientY, clientX: e.clientX, top: this.viewport.scrollTop, moved: false };
    this.host.setPointerCapture(e.pointerId);
    return true;
  }
  moveHeaderPan(e) {
    const pan = this.headerPan;
    if (!pan || e.pointerId !== pan.pointerId) return false;
    e.preventDefault();
    if (!pan.moved) {
      if (Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) < 5) return true;
      pan.moved = true;
      this.host.classList.add('is-panning-dates');
      this.shell.classList.add('is-panning-dates');
    }
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
    const field = e.target.closest('[data-edit-field]')?.dataset.editField;
    const mode = field || (e.target.closest('.handle.left') ? 'start' : e.target.closest('.handle.right') ? 'end' : 'move');
    this.active = { id: bar.task.id, bar, mode, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
      pressX: e.clientX, pressY: e.clientY, moved: false,
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
    if (Math.hypot(e.clientX - this.active.pressX, e.clientY - this.active.pressY) > 4) this.active.moved = true;
    this.active.clientX = e.clientX; this.active.clientY = e.clientY;
    if (this.active.moved) this.update();
  }
  update() {
    const a = this.active;
    if (!a) return;
    const raw = this.xToDay(this.canvasX(a.clientX)) - a.originDay;
    // Symmetric nearest-interval rounding; avoid JS's asymmetric negative .5.
    const delta = Math.sign(raw) * Math.floor(Math.abs(raw) / this.snap + 0.5 + 1e-7) * this.snap;
    if (a.mode === 'status') return;
    if (a.mode === 'milestone') {
      if (!a.moved || !this.onMilestoneDate) return;
      const original = a.bar.task.milestone.date;
      // Dragging an off-chart marker into view assigns the day under its pin.
      const startDay = this.xToDay(Math.max(0, Math.min(this.gridWidth, this.dateToX(original || a.end))));
      const date = delta ? isoDay(startDay + delta) : original;
      const mark = a.bar.milestoneMark;
      if ((date || '') !== mark.group.dataset.date) {
        setMilestoneCaption(a.bar, date);
        mark.name.textContent = measureMilestone(mark, this.gridWidth);
        this.positionMilestone(a.bar, a.end, date);
      }
      a.milestoneDate = date;
      return;
    }
    const start = ordinal(a.start), end = ordinal(a.end);
    a.nextStart = isoDay(a.mode === 'end' ? start : a.mode === 'start' ? Math.min(start + delta, end) : start + delta);
    a.nextEnd = isoDay(a.mode === 'start' ? end : a.mode === 'end' ? Math.max(end + delta, start) : end + delta);
    if (a.bar.group.dataset.start !== a.nextStart || a.bar.group.dataset.end !== a.nextEnd) {
      this.drawBar(a.bar, a.nextStart, a.nextEnd);
    }
  }
  pan(time) {
    if (!this.active) return;
    const box = this.viewport.getBoundingClientRect(), a = this.active, edge = Math.min(70, box.width / 5);
    const elapsed = Math.min(40, time - (this.frameTime ?? time)); this.frameTime = time;
    let velocity = 0;
    if (a.clientX < box.left + edge) velocity = -Math.min(1, (box.left + edge - a.clientX) / edge);
    else if (a.clientX > box.right - edge) velocity = Math.min(1, (a.clientX - box.right + edge) / edge);
    if (velocity && this.autoPan && a.moved && a.mode !== 'status') {
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
      const point = this.headerPan;
      this.stopHeaderPan();
      if (!point.moved && point.openOnClick) this.openScaleMenu(point.startX);
      return;
    }
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.move(e);
    this.stop();
    const id = a.bar.task._modelId;
    if (!a.moved) {
      if (a.mode === 'start' || a.mode === 'end') return;
      const field = ['status', 'milestone'].includes(a.mode) ? a.mode : 'task';
      this.onEdit?.(id, field, { clientX: e.clientX, clientY: e.clientY });
      return;
    }
    this.onSelect(id);
    if (a.mode === 'milestone' && a.milestoneDate && a.milestoneDate !== a.bar.task.milestone.date) {
      this.onMilestoneDate?.(a.bar.task._modelId, a.milestoneDate);
    } else if (a.nextStart !== a.start || a.nextEnd !== a.end) this.onCommit(id, a.nextStart, a.nextEnd);
  }
  stop() {
    const a = this.active; this.active = null;
    cancelAnimationFrame(this.frame);
    this.host.classList.remove('is-dragging');
    if (a && this.host.hasPointerCapture(a.pointerId)) this.host.releasePointerCapture(a.pointerId);
  }
  cancel() {
    this.stopHeaderPan();
    const a = this.active;
    this.stop();
    if (!a) return;
    if (a.mode === 'milestone') {
      const mark = a.bar.milestoneMark;
      setMilestoneCaption(a.bar, a.bar.task.milestone.date);
      mark.name.textContent = mark.text;
      mark.width = mark.initialWidth;
    }
    this.drawBar(a.bar, a.start, a.end);
  }
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
