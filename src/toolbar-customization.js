import {t} from './i18n.js';
import {isToolbarLayout, TOOLBAR_LAYOUT_LIMIT} from './preferences.js';
import './toolbar-customization.css';

const controllers = new WeakMap();
const isSpacing = entry => entry.key === 'separator' || entry.key === 'space';

function spacing(key) {
  const node = document.createElement('span');
  node.className = 'toolbar-spacing';
  node.dataset.toolbarSpacing = key;
  node.setAttribute('aria-hidden', 'true');
  return {key, node, label: key === 'space' ? t('彈性空白','Flexible space') : t('分隔線','Separator')};
}

function button(command, label, text = label) {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset.toolbarCommand = command;
  node.textContent = text;
  node.title = label;
  node.setAttribute('aria-label', label);
  return node;
}

export function bindToolbarCustomization(app, {layout, onSave}) {
  const toolbar = app.querySelector('[data-toolbar-layout]');
  if (!toolbar) return {open() {}};
  if (controllers.has(toolbar)) return controllers.get(toolbar);
  const tools = [...toolbar.children].filter(node => node.hasAttribute('data-toolbar-key')).map(node => ({
    key: node.dataset.toolbarKey,
    label: node.dataset.toolbarLabel || node.getAttribute('aria-label') || node.title,
    node,
  }));
  let saved = isToolbarLayout(layout) ? [...layout] : [];
  let editor, disposeEditor;

  function entries() {
    const remaining = new Map(tools.map(tool => [tool.key, tool]));
    const ordered = [];
    for (const key of saved) {
      if (key === 'space' || key === 'separator') ordered.push(spacing(key));
      else if (remaining.has(key)) {
        ordered.push(remaining.get(key));
        remaining.delete(key);
      }
    }
    return [...ordered, ...remaining.values()];
  }
  function arrange(items) {
    const nodes = items.map(item => item.node);
    for (const old of toolbar.querySelectorAll(':scope > [data-toolbar-spacing]')) {
      if (!nodes.includes(old)) old.remove();
    }
    for (let index = 0; index < nodes.length; index++) {
      const next = toolbar.children[index];
      if (nodes[index] !== next) toolbar.insertBefore(nodes[index], next || null);
    }
  }

  function open(origin = toolbar.querySelector('[data-action="global-menu"]')) {
    if (editor || !toolbar.isConnected || !tools.length) return;
    const dialog = document.createElement('dialog');
    editor = dialog;
    dialog.className = 'toolbar-editor';
    dialog.setAttribute('aria-labelledby','toolbar-editor-title');
    dialog.setAttribute('aria-describedby','toolbar-editor-help');
    dialog.innerHTML = `<div class="toolbar-grips" role="group" aria-label="${t('工具列項目','Toolbar items')}"></div>
      <section class="toolbar-edit-panel">
        <h2 id="toolbar-editor-title">${t('自訂工具列','Customize toolbar')}</h2>
        <p id="toolbar-editor-help">${t('拖曳工具調整順序，也可以選取後按左右方向鍵。','Drag a tool to reorder it, or select it and use the arrow keys.')}</p>
        <div class="toolbar-edit-selection"><span aria-live="polite"></span><div class="toolbar-move-buttons"></div></div>
        <div class="toolbar-add-buttons"></div><div class="toolbar-edit-footer"></div>
      </section>`;
    const grips = dialog.querySelector('.toolbar-grips');
    const toolsRow = dialog.querySelector('.toolbar-move-buttons');
    toolsRow.append(button('left',t('向左移','Move left'),'←'),button('right',t('向右移','Move right'),'→'),button('remove',t('刪除間隔','Remove spacing'),'×'));
    dialog.querySelector('.toolbar-add-buttons').append(button('separator',t('加入分隔線','Add separator')),button('space',t('加入彈性空白','Add flexible space')));
    dialog.querySelector('.toolbar-edit-footer').append(button('default',t('恢復預設','Restore default')),button('cancel',t('取消','Cancel')),button('save',t('完成','Done')));
    const controls = Object.fromEntries([...dialog.querySelectorAll('[data-toolbar-command]')].map(node => [node.dataset.toolbarCommand,node]));
    const status = dialog.querySelector('[aria-live]');
    let items = entries();
    let selected = items.find(entry => entry.node === origin || entry.node.contains(origin)) || items[0];
    const handles = new Map();
    let drag = null;

    function select(entry) {
      selected = entry;
      const pos = items.indexOf(entry);
      for (const [item, grip] of handles) grip.setAttribute('aria-pressed',String(item === entry));
      status.textContent = `${entry.label} · ${pos + 1} / ${items.length}`;
      controls.left.disabled = pos === 0;
      controls.right.disabled = pos === items.length - 1;
      controls.remove.disabled = !isSpacing(entry);
      controls.space.disabled = controls.separator.disabled = items.length >= TOOLBAR_LAYOUT_LIMIT;
    }
    function place() {
      if (!dialog.open) return;
      const header = toolbar.closest('header') || toolbar;
      const top = header.getBoundingClientRect().bottom + 6;
      dialog.style.setProperty('--toolbar-edit-top', `${Math.round(top)}px`);
      for (const [entry, grip] of handles) {
        const rect = entry.node.getBoundingClientRect();
        grip.hidden = rect.width < 1 || rect.height < 1;
        Object.assign(grip.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});
      }
    }
    function update(focus = true) {
      arrange(items);
      for (const [entry, grip] of handles) {
        if (!items.includes(entry)) { grip.remove(); handles.delete(entry); }
      }
      for (const [index, entry] of items.entries()) {
        let grip = handles.get(entry);
        if (!grip) {
          grip = document.createElement('button');
          grip.type = 'button'; grip.className = 'toolbar-grip'; grip.dataset.toolbarGrip = entry.key;
          grip.title = entry.label;
          grip.setAttribute('aria-label', entry.label);
          grip.onfocus = () => select(entry);
          grip.onclick = () => select(entry);
          handles.set(entry,grip);
        }
        if (grips.children[index] !== grip) grips.insertBefore(grip,grips.children[index] || null);
      }
      place(); select(selected);
      if (focus) handles.get(selected).focus({preventScroll:true});
    }
    function move(index) {
      const pos = items.indexOf(selected);
      if (index < 0 || index >= items.length || index === pos) return;
      items.splice(pos,1); items.splice(index,0,selected);
      update();
    }
    function remove() {
      if (!isSpacing(selected)) return;
      const pos = items.indexOf(selected);
      items.splice(pos,1);
      selected = items[Math.min(pos,items.length-1)];
      update();
    }
    function finish(save, returnFocus = true) {
      if (editor !== dialog) return;
      editor = disposeEditor = null;
      const keys = items.map(entry => entry.key);
      if (save) saved = keys.every((key,index) => tools[index]?.key === key) && keys.length === tools.length ? [] : keys;
      resize.disconnect();
      window.removeEventListener('scroll',place,true);
      toolbar.removeAttribute('data-toolbar-editing');
      if (toolbar.isConnected) arrange(entries());
      dialog.close(); dialog.remove();
      if (save) onSave([...saved]);
      if (returnFocus && origin?.isConnected) origin.focus({preventScroll:true});
    }
    function dropTarget(event) {
      const nearest = items.filter(item => item !== drag.entry && !handles.get(item).hidden);
      const target = nearest.find(item => {
        const rect = handles.get(item).getBoundingClientRect();
        return event.clientX < rect.x + rect.width/2;
      });
      return target ? items.filter(item => item !== drag.entry).indexOf(target) : items.length-1;
    }
    grips.onpointerdown = event => {
      const grip = event.target.closest('[data-toolbar-grip]');
      if (!grip || event.button !== 0) return;
      const entry = items.find(item => handles.get(item) === grip);
      select(entry); grip.focus({preventScroll:true});
      drag = {entry,x:event.clientX,id:event.pointerId,started:false};
      grip.setPointerCapture(event.pointerId); event.preventDefault();
    };
    grips.onpointermove = event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (!drag.started && Math.abs(event.clientX - drag.x) < 4) return;
      drag.started = true;
      const others = items.filter(item => item !== drag.entry);
      const index = dropTarget(event);
      for (const grip of handles.values()) delete grip.dataset.drop;
      if (others.length) handles.get(others[index] || others.at(-1)).dataset.drop = index === others.length ? 'after' : 'before';
    };
    function stopDrag(event, commit) {
      if (!drag || event.pointerId !== drag.id) return;
      const index = commit && drag.started ? dropTarget(event) : -1;
      drag = null;
      for (const grip of handles.values()) delete grip.dataset.drop;
      if (index >= 0) move(index);
    }
    grips.onpointerup = event => stopDrag(event,true);
    grips.onpointercancel = event => stopDrag(event,false);
    dialog.onkeydown = event => {
      event.stopPropagation();
      if (!event.target.closest('[data-toolbar-grip]')) return;
      const pos = items.indexOf(selected);
      if (['ArrowLeft','ArrowRight','Home','End','Delete','Backspace'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Delete' || event.key === 'Backspace') remove();
        else move({ArrowLeft:pos-1,ArrowRight:pos+1,Home:0,End:items.length-1}[event.key]);
      }
    };
    dialog.oncancel = event => {event.preventDefault(); finish(false);};
    dialog.onclick = event => {
      const command = event.target.closest('[data-toolbar-command]')?.dataset.toolbarCommand;
      if (command === 'cancel' || event.target === dialog) return finish(false);
      if (command === 'save') return finish(true);
      if (command === 'left' || command === 'right') return move(items.indexOf(selected) + (command === 'left' ? -1 : 1));
      if (command === 'remove') return remove();
      if (command === 'default') {items=[...tools]; selected=items[0]; update(); return;}
      if ((command === 'space' || command === 'separator') && items.length < TOOLBAR_LAYOUT_LIMIT) {
        const added = spacing(command);
        items.splice(items.indexOf(selected)+1,0,added); selected=added; update();
      }
    };
    const resize = new ResizeObserver(place);
    resize.observe(toolbar);
    disposeEditor = () => finish(false,false);
    window.addEventListener('scroll',place,true);
    toolbar.dataset.toolbarEditing = 'true';
    app.append(dialog); dialog.showModal(); update();
  }

  const header = toolbar.closest('header') || toolbar;
  function contextMenu(event) {
    if (event.target.closest('input, textarea, [contenteditable="true"], [role="menu"], summary + *')) return;
    event.preventDefault();
    open(event.target.closest('button, select, summary') || toolbar.querySelector('[data-action="global-menu"]'));
  }
  function contextKey(event) {
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') contextMenu(event);
  }
  header.addEventListener('contextmenu',contextMenu);
  header.addEventListener('keydown',contextKey);
  if (saved.length) arrange(entries());
  function destroy() {
    disposeEditor?.();
    header.removeEventListener('contextmenu',contextMenu);
    header.removeEventListener('keydown',contextKey);
    controllers.delete(toolbar);
  }
  const controller = {open,destroy};
  controllers.set(toolbar,controller);
  return controller;
}
