// Return a canvas scroll delta without moving focus, the outline or the page.
export function taskScrollDelta(viewport, bar, {limitToScrollRange = true} = {}) {
  const frame = viewport.getBoundingClientRect();
  const left = frame.left + viewport.clientLeft, top = frame.top + viewport.clientTop;
  const right = left + viewport.clientWidth, bottom = top + viewport.clientHeight;
  let areas = [[left, top, right, bottom]];
  const drawer = viewport.closest('main')?.querySelector('.bottom:not([hidden])')?.getBoundingClientRect();
  if (drawer && drawer.right > left && drawer.left < right && drawer.bottom > top && drawer.top < bottom) {
    // The desktop inspector floats over the chart. Use any exposed side of
    // it. On mobile it covers the whole preview until the inspector closes.
    const exposed = [
      [left, top, Math.min(right, drawer.left), bottom],
      [Math.max(left, drawer.right), top, right, bottom],
      [left, top, right, Math.min(bottom, drawer.top)],
      [left, Math.max(top, drawer.bottom), right, bottom],
    ].filter(([x, y, endX, endY]) => endX - x >= 24 && endY - y >= 20);
    if (exposed.length) areas = exposed;
  }

  const task = bar.getBoundingClientRect();
  let best;
  for (const [x, y, endX, endY] of areas) {
    let dx = nearest(task.left, task.right, x, endX);
    let dy = nearest(task.top, task.bottom, y, endY);
    if (limitToScrollRange) {
      dx = Math.max(-viewport.scrollLeft, Math.min(dx, viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft));
      dy = Math.max(-viewport.scrollTop, Math.min(dy, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop));
    }
    const width = Math.max(0, Math.min(task.right - dx, endX) - Math.max(task.left - dx, x));
    const height = Math.max(0, Math.min(task.bottom - dy, endY) - Math.max(task.top - dy, y));
    const visible = width * height, travel = Math.hypot(dx, dy);
    if (!best || visible > best.visible + 0.01 || (Math.abs(visible - best.visible) < 0.01 && travel < best.travel)) {
      best = { dx, dy, visible, travel };
    }
  }
  return best;
}

function nearest(start, end, low, high) {
  // A wide bar already spanning the viewport is visible at this zoom.
  if ((start >= low && end <= high) || (start <= low && end >= high)) return 0;
  const startOffset = start - low, endOffset = end - high;
  return Math.abs(startOffset) < Math.abs(endOffset) ? startOffset : endOffset;
}
