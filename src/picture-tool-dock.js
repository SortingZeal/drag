import { t } from './i18n.js';
import './picture-tool-dock.css';

const storageKey = 'drag.pictureToolPosition';
const gutter = 6;
const clamp = (value, max) => Math.max(0, Math.min(value, max));

function loadPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if ([saved?.x, saved?.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return saved;
  } catch {}
  return { x: 1, y: 1 };
}

// Keep the dock in preview coordinates so chart scrolling, zoom and export are independent.
export function mountPictureToolDock(workspace, tools, signal) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'picture-tool-grip';
  handle.title = t('移動視角工具列（可用方向鍵）', 'Move view controls (arrow keys)');
  handle.setAttribute('aria-label', handle.title);
  handle.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" fill="currentColor"><path d="M1 2h2v2H1zm5 0h2v2H6zM1 7h2v2H1zm5 0h2v2H6zM1 12h2v2H1zm5 0h2v2H6z"/></svg>';
  tools.prepend(handle);
  let position = loadPosition();
  let drag = null;
  let timer;

  function space() {
    const insetX = Math.min(gutter, Math.max(0, (workspace.clientWidth - tools.offsetWidth) / 2));
    const insetY = Math.min(gutter, Math.max(0, (workspace.clientHeight - tools.offsetHeight) / 2));
    return { insetX, insetY, w: Math.max(0, workspace.clientWidth - tools.offsetWidth - insetX * 2),
      h: Math.max(0, workspace.clientHeight - tools.offsetHeight - insetY * 2) };
  }
  function place() {
    const { insetX, insetY, w, h } = space();
    tools.style.left = Math.round(insetX + position.x * w) + 'px';
    tools.style.top = Math.round(insetY + position.y * h) + 'px';
  }
  function move(left, top) {
    const { insetX, insetY, w, h } = space();
    position = { x: w ? clamp((left - insetX) / w, 1) : position.x,
      y: h ? clamp((top - insetY) / h, 1) : position.y };
    place();
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(position)); } catch {}
  }
  function wake() {
    clearTimeout(timer);
    tools.classList.remove('is-idle');
    if (!drag) timer = setTimeout(() => tools.classList.add('is-idle'), 1800);
  }
  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    tools.classList.remove('is-moving');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    save();
    wake();
  }

  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX - tools.offsetLeft, y: event.clientY - tools.offsetTop };
    handle.setPointerCapture(event.pointerId);
    tools.classList.add('is-moving');
    wake();
    event.preventDefault();
  }, { signal });
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) move(event.clientX - drag.x, event.clientY - drag.y);
  }, { signal });
  for (const type of ['pointerup', 'lostpointercapture', 'pointercancel']) handle.addEventListener(type, finish, { signal });
  const directions = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] };
  handle.addEventListener('keydown', event => {
    const direction = directions[event.key];
    if (!direction && event.key !== 'Home') return;
    event.preventDefault();
    event.stopPropagation();
    if (direction) {
      const step = event.shiftKey ? 32 : 8;
      move(tools.offsetLeft + direction[0] * step, tools.offsetTop + direction[1] * step);
    } else { position = { x: 1, y: 1 }; place(); }
    wake();
    save();
  }, { signal });
  for (const type of ['pointerdown','pointerenter','pointermove','focusin','input','keydown']) {
    tools.addEventListener(type, wake, { signal });
  }
  const resize = new ResizeObserver(place);
  resize.observe(workspace);
  resize.observe(tools);
  signal.addEventListener('abort', () => { clearTimeout(timer); resize.disconnect(); }, { once: true });
  place();
  wake();
}
