import { t } from './i18n.js';
import { taskProgress } from './model.js';

const position = row => ({
  project: Number(row.closest('.project').dataset.p),
  phase: row.hasAttribute('data-f') ? Number(row.dataset.f) : null,
});

export function outlineMarkup(projects, selected, collapsed, esc) {
  const grip = '<span class="drag-handle" aria-hidden="true">⠿</span>';
  const renameLabel=t('重新命名','Rename');
  const renameButton=`<button type="button" class="outline-rename-button" tabindex="-1" title="${renameLabel} (F2)" aria-label="${renameLabel}"><svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12-1 5 5-1L17 7l-4-4zM11 5l4 4"/></svg></button>`;
  return projects.map((project, pi) => {
    const folded = collapsed.has(project.id);
    const active = selected?.project === pi && selected.phase === null;
    const tabbable = active || (folded && selected?.project === pi) || (!selected && pi === 0);
    const foldLabel = folded ? t('展開專案','Expand project') : t('收合專案','Collapse project');
    return `<div class="project" data-p="${pi}" role="none">
      <div class="tree-item ${active ? 'selected' : ''}" draggable="true" role="treeitem" aria-level="1" aria-owns="outline-group-${pi}" aria-labelledby="outline-label-${pi}" aria-expanded="${!folded}" aria-selected="${active}" tabindex="${tabbable ? 0 : -1}" data-select-p="${pi}" data-p="${pi}">
        ${grip}<button class="outline-fold" type="button" tabindex="-1" aria-label="${foldLabel}" title="${foldLabel}" aria-expanded="${!folded}"><span aria-hidden="true">${folded ? '▸' : '▾'}</span></button>
        <span class="tree-icon" aria-hidden="true">${esc(project.icon ?? '▣')}</span><b class="tree-label" id="outline-label-${pi}">${esc(project.name)}</b><span class="count">${project.phases.length}</span>${renameButton}
      </div><div role="group" id="outline-group-${pi}" ${folded ? 'hidden' : ''}>${project.phases.map((task, fi) => {
        const active = selected?.project === pi && selected.phase === fi;
        const progress = taskProgress(task.progress);
        const status = typeof task.status === 'string' ? task.status.trim() : '';
        const trackingId = `outline-tracking-${pi}-${fi}`;
        const tracking = status || progress !== null ? `<span class="outline-tracking" id="${trackingId}">
          ${status ? `<span class="outline-status" title="${esc(status)}"><span class="visually-hidden">${t('階段狀態','Stage status')} </span>${esc(status)}</span>` : ''}
          ${progress !== null ? `<span class="outline-progress"><span class="visually-hidden">${t('完成進度','Progress')} </span>${progress}%</span>` : ''}
        </span>` : '';
        return `<div class="tree-item phase ${active ? 'selected' : ''}" draggable="true" role="treeitem" aria-level="2" aria-labelledby="outline-label-${pi}-${fi}" ${tracking ? `aria-describedby="${trackingId}"` : ''} aria-selected="${active}" tabindex="${active && !folded ? 0 : -1}" data-p="${pi}" data-f="${fi}" data-select-f="${pi}:${fi}">
          ${grip}<span class="phase-icon" aria-hidden="true">${esc(task.icon || '↳')}</span><span class="outline-task-copy"><span class="tree-label" id="outline-label-${pi}-${fi}">${esc(task.label)}</span>${tracking}</span>${renameButton}
        </div>`;
      }).join('')}</div></div>`;
  }).join('');
}

// A destination slot is between two siblings. Resolve it before removing the
// source, so moving down one row and dropping onto oneself are unambiguous.
export function outlineMove(projects, from, to, edge) {
  const group = from.phase === null;
  if (group && to.phase !== null) return null;
  const source = group ? projects : projects[from.project].phases;
  const target = group ? projects : projects[to.project].phases;
  const index = group ? from.project : from.phase;
  const slot = edge === 'inside' ? target.length : (group ? to.project : to.phase) + Number(edge === 'after');
  const insertAt = slot - Number(source === target && index < slot);
  if (source === target && insertAt === index) return null;
  return () => {
    const [item] = source.splice(index, 1);
    target.splice(insertAt, 0, item);
    if (!group) {
      item.locks ??= {};
      item.locks.parent = true;
    }
    return group ? { project: insertAt, phase: null } : { project: to.project, phase: insertAt };
  };
}

export function setOutlineTabStop(tree, row) {
  const previous = tree.querySelector('.tree-item[tabindex="0"]');
  if (previous === row) return;
  if (previous) previous.tabIndex = -1;
  row.tabIndex = 0;
}

function lastVisibleRow(project) {
  const group = project.lastElementChild;
  return (!group.hidden && group.lastElementChild) || project.firstElementChild;
}

function adjacentRow(row, next) {
  const project = row.closest('.project');
  if (next) {
    if (row.hasAttribute('data-f')) {
      if (row.nextElementSibling) return row.nextElementSibling;
    } else {
      const children = project.lastElementChild;
      if (!children.hidden && children.firstElementChild) return children.firstElementChild;
    }
    return project.nextElementSibling?.firstElementChild || row;
  }
  if (row.hasAttribute('data-f')) return row.previousElementSibling || project.firstElementChild;
  return project.previousElementSibling ? lastVisibleRow(project.previousElementSibling) : row;
}

export function bindOutline(tree, api) {
  function focus(row, reveal = true) {
    setOutlineTabStop(tree, row);
    row.focus({ preventScroll: true });
    if (reveal) row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function startRename(row) {
    if (tree.querySelector('.outline-rename')) return;
    const label = row.querySelector('.tree-label');
    const original = label.textContent;
    const input = document.createElement('input');
    input.className = 'outline-rename';
    input.value = original;
    input.setAttribute('aria-label', t('重新命名','Rename'));
    row.draggable = false;
    label.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    function finish(commit, returnFocus = true) {
      if (finished) return;
      const value = input.value.trim();
      if (commit && !value && document.activeElement === input) {
        input.setCustomValidity(t('請輸入名稱','Enter a name'));
        input.reportValidity();
        return;
      }
      finished = true;
      input.replaceWith(label);
      row.draggable = !matchMedia('(max-width:700px)').matches;
      if (commit && value && value !== original) api.rename(position(row), value, returnFocus);
      else if (returnFocus && tree.isConnected) focus(row);
    }
    input.oninput = () => input.setCustomValidity('');
    input.onkeydown = event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === 'Enter');
      }
    };
    input.onblur = () => finish(true, false);
  }

  tree.addEventListener('click', event => {
    const row = event.target.closest('.tree-item');
    if (!row || event.target.closest('input,.mobile-sort')) return;
    if (event.target.closest('.outline-rename-button')) {
      startRename(row);
      return;
    }
    if (event.target.closest('.outline-fold')) {
      api.fold(position(row).project);
      return;
    }
    focus(row, false);
    api.select(position(row));
  });
  tree.addEventListener('dblclick', event => {
    const row = event.target.closest('.tree-item');
    if (row && !event.target.closest('input,button')) startRename(row);
  });
  tree.addEventListener('keydown', event => {
    if (event.target.closest('button,input')) return;
    const row = event.target.closest('.tree-item');
    if (!row) return;
    const pos = position(row);
    switch (event.key) {
      case 'Enter': case ' ': api.select(pos); break;
      case 'F2': startRename(row); break;
      case 'Home': focus(tree.firstElementChild.firstElementChild); break;
      case 'End': focus(lastVisibleRow(tree.lastElementChild)); break;
      case 'ArrowUp': case 'ArrowDown': {
        const delta = event.key === 'ArrowUp' ? -1 : 1;
        if (event.altKey) api.step(pos, delta);
        else focus(adjacentRow(row, delta > 0));
        break;
      }
      case 'ArrowLeft':
        if (pos.phase !== null) focus(row.closest('.project').querySelector('[data-select-p]'));
        else if (row.getAttribute('aria-expanded') === 'true') api.fold(pos.project);
        break;
      case 'ArrowRight':
        if (pos.phase !== null) return;
        if (row.getAttribute('aria-expanded') === 'false') api.fold(pos.project);
        else if (row.nextElementSibling.firstElementChild) focus(row.nextElementSibling.firstElementChild);
        break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  let dragged, marked;
  function clearMark() {
    if (marked) delete marked.row.dataset.drop;
    marked = null;
  }
  function clear() {
    dragged?.classList.remove('is-dragging');
    dragged = null;
    clearMark();
  }
  function destination(event) {
    const row = event.target.closest('.tree-item');
    if (!row || !dragged || row === dragged) return null;
    const source = position(dragged), target = position(row);
    if (source.phase === null && target.phase !== null) return null;
    const rect = row.getBoundingClientRect();
    const edge = source.phase !== null && target.phase === null ? 'inside' :
      (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    return { row, source, target, edge };
  }
  tree.addEventListener('dragstart', event => {
    const row = event.target.closest('.tree-item[draggable="true"]');
    if (!row || event.target.closest('button,input')) return;
    dragged = row;
    row.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.querySelector('.tree-label').textContent);
  });
  tree.addEventListener('dragover', event => {
    const dest = destination(event);
    clearMark();
    if (!dest) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    marked = { ...dest, x: event.clientX, y: event.clientY };
    marked.row.dataset.drop = dest.edge;
  });
  tree.addEventListener('dragleave', event => {
    if (!tree.contains(event.relatedTarget)) clearMark();
  });
  tree.addEventListener('dragend', clear);
  tree.addEventListener('drop', event => {
    let dest = destination(event);
    // Firefox can retarget the release to the containing group at the same
    // position as the accepted dragover. Keep the drop shown by the indicator.
    if (!dest && marked && event.target.contains(marked.row) &&
        Math.abs(event.clientX - marked.x) <= 1 && Math.abs(event.clientY - marked.y) <= 1) {
      dest = marked;
    }
    clear();
    if (dest) {
      event.preventDefault();
      api.move(dest.source, dest.target, dest.edge);
    }
  });
}
