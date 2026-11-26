import './inspector-popover.css';

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
const gap = 12;

function visibleBounds(viewport) {
  const rect = viewport.getBoundingClientRect();
  const screen = window.visualViewport;
  const screenX = screen?.offsetLeft || 0;
  const screenY = screen?.offsetTop || 0;
  const left = Math.max(rect.left + viewport.clientLeft, screenX);
  const pictureHeader = viewport.querySelector('[data-role="calendar-header"]');
  const top = Math.max(rect.top + viewport.clientTop, screenY, pictureHeader?.getBoundingClientRect().bottom ?? -Infinity);
  const right = Math.min(rect.left + viewport.clientLeft + viewport.clientWidth,
    screenX + (screen?.width ?? document.documentElement.clientWidth));
  const bottom = Math.min(rect.top + viewport.clientTop + viewport.clientHeight,
    screenY + (screen?.height ?? document.documentElement.clientHeight));
  const inset = Math.max(0, Math.min(10, (right - left) / 8, (bottom - top) / 8));
  return { left: left + inset, top: top + inset, right: right - inset, bottom: bottom - inset };
}

function placement(bounds, point, preferredWidth) {
  const {left, top, right, bottom} = bounds;
  const width = Math.min(preferredWidth, right - left);
  const x = clamp(point.x, left, right), y = clamp(point.y, top, bottom);
  let height = Math.min(440, bottom - top);
  const spaceRight = right - x - gap, spaceLeft = x - left - gap;
  if (Math.max(spaceLeft, spaceRight) >= Math.min(width, 260)) {
    const onRight = spaceRight >= width || spaceRight >= spaceLeft;
    const sideWidth = Math.min(width, onRight ? spaceRight : spaceLeft);
    return {left: onRight ? x + gap : x - sideWidth - gap,
      top: clamp(y - 26, top, bottom - height), width: sideWidth, height, resizeLeft: !onRight};
  }

  // On a phone a full form rarely fits beside a bar. Keep the tapped point
  // exposed and let the form scroll on the side with more vertical space.
  const verticalGap = Math.min(gap, height / 8);
  const below = bottom - y - verticalGap, above = y - top - verticalGap;
  const opensBelow = below >= above;
  height = Math.min(height, Math.max(0, below, above));
  return {left: clamp(x - width / 2, left, right - width),
    top: opensBelow ? y + verticalGap : y - verticalGap - height, width, height, resizeLeft: false};
}

export function createInspectorPopover(main, mode) {
  const picture = mode !== 'timeline';
  let anchor = null, viewport = null, frame = 0;
  const events = new AbortController();
  const options = {signal: events.signal, passive: true};
  const resize = new ResizeObserver(schedule);
  function schedule() {
    if (anchor && !frame) frame = requestAnimationFrame(() => { frame = 0; layout(); });
  }
  main.addEventListener('scroll', event => {
    if (event.target === viewport) schedule();
  }, {...options, capture: true});
  window.visualViewport?.addEventListener('resize', schedule, options);
  window.visualViewport?.addEventListener('scroll', schedule, options);

  function anchorFor(id, field) {
    const key = CSS.escape(id);
    if (!picture) return main.querySelector(`.timeline-viewport .bar-wrapper[data-id="${key}"] .bar`);
    if (field === 'project') return main.querySelector(`.picture-canvas [data-project-id="${key}"] [data-role="project-label"]`);
    const task = main.querySelector(`.picture-canvas [data-phase-id="${key}"]`);
    if (!task) return null;
    if (field === 'milestone' || field === 'status') {
      const part = task.querySelector(`[data-edit-field="${field}"]`);
      if (part) return part;
    }
    return task.querySelector('[data-role="phase-bar"]') || task;
  }
  function viewportFor(bar) {
    return bar.closest(picture ? '.picture-viewport' : '.timeline-viewport');
  }
  function layout() {
    if (!anchor) return;
    const bar = anchorFor(anchor.taskId, anchor.field);
    if (!bar) return;
    const current = viewportFor(bar);
    if (current !== viewport) {
      resize.disconnect();
      viewport = current;
      resize.observe(viewport);
      resize.observe(main);
      if (picture) resize.observe(bar.closest('.picture-canvas'));
    }
    const box = bar.getBoundingClientRect(), bounds = visibleBounds(viewport);
    const occluded = bounds.right <= bounds.left || bounds.bottom <= bounds.top;
    main.toggleAttribute('data-inspector-occluded', occluded);
    if (occluded) return;
    const point = {x: box.left + box.width * anchor.fraction, y: box.top + box.height * anchor.fractionY};
    const width = parseFloat(main.style.getPropertyValue('--inspector-width')) || 300;
    const panel = placement(bounds, point, width), origin = main.getBoundingClientRect();
    main.dataset.inspectorAnchor = 'chart';
    main.toggleAttribute('data-inspector-resize-left', panel.resizeLeft);
    for (const [key, value] of Object.entries({
      x: panel.left - origin.left - main.clientLeft, y: panel.top - origin.top - main.clientTop,
      width: panel.width, height: panel.height
    })) main.style.setProperty('--chart-inspector-' + key, value + 'px');
  }
  function open(id, point, field) {
    const bar = anchorFor(id, field);
    if (!bar) return false;
    const box = bar.getBoundingClientRect(), bounds = visibleBounds(viewportFor(bar));
    // A multi-year bar can extend far beyond the viewport. For keyboard
    // activation use the middle of its *visible* portion.
    const x = point?.clientX ?? (Math.max(box.left, bounds.left) + Math.min(box.right, bounds.right)) / 2;
    const y = point?.clientY ?? box.top + box.height / 2;
    anchor = {taskId: id, field, mode, fraction: (x - box.left) / (box.width || 1), fractionY: (y - box.top) / (box.height || 1)};
    layout();
    return true;
  }
  function clear() {
    anchor = viewport = null;
    resize.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    delete main.dataset.inspectorAnchor;
    main.removeAttribute('data-inspector-resize-left');
    main.removeAttribute('data-inspector-occluded');
  }
  return {
    get anchor() { return anchor; },
    open, clear, layout,
    restore(previous) {
      if (previous.mode !== mode) return open(previous.taskId, null, previous.field);
      if (!anchorFor(previous.taskId, previous.field)) return false;
      anchor = previous;
      layout();
      return true;
    },
    destroy() { clear(); events.abort(); }
  };
}
