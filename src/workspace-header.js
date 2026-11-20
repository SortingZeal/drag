import { getLocale, t } from './i18n.js';

const headerSymbols = {
  timeline: '<path d="M3 5h8v3H3zM7 11h10v3H7zM13 17h8v3h-8z"/>',
  simple: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
  display: '<path d="M3 6h6m5 0h7M3 12h11m5 0h2M3 18h3m5 0h10"/><circle cx="11.5" cy="6" r="2.5"/><circle cx="16.5" cy="12" r="2.5"/><circle cx="8.5" cy="18" r="2.5"/>',
};
function symbol(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${headerSymbols[name]}</svg>`;
}
function options(items, selected) {
  return items.map(([value,label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}
function timelineSettings(view,snap) {
  const scale = [['Day',t('日','Day')],['Week',t('週','Week')],['Month',t('月','Month')],['Quarter',t('季','Quarter')],['Year',t('年','Year')]];
  return `<div class="timeline-controls">
    <div class="timeline-quick"><label class="scale-label" for="view">${t('尺度','Scale')}</label><select id="view">${options(scale,view)}</select>
      <div class="date-navigation"><button data-action="prev" aria-label="${t('往前','Previous')}">‹</button><button data-action="today">${t('今天','Today')}</button><button data-action="next" aria-label="${t('往後','Next')}">›</button></div>
    </div>
    <label class="snap-control">${t('吸附','Snap')}<select id="snap">${options([['auto',t('自動','Auto')],['1d',t('日','Day')],['7d',t('週','Week')],['30d',t('月','Month')]],snap)}</select></label>
    <span class="range-caption">${t('延伸日期範圍','Extend date range')}</span>
    <div class="range-actions"><button data-action="expand-left">${t('＋ 左側日期','＋ Earlier dates')}</button><button data-action="expand-right">${t('＋ 右側日期','＋ Later dates')}</button></div>
    <span class="range-caption">${t('縮短日期範圍','Shorten date range')}</span>
    <div class="range-actions"><button data-action="shrink-left">${t('－ 左側','－ Earlier')}</button><button data-action="shrink-right">${t('－ 右側','－ Later')}</button></div>
  </div>`;
}
export function workspaceHeader({ title, mode, view, snap, timelineFitEnabled, icon, esc }) {
  const modes = [['timeline', t('時間軸', 'Timeline')], ['simple', t('圖檔', 'Image')]];
  const menu = [['save',t('儲存專案','Save project')],['import',t('開啟專案','Open project')],['undo',t('復原','Undo')],['redo',t('重做','Redo')],['svg',t('匯出 SVG','Export SVG')],['png',t('匯出 PNG','Export PNG')],['gif',t('匯出動態 GIF','Export animated GIF')],['settings',t('設定','Settings')]];
  const display = t('呈現設定','View options'), actions = t('專案操作','Project actions');
  const fit = t('符合內容','Fit content');
  return `<header class="workspace-header">
    <div class="brand" aria-label="drag Roadmap Editor"><img src="/icon.svg" alt="" width="26" height="26"><b>drag<span class="brand-dot">.</span></b></div>
    <div class="workspace-heading"><span class="workspace-eyebrow visually-hidden">${t('工作區','Workspace')}</span><strong title="${esc(title)}">${esc(title)}</strong></div>
    <div class="toolbar" role="group" aria-label="${t('檢視工具列','View toolbar')}">
      <div class="tabs">${modes.map(([key,label])=>`<button data-action="${key}" class="${mode===key?'active':''}" aria-pressed="${mode===key}" aria-label="${label}" title="${label}">${symbol(key)}<span>${label}</span></button>`).join('')}</div>
      <div class="toolbar-inline-tools"></div>
      <details class="range-options view-settings" data-view-mode="${mode}">
        <summary aria-label="${display}" title="${display}">${symbol('display')}<span>${display}</span></summary>
        <div class="view-settings-panel" role="group" aria-label="${display}">
          ${mode==='timeline'?`<div class="view-options-actions"><button data-action="fit-content" class="fit-content-button" aria-pressed="${timelineFitEnabled}" aria-label="${fit}" title="${fit}">${icon('fit')}<span>${fit}</span></button></div>`: ''}
          <div class="picture-settings-slot" ${mode==='timeline'?'hidden':''}></div>
          <div ${mode!=='timeline'?'hidden':''}>${timelineSettings(view,snap)}</div>
        </div>
      </details>
    </div>
    <label class="toolbar-language" title="${t('語言 / Language','Language / 語言')}">${icon('language')}<span class="language-code" aria-hidden="true">${getLocale()==='en'?'EN':'繁中'}</span><span class="select-chevron" aria-hidden="true"></span><select id="workspace-language" aria-label="${t('語言 / Language','Language / 語言')}">${options([['zh-TW','繁體中文'],['en','English']],getLocale())}</select></label>
    <div class="global-actions"><button type="button" data-action="global-menu" aria-label="${actions}" title="${actions}" aria-haspopup="menu" aria-controls="global-action-menu" aria-expanded="false">${icon('menu')}</button>
      <output class="image-export-status" role="status"></output>
      <nav id="global-action-menu" role="menu" aria-label="${actions}" hidden>${menu.map(([key,label])=>`<button type="button" role="menuitem" data-action="${key}" aria-label="${label}">${icon(key==='import'?'open':key)}<span>${label}</span></button>`).join('')}</nav>
    </div>
  </header>`;
}

export function layoutHeaderTools(app) {
  const header = app.querySelector('.workspace-header');
  if (!header) return;
  const wide = matchMedia('(min-width: 901px)').matches;
  const details = header.querySelector('.view-settings');
  const inline = header.querySelector('.toolbar-inline-tools');
  const quick = header.querySelector('.timeline-quick');
  const fit = header.querySelector('[data-action="fit-content"]');
  if (wide && details.dataset.viewMode==='timeline') inline.append(quick);
  else header.querySelector('.timeline-controls').prepend(quick);
  if (!fit) return;
  if (wide) inline.append(fit);
  else header.querySelector('.view-options-actions').prepend(fit);
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
  layoutHeaderTools(app);
  const settings = app.querySelector('.view-settings');
  if (!state || settings.dataset.viewMode !== state.mode) return;
  settings.open = true;
  for (const detail of settings.querySelectorAll('details')) detail.open=state.sections.includes(detail.className);
  if (state.field) settings.querySelector('#'+CSS.escape(state.field))?.focus({preventScroll:true});
  settings.querySelector('.view-settings-panel').scrollTop=state.scroll;
}
