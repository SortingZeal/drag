import { isoDay, ordinal } from './timeline.js';
import { bindPictureOrder } from './picture-order.js';
import './picture-edit.css';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const firstDay = ordinal('0001-01-01'), lastDay = ordinal('9999-12-31');

function hitPart(target, stage, svg, clientX) {
  const field = target.closest('[data-edit-field]')?.dataset.editField;
  if (field) return field;
  const bar = stage.querySelector('[data-role="phase-bar"]')?.getBoundingClientRect();
  if (bar?.width >= 32) {
    if (stage.dataset.start >= svg.dataset.start && Math.abs(clientX - bar.left) <= 7) return 'start';
    if (stage.dataset.end <= svg.dataset.end && Math.abs(clientX - bar.right) <= 7) return 'end';
  }
  return 'move';
}

export function bindPictureTasks(workspace, svg, editing, signal) {
  const {onEdit, onCommit, onMilestoneDate} = editing;
  const order = bindPictureOrder(workspace, svg, editing, signal);
  const viewport = workspace.querySelector('.picture-viewport');
  const feedback = document.createElement('div');
  feedback.className = 'picture-date-preview';
  feedback.setAttribute('aria-hidden', 'true');
  feedback.hidden = true;
  const caption = document.createElement('span');
  feedback.append(caption);
  const edges = document.createElement('div');
  edges.className = 'picture-resize-edges';
  edges.setAttribute('aria-hidden', 'true');
  edges.hidden = true;
  workspace.append(edges, feedback);
  svg.setAttribute('role', 'group');
  let gesture = null;
  function stop() {
    if (!gesture) return;
    const {pointerId} = gesture;
    gesture = null;
    feedback.hidden = true;
    order.clear();
    delete viewport.dataset.taskGesture;
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
  }
  function update(event) {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.moved && Math.max(Math.abs(dx), Math.abs(dy)) >= 5) {
      const horizontal = Math.abs(dx), vertical = Math.abs(dy);
      if (!g.fromGrip && g.part === 'move' && Math.max(horizontal, vertical) < 12 &&
          Math.abs(horizontal - vertical) < 3) return;
      g.moved = true;
      if (g.fromGrip || g.part === 'project' || g.part === 'move' && vertical > horizontal) {
        g.part = 'order';
        viewport.dataset.taskGesture = 'order';
        order.start(g.item);
      }
    }
    if (!g.moved || g.part === 'status') return;
    if (g.part === 'order') {
      order.mark(g.item,event.clientX,event.clientY,dy);
      event.preventDefault();
      return;
    }
    const matrix = svg.getScreenCTM();
    const day = ordinal(svg.dateAtX(g.grabX + dx / matrix.a));
    const delta = day - g.grabDay;
    g.nextStart = g.start;
    g.nextEnd = g.end;
    if (g.part === 'milestone') g.nextDate = Math.abs(dx) < 5 ? g.originalDate : day;
    else if (g.part === 'start' && Math.abs(dx) >= 5) g.nextStart = clamp(day, firstDay, g.end);
    else if (g.part === 'end' && Math.abs(dx) >= 5) g.nextEnd = clamp(day, g.start, lastDay);
    else if (g.part === 'move') {
      const shift = clamp(delta, firstDay - g.start, lastDay - g.end);
      g.nextStart += shift;
      g.nextEnd += shift;
    }
    const isMarker = g.part === 'milestone';
    const a = isoDay(isMarker ? g.nextDate : g.nextStart);
    const b = isoDay(g.nextEnd);
    const bounds = workspace.getBoundingClientRect();
    const screenX = (value, inclusive = false) => svg.xAtDate(value, inclusive) * matrix.a + matrix.e - bounds.left;
    const x = screenX(a);
    const width = isMarker ? 4 : Math.max(2, screenX(b, true) - x);
    const bar = g.anchor.getBoundingClientRect();
    Object.assign(feedback.style, {left: x + 'px', width: width + 'px', top: (bar.top - bounds.top) + 'px', height: Math.max(8, bar.height) + 'px'});
    caption.textContent = isMarker ? a : a + ' – ' + b;
    feedback.hidden = false;
    const labelX = clamp(event.clientX - bounds.left - caption.offsetWidth / 2, 3, Math.max(3, bounds.width - caption.offsetWidth - 3));
    caption.style.left = (labelX - x) + 'px';
    feedback.classList.toggle('label-below', bar.top - bounds.top < 32);
    event.preventDefault();
  }
  workspace.addEventListener('pointerdown', event => {
    const gripItem = order.grippedItem(event.target);
    const item = gripItem || event.target;
    const stage = item.closest('[data-phase-index]');
    const project = order.project(item);
    if ((!stage && !project) || gesture || event.shiftKey || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    edges.hidden = true;
    order.hideGrip();
    order.choose(stage || project);
    viewport.setPointerCapture(event.pointerId);
    if (project) {
      gesture = {item:project, part:'project', pointerId:event.pointerId, x:event.clientX, y:event.clientY};
      viewport.dataset.taskGesture = 'project';
      return;
    }
    const part = gripItem ? 'move' : hitPart(event.target, stage, svg, event.clientX);
    const marker = stage.querySelector('[data-role="milestone"], [data-role="phase-end-marker"]');
    const isMarker = part === 'milestone';
    const matrix = svg.getScreenCTM();
    const date = marker?.dataset.date || stage.dataset.end;
    const grabX = isMarker ? svg.xAtDate(date, !marker?.dataset.date) : (event.clientX - matrix.e) / matrix.a;
    const start = ordinal(stage.dataset.start), end = ordinal(stage.dataset.end);
    gesture = {item:stage, fromGrip:!!gripItem, id: stage.dataset.phaseId, part, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      start, end, nextStart: start, nextEnd: end, originalDate: ordinal(date), nextDate: ordinal(date),
      grabX, grabDay: ordinal(svg.dateAtX(grabX)), anchor: isMarker ? marker : stage.querySelector('[data-role="phase-bar"]')};
    viewport.dataset.taskGesture = part;
  }, {capture: true, signal});
  viewport.addEventListener('pointermove', event => {
    if (gesture) { update(event); return; }
    const stage = event.target.closest('[data-phase-index]');
    const part = stage && hitPart(event.target, stage, svg, event.clientX);
    if (!event.buttons && event.pointerType !== 'touch') order.showGrip(stage || order.project(event.target), event);
    if (part) viewport.dataset.taskHover = part;
    else delete viewport.dataset.taskHover;
    edges.hidden = true;
    if (!part || part === 'status' || part === 'milestone' || event.pointerType === 'touch' || event.buttons) return;
    const bar = stage.querySelector('[data-role="phase-bar"]')?.getBoundingClientRect();
    if (!bar || bar.width < 32) return;
    const bounds = workspace.getBoundingClientRect();
    Object.assign(edges.style, {left: (bar.left - bounds.left) + 'px', top: (bar.top + bar.height / 2 - bounds.top) + 'px', width: bar.width + 'px'});
    edges.classList.toggle('show-start', stage.dataset.start >= svg.dataset.start);
    edges.classList.toggle('show-end', stage.dataset.end <= svg.dataset.end);
    edges.hidden = false;
  }, {signal});
  for (const name of ['scroll', 'pointerleave']) viewport.addEventListener(name, () => { edges.hidden = true; }, {signal});
  viewport.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    update(event);
    if (g.part === 'order') {
      order.commit(g.item);
      stop();
      return;
    }
    stop();
    if (!g.moved && g.part === 'project') order.editProject(g.item,event);
    else if (!g.moved) onEdit(g.id, ['milestone','status'].includes(g.part) ? g.part : 'task', event);
    else if (g.part === 'milestone' && g.nextDate !== g.originalDate) onMilestoneDate(g.id, isoDay(g.nextDate));
    else if (g.start !== g.nextStart || g.end !== g.nextEnd) onCommit(g.id, isoDay(g.nextStart), isoDay(g.nextEnd));
  }, {signal});
  for (const name of ['pointercancel', 'lostpointercapture']) {
    viewport.addEventListener(name, event => { if (gesture?.pointerId === event.pointerId) stop(); }, {signal});
  }
  window.addEventListener('blur', stop, {signal});
  window.addEventListener('keydown', event => { if (gesture && event.key === 'Escape') { event.preventDefault(); stop(); } }, {capture: true, signal});
  signal.addEventListener('abort', () => { stop(); edges.remove(); feedback.remove(); }, {once: true});
}
