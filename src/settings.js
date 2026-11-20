import {DEFAULTS,DEFAULT_SHORTCUTS,shortcutLabels,normalizeShortcut,shortcutForEvent} from './preferences.js';
import {localeTag,t} from './i18n.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories=()=>[
 ['interface',t('介面','Interface')],['workspace',t('工作區','Workspace')],
 ['editing',t('編輯與快捷鍵','Editing & shortcuts')],['storage',t('儲存與備份','Storage & backups')],
 ['export',t('匯出','Export')],['about',t('關於','About')]
];
const fields=()=>({
 interface:[
  ['language',t('語言 / Language','Language'),'select',[['zh-TW','繁體中文'],['en','English']]],
  ['uiSize',t('介面大小','Interface size'),'select',[['small',t('小','Small')],['medium',t('中','Medium')],['large',t('大','Large')]]],
  ['density',t('介面間距','Interface spacing'),'select',[['compact',t('緊湊','Compact')],['normal',t('標準','Standard')],['comfortable',t('寬鬆','Spacious')]]],
  ['theme',t('顯示主題','Color mode'),'select',[['light',t('淺色','Light')],['dark',t('深色','Dark')],['system',t('跟隨系統','Follow system')]]],
  ['palette',t('主題配色','Color palette'),'select',[['jade',t('松綠','Evergreen')],['ocean',t('海藍','Ocean')],['plum',t('梅紫','Plum')]]],
  ['typeface',t('介面字體','Interface typeface'),'select',[['system',t('系統黑體','System sans')],['book',t('閱讀襯線','Book serif')],['mono',t('等寬字體','Monospace')]]],
  ['canvasSurface',t('工作區底紋','Canvas surround'),'select',[['dots',t('點陣','Dots')],['grid',t('方格','Grid')],['plain',t('純色','Solid')]]],
  ['reduceMotion',t('減少動畫','Reduce motion'),'checkbox']
 ],
 workspace:[['sidebarVisible',t('顯示任務結構','Show task outline'),'checkbox'],['startupMode',t('啟動模式','Startup view'),'select',[['timeline',t('時間軸','Timeline')],['simple',t('圖檔','Image')],['last',t('上次檢視','Last view')]]],['rememberPictures',t('記住圖片視角','Remember image position'),'checkbox']],
 editing:[['view',t('預設顆粒度','Default time scale'),'select',[['Day',t('日','Day')],['Week',t('週','Week')],['Month',t('月','Month')],['Quarter',t('季','Quarter')],['Year',t('年','Year')]]],['snap',t('日期吸附','Date snapping'),'select',[['auto',t('自動','Auto')],['1d',t('日','Day')],['7d',t('週','Week')],['30d',t('月','Month')]]],['leftMonths',t('左側日期（月）','Earlier months'),'number',1,120],['rightMonths',t('右側日期（月）','Later months'),'number',1,120],['autoPan',t('邊緣自動平移','Auto pan at edges'),'checkbox'],['newColor',t('新專案配色','New project color'),'color'],['newIcon',t('新專案圖示','New project icon'),'text'],['newProjectFont',t('新專案字級','New project font size'),'number',8,160],['newTaskFont',t('新任務字級','New task font size'),'number',8,160],['newMilestoneShape',t('新里程碑樣式','New milestone shape'),'select',[['inherit',t('沿用圖表','Use chart setting')],['circle',t('圓點','Circle')],['star',t('星形','Star')]]]],
 storage:[['autoBackup',t('自動版本備份','Automatic version backups'),'checkbox'],['backupMinutes',t('備份間隔（分鐘）','Backup interval (minutes)'),'number',1,60],['backupCount',t('保留版本數','Versions to keep'),'number',1,50],['rememberSaveDirectory',t('記住另存資料夾','Remember save folder'),'checkbox']],
 export:[['pictureSize',t('圖片尺寸','Image size'),'select',[['fullhd','Full HD · 1920 × 1080'],['2k','2K · 2560 × 1440'],['4k','4K · 3840 × 2160']]],['background',t('畫布背景','Canvas background'),'select',[['white',t('白色','White')],['transparent',t('透明','Transparent')]]],['filename',t('圖片檔名規則','Image filename pattern'),'select',[['',t('標準','Standard')],['{title}',t('圖表標題','Chart title')],['{title}-{date}',t('標題與日期','Title and date')],['{title}-{mode}-{date}',t('標題、模式與日期','Title, view, and date')]]],['timelineScale',t('時間軸 PNG 倍率','Timeline PNG scale'),'select',[[1,'1×'],[2,'2×']]]],
 about:[],
});
export class SettingsDialog{
 constructor(api){
  this.api=api;this.section='interface';this.dialog=document.createElement('dialog');this.dialog.id='settings-dialog';this.dialog.setAttribute('aria-labelledby','settings-heading');
  this.dialog.innerHTML=`<div class="settings-frame"><div class="settings-header"><h2 id="settings-heading">${t('設定','Settings')}</h2><button data-settings-action="close" aria-label="${t('關閉設定','Close settings')}">×</button></div><div class="settings-search"><input type="search" id="settings-search" aria-label="${t('搜尋設定','Search settings')}" placeholder="${t('搜尋設定','Search settings')}"/></div><div class="settings-body"><nav class="settings-categories">${categories().map(([id,name])=>`<button data-settings-category="${id}">${name}</button>`).join('')}</nav><div class="settings-scroll"><div id="settings-error" role="alert" hidden></div><section id="settings-content"></section></div></div><footer class="settings-footer"><div><button data-settings-action="export">${t('匯出設定','Export settings')}</button><button data-settings-action="import">${t('匯入設定','Import settings')}</button></div><button data-settings-action="reset-category">${t('還原此分類','Reset category')}</button><button data-settings-action="close">${t('關閉','Close')}</button></footer></div><input type="file" id="settings-import" accept=".json,application/json" hidden/>`;
  document.body.append(this.dialog);
  this.dialog.addEventListener('close',()=>this.captureShortcuts(false));
  this.dialog.addEventListener('click',event=>{
   if(event.target===this.dialog){const r=this.dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.dialog.close();return;}
   const tab=event.target.closest('[data-settings-category]');if(tab){this.section=tab.dataset.settingsCategory;this.dialog.querySelector('#settings-search').value='';this.render();return;}
   const button=event.target.closest('[data-settings-action]');if(button)void this.perform(button.dataset.settingsAction,button);
  });
  this.dialog.querySelector('#settings-search').addEventListener('input',()=>this.render());
  this.dialog.querySelector('#settings-import').addEventListener('change',async event=>{
   const file=event.target.files[0];if(!file)return;
   try{if(file.size>1024*1024)throw Error(t('設定檔超過1MB','Settings file exceeds 1 MB'));await api.importPreferences(JSON.parse(await file.text()));this.clearError();this.render();}catch(error){this.error(t('匯入失敗：','Import failed: ')+(error instanceof SyntaxError?t('JSON 格式不正確','Invalid JSON'):error.message));}finally{event.target.value='';}
  });
 }
 captureShortcuts(active){if(window.dragDesktop)void window.dragDesktop.captureShortcuts(active).catch(error=>this.error(error.message));}
 get open(){return this.dialog.open;}
 show(section){if(section)this.section=section;this.dialog.querySelector('#settings-search').value='';this.clearError();this.render();if(!this.open)this.dialog.showModal();this.dialog.querySelector('#settings-search').focus();}
 close(){this.dialog.close();}
 refreshChrome(){
  this.dialog.querySelector('#settings-heading').textContent=t('設定','Settings');
  this.dialog.querySelector('.settings-header [data-settings-action="close"]').setAttribute('aria-label',t('關閉設定','Close settings'));
  const search=this.dialog.querySelector('#settings-search');search.setAttribute('aria-label',t('搜尋設定','Search settings'));search.placeholder=t('搜尋設定','Search settings');
  const names=Object.fromEntries(categories());for(const button of this.dialog.querySelectorAll('[data-settings-category]'))button.textContent=names[button.dataset.settingsCategory];
  for(const [action,zh,en] of [['export','匯出設定','Export settings'],['import','匯入設定','Import settings'],['reset-category','還原此分類','Reset category'],['close','關閉','Close']])this.dialog.querySelector(`.settings-footer [data-settings-action="${action}"]`).textContent=t(zh,en);
 }
 error(message){const node=this.dialog.querySelector('#settings-error');node.hidden=false;node.textContent=message;}
 clearError(){const n=this.dialog.querySelector('#settings-error');n.hidden=true;n.textContent='';}
 field(field,prefs){
  const[key,label,type,options,max]=field;if(key==='rememberSaveDirectory'&&!window.dragDesktop)return '';
  const value=prefs[key],id='pref-'+key;
  const control=key==='uiSize'?`<div class="settings-sizes" role="group" aria-label="${t('介面大小','Interface size')}">${options.map(([v,text])=>`<button type="button" data-ui-size="${v}" aria-pressed="${value===v}">${text}</button>`).join('')}</div>`:type==='select'?`<select id="${id}" data-pref="${key}">${(key==='filename'&&!options.some(([v])=>v===value)?[...options,[value,t('自訂','Custom')]]:options).map(([v,text])=>`<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${text}</option>`).join('')}</select>`:`<input id="${id}" data-pref="${key}" type="${type}" ${type==='checkbox'?`role="switch" ${value?'checked':''}`:`value="${esc(value)}"`} ${type==='number'?`min="${options}" max="${max}" step="1"`:''}/>`;
  return`<div class="settings-row" data-setting-row data-setting-name="${label.toLowerCase()}"><label for="${id}">${label}</label>${control}<button class="setting-reset" data-reset-pref="${key}" aria-label="${t('還原','Reset ')}${label}">↶</button></div>`;
 }
 render(){
  this.captureShortcuts(false);this.refreshChrome();
  const prefs=this.api.preferences(),query=this.dialog.querySelector('#settings-search').value.trim().toLowerCase(),allCategories=categories(),allFields=fields(),sections=query?allCategories.filter(([id])=>id!=='about'):allCategories.filter(([id])=>id===this.section);
  for(const button of this.dialog.querySelectorAll('[data-settings-category]'))button.setAttribute('aria-current',String(!query&&button.dataset.settingsCategory===this.section));
  let html='';
  for(const[id,title]of sections){
   const rows=(allFields[id]||[]).filter(field=>!query||field[1].toLowerCase().includes(query));
   const extras=!query;
   const shortcutRows=id==='editing'?Object.entries(shortcutLabels()).filter(([,label])=>!query||label.toLowerCase().includes(query)):[];
   if(!rows.length&&!shortcutRows.length&&query)continue;
   html+=`<div data-settings-section="${id}"><h3>${title}</h3>${rows.map(field=>this.field(field,prefs)).join('')}`;
   if(extras&&id==='workspace')html+=`<div class="settings-actions"><button data-settings-action="dock">${t('停靠左側','Dock left')}</button><button data-settings-action="float">${t('浮動面板','Floating panel')}</button><button data-settings-action="reset-layout">${t('還原工作區配置','Reset workspace layout')}</button></div>`;
   if(id==='editing'&&shortcutRows.length)html+=`<h4>${t('快捷鍵','Shortcuts')}</h4><div class="shortcut-list">${shortcutRows.map(([action,label])=>`<div class="settings-row"><label for="shortcut-${action}">${label}</label><input id="shortcut-${action}" data-shortcut="${action}" aria-label="${label}${t('快捷鍵',' shortcut')}" value="${esc(prefs.shortcuts[action])}" readonly/><button class="setting-reset" data-reset-shortcut="${action}" aria-label="${t('還原','Reset ')}${label}${t('快捷鍵',' shortcut')}">↶</button></div>`).join('')}</div>`;
   if(extras&&id==='storage')html+=`${window.dragDesktop?'':`<p id="browser-storage-note">${t('專案與版本備份只儲存在此瀏覽器。清除網站資料、換裝置或改用不同網域後，這些資料無法取回。請逐份切換時間軸檔案，使用「儲存專案」下載 JSON 保存。','Projects and version backups are stored only in this browser. Clearing site data, switching devices, or using another domain will make them unavailable. Save each roadmap file as JSON before leaving this browser.')}</p>`}<div class="settings-actions"><button data-settings-action="backup">${t('立即備份','Back up now')}</button><button data-settings-action="refresh-backups">${t('重新整理備份','Refresh backups')}</button></div><div id="backup-list"></div><div id="backup-preview"></div>`;
   if(extras&&id==='about')html+=`<button data-settings-action="quick-tour">${t('快速導覽','Quick tour')}</button><dl class="settings-about"><dt>drag</dt><dd>${esc(__APP_VERSION__)}</dd><dt>Frappe Gantt</dt><dd>1.2.2 · MIT</dd><dt>${t('第三方授權','Third-party licenses')}</dt><dd>${t('Frappe Gantt MIT · Electron MIT · Chromium BSD 與隨附授權','Frappe Gantt MIT · Electron MIT · Chromium BSD and bundled licenses')}</dd><dt>${t('資料位置','Data location')}</dt><dd id="settings-data-path">${window.dragDesktop?'':t('此瀏覽器的本機資料','Local data in this browser')}</dd></dl><button data-settings-action="get-update">${window.dragDesktop?t('取得新版','Get latest version'):t('重新載入網頁','Reload page')}</button>${window.dragDesktop?`<button data-settings-action="open-data">${t('開啟資料位置','Open data folder')}</button>`:''}`;
   html+='</div>';
  }
  if(!html)html=`<p class="settings-empty">${t('沒有符合的設定','No matching settings')}</p>`;
  this.dialog.querySelector('#settings-content').innerHTML=html;
  this.dialog.querySelector('[data-settings-action="reset-category"]').hidden=!!query||this.section==='about';
  for(const field of this.dialog.querySelectorAll('[data-pref]'))field.addEventListener('change',async()=>{
   const key=field.dataset.pref,value=field.type==='checkbox'?field.checked:field.type==='number'?(field.value===''?'':Number(field.value)):key==='timelineScale'?Number(field.value):field.value;
   try{await this.api.change(key,value);this.clearError();}catch(error){this.error(error.message);}this.render();
  });
  for(const b of this.dialog.querySelectorAll('[data-ui-size]'))b.onclick=()=>{void this.set('uiSize',b.dataset.uiSize);};
  for(const b of this.dialog.querySelectorAll('[data-reset-pref]'))b.onclick=()=>{const key=b.dataset.resetPref;void this.set(key,structuredClone(DEFAULTS[key]));};
  for(const b of this.dialog.querySelectorAll('[data-reset-shortcut]'))b.onclick=()=>{void this.set('shortcuts',{...this.api.preferences().shortcuts,[b.dataset.resetShortcut]:DEFAULT_SHORTCUTS[b.dataset.resetShortcut]});};
  for(const input of this.dialog.querySelectorAll('[data-shortcut]')){
   input.onfocus=()=>this.captureShortcuts(true);input.onblur=()=>this.captureShortcuts(false);
   input.onkeydown=event=>{
   event.stopPropagation();if(['Meta','Control','Alt','Shift','Tab'].includes(event.key))return;
   event.preventDefault();if(event.key==='Escape'){input.blur();return;}
   try{const value=['Backspace','Delete'].includes(event.key)?'':normalizeShortcut(shortcutForEvent(event)||event.key);void this.set('shortcuts',{...this.api.preferences().shortcuts,[input.dataset.shortcut]:value});}catch(error){this.error(error.message);}
  };
  }
  if(!query&&this.section==='storage')void this.backupList();
  if(!query&&this.section==='about'&&window.dragDesktop)void window.dragDesktop.info().then(info=>{const node=this.dialog.querySelector('#settings-data-path');if(node)node.textContent=info.dataPath;}).catch(error=>this.error(error.message));
 }
 async set(key,value){try{await this.api.change(key,value);this.clearError();this.render();}catch(error){this.error(error.message);}}
 async backupList(){
  const target=this.dialog.querySelector('#backup-list');if(!target)return;
  try{const records=await this.api.backups.list();if(!target.isConnected)return;target.innerHTML=records.length?records.map(record=>`<div class="backup-row"><div><b>${esc(record.title)}</b><time>${esc(new Date(record.createdAt).toLocaleString(localeTag()))}</time><span>${record.projects} ${t('專案','projects')} · ${record.tasks} ${t('任務','tasks')}</span></div><button data-backup-preview="${esc(record.id)}">${t('檢視','Preview')}</button><button data-backup-restore="${esc(record.id)}">${t('還原','Restore')}</button><button data-backup-export="${esc(record.id)}">${t('下載 JSON','Download JSON')}</button></div>`).join(''):`<p class="settings-empty">${t('尚無備份','No backups yet')}</p>`;
   for(const button of target.querySelectorAll('button'))button.onclick=async()=>{
    button.disabled=true;try{
     const id=button.dataset.backupPreview||button.dataset.backupRestore||button.dataset.backupExport,body=await this.api.backups.read(id),model=this.api.validateModel(JSON.parse(body));
     if(button.hasAttribute('data-backup-preview')){const preview=this.dialog.querySelector('#backup-preview');preview.innerHTML=`<h4>${esc(model.title)}</h4><ul>${model.projects.map(p=>`<li>${esc(p.name)} · ${p.phases.length} ${t('任務','tasks')}</li>`).join('')}</ul>`;}
     else if(button.hasAttribute('data-backup-export'))this.api.saveFile('drag-backup.json',body,'application/json');
     else if(confirm(t('以此備份還原專案？','Restore this project from the backup?'))){await this.api.restore(model);this.close();}
    }catch(error){this.error(error.message);}finally{button.disabled=false;}
   };
  }catch(error){this.error(t('備份讀取失敗：','Could not read backup: ')+error.message);}
 }
 async perform(action,button){
  try{
   if(action==='close'){this.close();return;}
   if(action==='quick-tour'){this.close();this.api.openTour();}
   else if(action==='export')this.api.exportPreferences();
   else if(action==='import'){const input=this.dialog.querySelector('#settings-import');input.value='';input.click();}
   else if(action==='reset-category'){await this.api.resetCategory(this.section);this.render();}
   else if(action==='dock'||action==='float'||action==='reset-layout'){await this.api.workspace(action);this.render();}
   else if(action==='backup'){button.disabled=true;await this.api.backups.write(this.api.model(),this.api.preferences());await this.backupList();}
   else if(action==='refresh-backups')await this.backupList();
   else if(action==='open-data')await window.dragDesktop.openDataFolder();
   else if(action==='get-update'){this.clearError();button.disabled=true;if(window.dragDesktop)await window.dragDesktop.openUpdates();else window.location.reload();}
  }catch(error){this.error(error.message);}finally{button.disabled=false;}
 }
}
