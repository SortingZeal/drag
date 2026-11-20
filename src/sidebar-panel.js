const DEFAULT_WIDTH = 224;
const DEFAULT_HEIGHT = 480;
const copy = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback) => value === null || value === '' || value === undefined ? fallback : Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Panel geometry is a view preference, separate from roadmap data and history.
export class SidebarPanel {
  constructor(main, state, onCommit = () => {}) {
    this.main = main;
    this.panel = main.querySelector(':scope > .project-sidebar');
    this.header = this.panel.querySelector('.aside-title');
    this.resizer = main.querySelector(':scope > .sidebar-resizer');
    this.corner = this.panel.querySelector('.sidebar-corner-resizer');
    this.state = state;
    this.onCommit = onCommit;
    this.abort = new AbortController();
    const listen = (node, type, callback, options = {}) => node.addEventListener(type, callback, { ...options, signal: this.abort.signal });
    listen(this.header, 'pointerdown', event => {
      if (!event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) this.start(event, 'move');
    });
    listen(this.header, 'dragstart', event => event.preventDefault());
    listen(this.resizer, 'pointerdown', event => this.start(event, 'dock-resize'));
    listen(this.corner, 'pointerdown', event => this.start(event, 'float-resize'));
    listen(main, 'pointermove', event => this.move(event));
    listen(main, 'pointerup', event => this.finish(event));
    listen(main, 'pointercancel', event => this.cancel(event));
    listen(main, 'lostpointercapture', event => this.cancel(event));
    listen(window, 'blur', () => this.cancel());
    listen(window, 'keydown', event => {
      if (event.key === 'Escape' && this.gesture) {
        event.preventDefault();
        this.cancel();
      }
    });
    listen(this.resizer, 'keydown', event => this.resizeKey(event, false));
    listen(this.corner, 'keydown', event => this.resizeKey(event, true));
    // Pointer capture retargets the compatibility click to main. Keep the
    // double-click hit area at the visible edge instead of relying on target.
    listen(main, 'dblclick', event => {
      if (this.state.mode !== 'docked') return;
      const edge = this.resizer.getBoundingClientRect();
      if (event.clientX < edge.left || event.clientX > edge.right || event.clientY < edge.top || event.clientY > edge.bottom) return;
      event.preventDefault();
      this.change(() => { this.state.dockWidth = DEFAULT_WIDTH; });
    });
    for (const button of this.panel.querySelectorAll('[data-sidebar-action]')) listen(button, 'click', () => {
      this.cancel();
      this.change(() => {
        if (button.dataset.sidebarAction === 'reset') {
          this.state.dockWidth = DEFAULT_WIDTH;
          this.state.float = { x: 24, y: 24, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
        }
        this.state.mode = 'docked';
      });
    });
    this.layout();
    this.observer = new ResizeObserver(() => {
      const before = JSON.stringify(this.state);
      this.layout();
      if (!this.gesture && JSON.stringify(this.state) !== before) this.commit();
    });
    this.observer.observe(main);
  }

  limits() {
    const width = Math.max(1, this.main.clientWidth), height = Math.max(1, this.main.clientHeight);
    const margin = Math.min(8, width / 4, height / 4);
    const minDock = Math.min(192, Math.max(96, width * .35));
    const maxDock = Math.max(minDock, Math.min(480, width - 560));
    const maxWidth = Math.max(1, width - margin * 2), maxHeight = Math.max(1, height - margin * 2);
    return { width, height, margin, minDock, maxDock, minWidth: Math.min(224, maxWidth), maxWidth, minHeight: Math.min(180, maxHeight), maxHeight };
  }

  layout() {
    if (!this.main.isConnected) return;
    const limit = this.limits(), state = this.state;
    state.mode = state.mode === 'floating' ? 'floating' : 'docked';
    state.dockWidth = clamp(number(state.dockWidth, DEFAULT_WIDTH), limit.minDock, limit.maxDock);
    if (!state.float || typeof state.float !== 'object' || Array.isArray(state.float)) state.float = {};
    const floating = state.float;
    floating.width = clamp(number(floating.width, DEFAULT_WIDTH), limit.minWidth, limit.maxWidth);
    floating.height = clamp(number(floating.height, DEFAULT_HEIGHT), limit.minHeight, limit.maxHeight);
    floating.x = clamp(number(floating.x, 24), limit.margin, Math.max(limit.margin, limit.width - limit.margin - floating.width));
    floating.y = clamp(number(floating.y, 24), limit.margin, Math.max(limit.margin, limit.height - limit.margin - floating.height));
    const detached = state.mode === 'floating';
    const drawerWidth = parseFloat(this.main.style.getPropertyValue('--inspector-width')) || 300;
    const right = detached ? floating.x + floating.width : state.dockWidth;
    const opensLeft = detached && right + drawerWidth + 12 > limit.width && floating.x > limit.width - right;
    const drawerStart = opensLeft ? floating.x - drawerWidth - 4 : right + 4;
    this.main.style.setProperty('--drawer-start', `${drawerStart}px`);
    this.panel.classList.toggle('is-short', detached && floating.height < 280);
    this.main.classList.toggle('sidebar-floating', detached);
    this.panel.classList.toggle('is-floating', detached);
    this.main.dataset.sidebarMode = state.mode;
    this.main.style.setProperty('--sidebar-width', `${detached ? 0 : state.dockWidth}px`);
    for (const [key, value] of Object.entries(floating)) if (['x', 'y', 'width', 'height'].includes(key)) {
      const property = key === 'x' ? 'left' : key === 'y' ? 'top' : key;
      if (detached) this.panel.style[property] = `${value}px`;
      else this.panel.style.removeProperty(property);
    }
    this.resizer.hidden = detached;
    this.corner.hidden = !detached;
    this.resizer.style.left = `${state.dockWidth - 4}px`;
    this.resizer.setAttribute('aria-valuemin', String(Math.round(limit.minDock)));
    this.resizer.setAttribute('aria-valuemax', String(Math.round(limit.maxDock)));
    this.resizer.setAttribute('aria-valuenow', String(Math.round(state.dockWidth)));
    this.corner.setAttribute('aria-valuemin', String(Math.round(limit.minWidth)));
    this.corner.setAttribute('aria-valuemax', String(Math.round(limit.maxWidth)));
    this.corner.setAttribute('aria-valuenow', String(Math.round(floating.width)));
    this.corner.setAttribute('aria-valuetext', `${Math.round(floating.width)} × ${Math.round(floating.height)}`);
    for (const button of this.panel.querySelectorAll('[data-sidebar-action]')) button.hidden = !detached;
    if (detached) {
      const box = this.panel.getBoundingClientRect();
      // Native scrollbar gutters can intercept input even above a fixed child.
      // Keep the grip inside the actual client area instead of the border box.
      const right = box.left + this.panel.clientLeft + this.panel.clientWidth;
      const bottom = box.top + this.panel.clientTop + this.panel.clientHeight;
      Object.assign(this.corner.style, { left: `${right - 19}px`, top: `${bottom - 19}px` });
    }
  }

  commit() { this.onCommit(copy(this.state)); }

  change(callback) {
    const before = JSON.stringify(this.state);
    callback();
    this.layout();
    if (JSON.stringify(this.state) !== before) this.commit();
  }

  start(event, kind) {
    if (event.button !== 0 || event.isPrimary === false || this.gesture) return;
    if (kind === 'dock-resize' && this.state.mode !== 'docked' || kind === 'float-resize' && this.state.mode !== 'floating') return;
    this.layout();
    const panel = this.panel.getBoundingClientRect(), main = this.main.getBoundingClientRect();
    this.gesture = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      before: copy(this.state), panelX: panel.left - main.left, panelY: panel.top - main.top, moved: false };
    this.main.setPointerCapture(event.pointerId);
    this.main.classList.add('is-adjusting-sidebar');
    event.preventDefault();
    event.stopPropagation();
  }

  move(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (gesture.kind === 'move' && !gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true;
    if (gesture.kind === 'dock-resize') this.state.dockWidth = gesture.before.dockWidth + dx;
    else if (gesture.kind === 'float-resize') this.resizeFloat(gesture.before.float.width + dx, gesture.before.float.height + dy, gesture.before.float);
    else {
      this.state.mode = 'floating';
      if (gesture.before.mode === 'docked') {
        this.state.float.width = gesture.before.dockWidth;
        this.state.float.height = Math.min(gesture.before.float.height, DEFAULT_HEIGHT);
      }
      this.state.float.x = gesture.panelX + dx;
      this.state.float.y = gesture.panelY + dy;
    }
    this.layout();
    event.preventDefault();
  }

  resizeFloat(width, height, origin = this.state.float) {
    const limit = this.limits();
    this.state.float.width = clamp(width, limit.minWidth, Math.max(limit.minWidth, limit.width - limit.margin - origin.x));
    this.state.float.height = clamp(height, limit.minHeight, Math.max(limit.minHeight, limit.height - limit.margin - origin.y));
    this.state.float.x = origin.x;
    this.state.float.y = origin.y;
  }

  release() {
    const gesture = this.gesture;
    this.gesture = null;
    this.main.classList.remove('is-adjusting-sidebar');
    if (gesture && this.main.hasPointerCapture(gesture.pointerId)) this.main.releasePointerCapture(gesture.pointerId);
    return gesture;
  }

  finish(event) {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    this.move(event);
    const gesture = this.release();
    if (JSON.stringify(gesture.before) !== JSON.stringify(this.state)) this.commit();
  }

  cancel(event) {
    if (!this.gesture || event?.pointerId !== undefined && event.pointerId !== this.gesture.pointerId) return;
    const gesture = this.release();
    Object.assign(this.state, copy(gesture.before));
    this.layout();
  }

  resizeKey(event, floating) {
    const step = event.shiftKey ? 40 : 10, state = this.state;
    if (floating && state.mode !== 'floating' || !floating && state.mode !== 'docked') return;
    const keys = floating ? ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'] : ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    this.change(() => {
      if (floating) {
        const width = event.key === 'Enter' ? state.dockWidth : state.float.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
        const height = event.key === 'Enter' ? DEFAULT_HEIGHT : state.float.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
        this.resizeFloat(width, height);
      } else {
        const limit = this.limits();
        state.dockWidth = event.key === 'Home' ? limit.minDock : event.key === 'End' ? limit.maxDock : event.key === 'Enter' ? DEFAULT_WIDTH : state.dockWidth + (event.key === 'ArrowLeft' ? -step : step);
      }
    });
  }

  destroy() {
    this.cancel();
    this.abort.abort();
    this.observer.disconnect();
  }
}
