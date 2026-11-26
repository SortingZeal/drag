import { t } from './i18n.js';

const projectLabel = '[data-role="project-label"]';
const phase = '[data-phase-index]';
const itemSelector = projectLabel + ', ' + phase;
const rectOf = node => node.getBoundingClientRect();
const barOf = stage => stage.querySelector('[data-role="phase-bar"]') || stage;
const middle = rect => (rect.top + rect.bottom) / 2;
const edgeAt = (rect, y, dy) => Math.abs(y-middle(rect)) < rect.height * .15
  ? (dy < 0 ? 'before' : 'after') : (y < middle(rect) ? 'before' : 'after');
const indexOf = item => ({
  project: Number(item.closest('[data-project-index]').dataset.projectIndex),
  phase: item.matches(phase) ? Number(item.dataset.phaseIndex) : null,
});
const nameOf = item => item.querySelector('[data-role="project-name"], [data-role="phase-label"]')?.textContent
  || item.querySelector('title')?.textContent.split('\n')[0] || t('任務', 'Task');

function currentItem(item) {
  const selector = item.matches(phase)
    ? `[data-phase-id="${CSS.escape(item.dataset.phaseId)}"]`
    : `[data-project-id="${CSS.escape(item.closest('[data-project-id]').dataset.projectId)}"] ${projectLabel}`;
  return document.querySelector('.picture-canvas ' + selector);
}

export function bindPictureOrder(workspace, svg, api, signal) {
  const viewport = workspace.querySelector('.picture-viewport');
  const items = [...svg.querySelectorAll(itemSelector)];
  const projects = [...svg.querySelectorAll('[data-project-index]')];
  const hint = document.createElement('span');
  hint.className = 'visually-hidden';
  hint.id = 'picture-order-instructions';
  hint.textContent = t('拖曳點狀把手可排序或跨專案移動。使用方向鍵選取，Alt 加上下鍵排序。', 'Drag the dotted grip to reorder or move between projects. Use the arrow keys to select and Alt with Up or Down to reorder.');
  const status = document.createElement('span');
  status.className = 'visually-hidden picture-order-status';
  status.setAttribute('role', 'status');
  const guide = document.createElement('div');
  guide.className = 'picture-order-guide';
  guide.setAttribute('aria-hidden', 'true');
  guide.hidden = true;
  const caption = document.createElement('span');
  guide.append(caption);
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.tabIndex = -1;
  grip.className = 'picture-order-grip';
  grip.hidden = true;
  const sourceOutline = document.createElement('div');
  sourceOutline.className = 'picture-order-source';
  sourceOutline.setAttribute('aria-hidden', 'true');
  sourceOutline.hidden = true;
  workspace.append(hint, status, guide, grip, sourceOutline);

  let gripItem = null;
  function hideGrip() {
    gripItem = null;
    grip.hidden = true;
  }
  function showGrip(item, pointer) {
    if (!item) {
      if (gripItem && pointer) {
        const gripBox = rectOf(grip);
        if (pointer.clientX >= gripBox.left - 8 && pointer.clientX <= gripBox.right + 8 &&
            pointer.clientY >= gripBox.top - 8 && pointer.clientY <= gripBox.bottom + 8) return;
      }
      return hideGrip();
    }
    if (item === gripItem) return;
    const box = rectOf(barOf(item)), view = rectOf(viewport), area = rectOf(workspace);
    if (box.right <= view.left || box.left >= view.right || box.bottom <= view.top || box.top >= view.bottom) return hideGrip();
    gripItem = item;
    grip.hidden = false;
    const label = t('拖曳排序', 'Drag to reorder') + ' · ' + nameOf(item);
    grip.title = label;
    grip.setAttribute('aria-label', label);
    const width = grip.offsetWidth, height = grip.offsetHeight;
    let x = box.left - width - 6, y = middle(box) - height / 2;
    if (x < view.left) {
      x = box.right + 6;
      if (x + width > view.right) {
        x = Math.max(box.left, view.left) + 6;
        y = box.top - height - 4 >= view.top ? box.top - height - 4 : box.bottom + 4;
      }
    }
    x = Math.max(view.left, Math.min(x, view.right - width));
    y = Math.max(view.top, Math.min(y, view.bottom - height));
    grip.style.left = (x - area.left) + 'px';
    grip.style.top = (y - area.top) + 'px';
  }
  viewport.addEventListener('scroll', hideGrip, {signal, passive:true});
  workspace.addEventListener('pointerleave', hideGrip, {signal});
  window.addEventListener('resize', hideGrip, {signal});

  let stop = items[0];
  for (const item of items) {
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', item === stop ? '0' : '-1');
    item.setAttribute('aria-label', item.querySelector(':scope > title')?.textContent || nameOf(item));
    item.setAttribute('aria-describedby', hint.id);
    item.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    const title = item.querySelector(':scope > title') || document.createElementNS(svg.namespaceURI,'title');
    title.dataset.pictureHint = title.textContent;
    const instruction = item.matches(phase)
      ? t('上下拖曳排序，左右拖曳調整日期。', 'Drag up or down to reorder, left or right to change dates.')
      : t('上下拖曳專案以排序。', 'Drag this project up or down to reorder.');
    title.textContent = (title.textContent || nameOf(item)) + '\n' + instruction;
    if (!title.parentNode) item.prepend(title);
  }
  function choose(item) {
    if (stop === item) return;
    stop?.setAttribute('tabindex', '-1');
    item.setAttribute('tabindex', '0');
    stop = item;
  }
  function finish(item, keyboard) {
    const next = currentItem(item);
    if (!next) return;
    if (keyboard) next.focus({preventScroll: true});
    const live = next.closest('.picture-workspace').querySelector('.picture-order-status');
    const {project, phase: position} = indexOf(next);
    const projectName = next.closest('[data-project-index]').querySelector('[data-role="project-name"]').textContent;
    live.textContent = position === null
      ? t('專案順序', 'Project position') + ' ' + (project + 1) + ' · ' + projectName
      : projectName + ' · ' + t('任務順序', 'Task position') + ' ' + (position + 1);
  }
  svg.addEventListener('focusin', event => {
    const item = event.target.closest(itemSelector);
    if (item) { choose(item); showGrip(item); }
  }, {signal});
  svg.addEventListener('keydown', event => {
    const item = event.target.closest(itemSelector);
    if (!item || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta) {
      event.preventDefault();
      if (event.altKey) {
        api.onStep(indexOf(item), delta);
        finish(item, true);
      } else {
        const next = items[Math.max(0, Math.min(items.length - 1, items.indexOf(item) + delta))];
        choose(next);
        next.focus();
      }
    } else if (!event.altKey && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      if (item.matches(phase)) api.onEdit(item.dataset.phaseId, 'task');
      else api.onEditProject(indexOf(item).project);
    }
  }, {signal});

  function destination(item, x, y, dy) {
    const view = rectOf(viewport);
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) return null;
    const hit = document.elementFromPoint(x, y);
    const row = hit?.closest('[data-project-index]');
    if (!row || !svg.contains(row)) return null;
    const source = indexOf(item);
    const label = row.querySelector(projectLabel);
    const target = indexOf(label);
    const same = source.project === target.project;
    const bounds = rectOf(row.querySelector('[data-role="project-row"]'));
    if (source.phase === null) {
      if (same) return null;
      return {target, edge: edgeAt(bounds, y, dy), bounds, name: nameOf(label)};
    }
    const stages = [...row.querySelectorAll(phase)];
    const labelRight = rectOf(label).right;
    if (!stages.length || x <= labelRight) {
      return same ? null : {target, edge:'inside', bounds, name:nameOf(label)};
    }
    // Prefer the bar under the pointer. Empty space can point to a lane as
    // well as to a neighbouring task that shares the source's compact lane.
    let candidate = hit.closest(phase);
    if (candidate === item) candidate = null;
    let edge;
    if (!candidate) {
      if (same) {
        const direction = Math.sign(dy);
        let distance = Math.abs(middle(rectOf(barOf(item))) - y);
        for (const stage of stages) {
          if (stage === item) continue;
          const nextDistance = Math.abs(middle(rectOf(barOf(stage))) - y);
          if (nextDistance < distance) {
            candidate = stage;
            distance = nextDistance;
          }
        }
        candidate ??= stages[stages.indexOf(item) + direction];
        if (!candidate) return null;
        edge = direction < 0 ? 'before' : 'after';
      } else {
        // On a blank part of the chart, use the nearest lane. For a shared
        // lane, prefer the bar nearest the pointer along the date axis.
        let bestY = Infinity, bestX = Infinity;
        for (const stage of stages) {
          const r = rectOf(barOf(stage));
          const distanceY = Math.abs(middle(r) - y);
          const distanceX = Math.max(0, r.left - x, x - r.right);
          if (distanceY < bestY || (distanceY === bestY && distanceX < bestX)) {
            candidate = stage;
            bestY = distanceY;
            bestX = distanceX;
          }
        }
      }
    }
    const box = rectOf(barOf(candidate));
    return {target:indexOf(candidate), edge:edge ?? edgeAt(box, y, dy),
      bounds:{left:labelRight, right:bounds.right, top:box.top, bottom:box.bottom},
      name:nameOf(candidate), projectName:nameOf(label)};
  }

  let dest = null, autoScroll = 0, lastPoint;
  function clear() {
    guide.hidden = true;
    sourceOutline.hidden = true;
    dest = null;
    lastPoint = null;
    cancelAnimationFrame(autoScroll);
    autoScroll = 0;
  }
  function scroll() {
    autoScroll = 0;
    if (!lastPoint) return;
    const {x, y, item, dy} = lastPoint;
    const view = rectOf(viewport);
    if (x < view.left || x > view.right || y < view.top || y > view.bottom) return;
    const top = rectOf(projects[0]).top, bottom = rectOf(projects.at(-1)).bottom;
    const margin = Math.min(40, view.height / 4);
    const up = top < view.top ? Math.max(0, margin - (y - view.top)) : 0;
    const down = bottom > view.bottom ? Math.max(0, margin - (view.bottom - y)) : 0;
    const speed = Math.round(14 * (down - up) / margin);
    if (!speed) return;
    const before = viewport.scrollTop;
    viewport.scrollTop += speed;
    if (viewport.scrollTop !== before) mark(item,x,y,dy);
  }
  function mark(item,x,y,dy) {
    lastPoint = {item,x,y,dy};
    dest = destination(item,x,y,dy);
    guide.hidden = !dest;
    if (!autoScroll) autoScroll = requestAnimationFrame(scroll);
    const area = rectOf(workspace), sourceBox = rectOf(barOf(item));
    Object.assign(sourceOutline.style,{left:(sourceBox.left-area.left)+'px',top:(sourceBox.top-area.top)+'px',
      width:sourceBox.width+'px',height:sourceBox.height+'px'});
    if (!dest) return;
    const {bounds,edge,name} = dest;
    const view = rectOf(viewport);
    const left = Math.max(bounds.left,view.left + 2), right = Math.min(bounds.right,view.right - 2);
    guide.dataset.edge = edge;
    guide.style.left = (left-area.left)+'px';
    guide.style.width = Math.max(2,right-left)+'px';
    guide.style.top = ((edge === 'after' ? bounds.bottom : bounds.top)-area.top)+'px';
    guide.style.height = (edge === 'inside' ? bounds.height : 0)+'px';
    caption.textContent = edge === 'inside' ? t('移入','Move into') + ' ' + name
      : (edge === 'before' ? t('移至之前','Move before') : t('移至之後','Move after')) + ' · ' + name;
    if (dest.projectName && indexOf(item).project !== dest.target.project) caption.textContent = dest.projectName + ' › ' + caption.textContent;
    const captionLeft = Math.max(view.left+4, Math.min(x-caption.offsetWidth/2,view.right-caption.offsetWidth-4));
    caption.style.left = (captionLeft-left)+'px';
    guide.classList.toggle('label-below', bounds.top < view.top + 30);
  }
  signal.addEventListener('abort', () => { clear(); guide.remove(); hint.remove(); status.remove(); grip.remove(); sourceOutline.remove(); }, {once:true});
  return {
    choose, mark, clear, hideGrip, showGrip,
    start() { sourceOutline.hidden = false; },
    grippedItem: target => target === grip ? gripItem : null,
    project: target => target.closest(projectLabel),
    editProject: (item,event) => api.onEditProject(indexOf(item).project,event),
    commit(item) {
      const to = dest;
      clear();
      if (to) {
        api.onReorder(indexOf(item), to.target, to.edge);
        finish(item, false);
      }
    },
  };
}
