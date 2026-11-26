import { getLocale, t } from './i18n.js';

const headerSymbols = {
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4zM13.5 6.5l4 4"/>',
  timeline: '<path d="M3 5h8v3H3zM7 11h10v3H7zM13 17h8v3h-8z"/>',
  simple: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
  tracking: '<path d="M8 4h12M8 12h12M8 20h12M2 4l1 1 2-3M2 12l1 1 2-3M2 20l1 1 2-3"/>',
  display: '<path d="M3 6h6m5 0h7M3 12h11m5 0h2M3 18h3m5 0h10"/><circle cx="11.5" cy="6" r="2.5"/><circle cx="16.5" cy="12" r="2.5"/><circle cx="8.5" cy="18" r="2.5"/>',
  export: '<path d="M12 3v11m-4-4 4 4 4-4M4 15v5h16v-5"/>',
};
function symbol(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${headerSymbols[name]}</svg>`;
}
function options(items, selected) {
  return items.map(([value,label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}
function timelineSettings(snap) {
  return `<div class="timeline-controls">
    <div class="timeline-quick">
      <div class="date-navigation"><button data-action="prev" aria-label="${t('往前','Previous')}">‹</button><button data-action="today">${t('今天','Today')}</button><button data-action="next" aria-label="${t('往後','Next')}">›</button></div>
    </div>
    <label class="snap-control">${t('吸附','Snap')}<select id="snap">${options([['auto',t('自動','Auto')],['1d',t('日','Day')],['7d',t('週','Week')],['30d',t('月','Month')]],snap)}</select></label>
    <span class="range-caption">${t('延伸日期範圍','Extend date range')}</span>
    <div class="range-actions"><button data-action="expand-left">${t('＋ 左側日期','＋ Earlier dates')}</button><button data-action="expand-right">${t('＋ 右側日期','＋ Later dates')}</button></div>
    <span class="range-caption">${t('縮短日期範圍','Shorten date range')}</span>
    <div class="range-actions"><button data-action="shrink-left">${t('－ 左側','－ Earlier')}</button><button data-action="shrink-right">${t('－ 右側','－ Later')}</button></div>
  </div>`;
}
export function workspaceHeader({ title, activeId, mode, snap, timelineFitEnabled, icon, esc }) {
  const modes = [['timeline', t('時間軸', 'Timeline')], ['simple', t('圖檔', 'Image')], ['tracking', t('追蹤', 'Tracking')]];
  const menu = [['save',t('儲存專案','Save project')],['import',t('開啟專案','Open project')],['customize-toolbar',t('自訂工具列','Customize toolbar')],['settings',t('設定','Settings')]];
  if (mode === 'simple') menu.unshift(['newproject',t('新增專案','New project')]);
  const formats = [['svg',t('匯出 SVG','Export SVG')],['png',t('匯出 PNG','Export PNG')],['gif',t('匯出動態 GIF','Export animated GIF')]];
  const history = [['undo',t('復原','Undo')],['redo',t('重做','Redo')]];
  const exportLabel = t('匯出圖片','Export image');
  const menuItems = items => items.map(([key,label])=>`<button type="button" role="menuitem" data-action="${key}" aria-label="${label}">${icon(key==='import'?'open':key==='customize-toolbar'?'settings':key==='newproject'?'plus':key)}<span>${label}</span></button>`).join('');
  const display = t('呈現設定','View options'), actions = t('專案操作','Project actions');
  const fit = t('符合內容','Fit content');
  const name = esc(title || t('未命名時間軸','Untitled roadmap'));
  const rename = t('修改工作區名稱','Edit workspace title');
  const library = t('文件庫','Documents');
  return `<header class="workspace-header">
    <div class="brand" aria-label="drag Roadmap Editor"><img src="/icon.svg" alt="" width="26" height="26"><b>drag<span class="brand-dot">.</span></b></div>
    <div class="workspace-heading"><span class="workspace-eyebrow visually-hidden">${t('工作區','Workspace')}</span><button type="button" class="workspace-title" title="${rename} · ${name}" aria-label="${rename} · ${name}"><strong>${name}</strong>${symbol('edit')}</button></div>
    <div class="tabs page-tabs" role="tablist" aria-label="${t('工作區頁面','Workspace pages')}">${modes.map(([key,label])=>`<button type="button" id="tab-${key}" role="tab" data-action="${key}" aria-controls="workspace-panel" aria-selected="${mode===key}" tabindex="${mode===key?0:-1}" class="${mode===key?'active':''}" aria-label="${label}" title="${label}">${symbol(key)}<span>${label}</span></button>`).join('')}</div>
    <div class="toolbar workspace-tools" data-toolbar-layout role="group" aria-label="${t('功能工具列','Workspace tools')}">
    <div class="document-picker" data-toolbar-key="documents" data-toolbar-label="${library}">
      <button type="button" data-action="document-menu" data-active-id="${esc(activeId)}" aria-label="${library}" title="${library}" aria-haspopup="menu" aria-controls="document-menu" aria-expanded="false">${icon('open')}<span class="library-label">${library}</span><span class="select-chevron" aria-hidden="true"></span></button>
    </div>
      ${history.map(([key,label])=>`<div class="history-actions" data-toolbar-key="${key}" data-toolbar-label="${label}"><button type="button" data-action="${key}" aria-label="${label}" title="${label}">${icon(key)}</button></div>`).join('')}
      <details class="range-options view-settings" data-toolbar-key="display" data-toolbar-label="${display}" data-view-mode="${mode}" ${mode==='tracking'?'inert aria-disabled="true"':''}>
        <summary aria-label="${display}" title="${display}">${symbol('display')}<span>${display}</span></summary>
        <div class="view-settings-panel" role="group" aria-label="${display}">
          <div class="view-options-actions" ${mode==='timeline'?'':'hidden'}><button data-action="fit-content" class="fit-content-button" aria-pressed="${timelineFitEnabled && mode==='timeline'}" aria-label="${fit}" title="${fit}">${icon('fit')}<span>${fit}</span></button></div>
          <div class="picture-settings-slot" ${mode==='simple'?'':'hidden'}></div>
          <div ${mode!=='timeline'?'hidden':''}>${timelineSettings(snap)}</div>
        </div>
      </details>
    <div class="image-export-actions" data-toolbar-key="export" data-toolbar-label="${exportLabel}">
      <button type="button" data-action="export-menu" title="${exportLabel}" aria-label="${exportLabel}" aria-haspopup="menu" aria-controls="image-export-menu" aria-expanded="false">${symbol('export')}<span class="select-chevron" aria-hidden="true"></span></button>
      <nav id="image-export-menu" class="action-menu" role="menu" aria-label="${exportLabel}" hidden>${menuItems(formats)}</nav>
      <output class="image-export-status" role="status"></output>
    </div>
    <label class="toolbar-language" data-toolbar-key="language" data-toolbar-label="${t('語言','Language')}" title="${t('語言 / Language','Language / 語言')}">${icon('language')}<span class="language-code" aria-hidden="true">${getLocale()==='en'?'EN':'繁中'}</span><span class="select-chevron" aria-hidden="true"></span><select id="workspace-language" aria-label="${t('語言 / Language','Language / 語言')}">${options([['zh-TW','繁體中文'],['en','English']],getLocale())}</select></label>
    <div class="global-actions" data-toolbar-key="more" data-toolbar-label="${actions}"><button type="button" data-action="global-menu" aria-label="${actions}" title="${actions}" aria-haspopup="menu" aria-controls="global-action-menu" aria-expanded="false">${icon('menu')}</button>
      <nav id="global-action-menu" class="action-menu" role="menu" aria-label="${actions}" hidden>${menuItems(menu)}</nav>
    </div>
    </div>
  </header>`;
}

export function bindWorkspaceTitle(app, title, save) {
  const button = app.querySelector('.workspace-title');
  button.onclick = () => {
    const input = document.createElement('input');
    input.className = 'workspace-title-input';
    input.value = title ?? '';
    input.setAttribute('aria-label', t('工作區名稱','Workspace title'));
    button.replaceWith(input);
    input.focus();
    input.select();
    function finish(commit, returnFocus) {
      if (!input.isConnected) return;
      const value = input.value.trim();
      if (commit && !value && returnFocus) {
        input.setCustomValidity(t('請輸入工作區名稱','Enter a workspace title'));
        input.reportValidity();
        return;
      }
      input.onblur = null;
      input.replaceWith(button);
      if (commit && value && value !== title && save(value)) {
        title = value;
        button.querySelector('strong').textContent = value;
        button.title = t('修改工作區名稱','Edit workspace title') + ' · ' + value;
        button.setAttribute('aria-label', button.title);
      }
      if (returnFocus) button.focus({preventScroll:true});
    }
    input.oninput = () => input.setCustomValidity('');
    input.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      finish(event.key === 'Enter', true);
    };
    input.onblur = () => finish(true, false);
  };
}

export function bindPageTabs(app, navigate) {
  const group = app.querySelector('[role="tablist"]');
  group.onkeydown = event => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target);
    if (index < 0 || event.altKey || event.metaKey || event.ctrlKey) return;
    let next;
    switch (event.key) {
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    navigate(tabs[next].dataset.action);
  };
}
export function rememberHeader(app) {
  const settings = app.querySelector('.view-settings[open]');
  if (!settings) return null;
  return {
    mode: settings.dataset.viewMode,
    sections: [...settings.querySelectorAll('details[open]')].map(item=>item.className),
    field: settings.contains(document.activeElement) ? document.activeElement.id : null,
    scroll: settings.querySelector('.view-settings-panel').scrollTop,
  };
}
export function restoreHeader(app,state) {
  const settings = app.querySelector('.view-settings');
  if (!state || settings.dataset.viewMode !== state.mode) return;
  settings.open = true;
  for (const detail of settings.querySelectorAll('details')) detail.open=state.sections.includes(detail.className);
  if (state.field) settings.querySelector('#'+CSS.escape(state.field))?.focus({preventScroll:true});
  settings.querySelector('.view-settings-panel').scrollTop=state.scroll;
}
