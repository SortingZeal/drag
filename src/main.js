import { renderSimple } from './simple.js';
import { exportTimeline, exportInfographicImage } from './export.js';
import { Timeline, ordinal } from './timeline.js';
import { normalizeModel, taskProgress, isValidDate, readDraft, assertTimelineRenderBudget, assertImportFileSize, assertImportModelBudget, MAX_PROJECTS } from './model.js';
import { pictureAlignmentDate } from './align-start.js';
import { PictureViewport, PICTURE_ZOOM_LEVELS } from './picture-viewport.js';
import { bindOutline, outlineMarkup, outlineMove } from './task-outline.js';
import { SidebarPanel } from './sidebar-panel.js';
import {QuickTour} from './quick-tour.js';
import './quick-tour.css';
import {SettingsDialog} from './settings.js';
import {Backups} from './backups.js';
import {Documents,documentFilename} from './documents.js';
import './documents.css';
import {loadPreferences,storePreferences,normalizePreferences,parsePreferencesFile,DEFAULTS,GROUPS,shortcutForEvent,imageFilename,normalizeViewMode} from './preferences.js';
import {getLocale,setLocale,t} from './i18n.js';
import './style.css';
import './timeline-ui.css';
import './picture-ui.css';
import './sidebar-ui.css';
import './ui-size.css';
import './settings.css';
import './workspace-ui.css';
import './studio.css';
import './task-outline.css';
import {workspaceHeader, layoutHeaderTools, rememberHeader, restoreHeader} from './workspace-header.js';
import './workspace-header.css';
import './appearance.css';

async function startApp(){
try{const key='drag.storage-probe';localStorage.setItem(key,'1');localStorage.removeItem(key);}
catch{throw new Error(t('瀏覽器的本機儲存空間無法使用','Browser local storage is unavailable'));}
const mobileLayout=matchMedia('(max-width:700px)');
const deep = v => JSON.parse(JSON.stringify(v));
const uid = () => globalThis.crypto?.randomUUID?.() ?? 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const day = s => new Date(`${s}T12:00:00`);
const fmt = d => { const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const addDays=(s,n)=>{const d=day(s);d.setDate(d.getDate()+n);return fmt(d)};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name)=>{
 const paths={gif:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>',menu:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',language:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',save:'<path d="M4 3h13l3 3v15H4zM8 3v6h8V3M8 21v-8h8v8"/>',open:'<path d="M3 7V4h7l2 2h9v3M3 9h18l-2 11H5z"/>',undo:'<path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/>',redo:'<path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',svg:'<path d="M7 3h8l5 5v13H4V3h3zm8 0v5h5M7 15h10M7 18h7"/>',png:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/>',settings:'<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/>',plus:'<path d="M12 5v14M5 12h14"/>',actual:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8M12 8v8"/>',center:'<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>'};
 return `<svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};
const initialPreferences=loadPreferences(localStorage);
if (!localStorage.getItem('drag.preferences') && new URLSearchParams(location.search).get('lang') === 'en') {
 initialPreferences.language = 'en';
}
setLocale(initialPreferences.language);
const seed=await fetch(getLocale()==='en'?'/roadmap.en.json':'/roadmap.json').then(r=>r.json());
let firstUse=false;try{firstUse=localStorage.getItem('drag.draft')===null;}catch{}
const loaded=readDraft(seed,localStorage);
const files=await new Documents(localStorage,error=>alert(t('時間軸檔案儲存失敗：','Roadmap file save failed: ')+error.message)).open(loaded.model,loaded.warning);
loaded.warning=files.warning;firstUse=firstUse&&files.createdInitial;
let model=files.model;
let filesBusy=false;const fileStates=new Map();
let selected={project:0,phase:0};
let preferences=initialPreferences,settingsDialog;
const quickTour=new QuickTour(localStorage,()=>preferences.uiSize);
storePreferences(localStorage,preferences);
let savedWorkspace;try{savedWorkspace=JSON.parse(localStorage.getItem('drag.workspace')||'{}')}catch{savedWorkspace={}}
if(files.active.workspace&&typeof files.active.workspace==='object'&&!Array.isArray(files.active.workspace))savedWorkspace=files.active.workspace;
else if(files.activeId!==files.originalId)savedWorkspace={};
if(!savedWorkspace||typeof savedWorkspace!=='object'||Array.isArray(savedWorkspace))savedWorkspace={};
let mode=normalizeViewMode(preferences.startupMode==='last'?savedWorkspace.mode:preferences.startupMode);
let timelinePosition=preferences.startupMode==='last'&&Number.isFinite(savedWorkspace.timeline?.day)&&Math.abs(savedWorkspace.timeline.day)<5000000?{day:savedWorkspace.timeline.day,top:Math.max(0,Number(savedWorkspace.timeline.top)||0)}:null;
let uiSize=preferences.uiSize;
const backups=new Backups(error=>alert(t('備份失敗：','Backup failed: ')+(error.message||error)));
await backups.setDocument(files.activeId,files.activeId===files.originalId);

let pictureViewport=null,sidebarPanel=null,timelineFitObserver=null;
let sidebarState;
try{sidebarState=JSON.parse(localStorage.getItem('drag.sidebar')||'{}')}catch{sidebarState={}}
if(!sidebarState||typeof sidebarState!=='object'||Array.isArray(sidebarState))sidebarState={};
const pictureViews={infographic:{zoom:1,center:{x:0.5,y:0.5}},simple:{zoom:1,center:{x:0.5,y:0.5}}};
if(preferences.rememberPictures)for(const key of ['simple','infographic']){
 const value=savedWorkspace.pictures?.[key];if(value&&Number.isFinite(value.zoom)&&Number.isFinite(value.center?.x)&&Number.isFinite(value.center?.y))pictureViews[key]={zoom:Math.max(.001,Math.min(8,value.zoom)),center:{x:Math.max(-1000,Math.min(1000,value.center.x)),y:Math.max(-1000,Math.min(1000,value.center.y))}};
}
let view=preferences.startupMode==='last'&&['Day','Week','Month','Quarter','Year'].includes(savedWorkspace.view)?savedWorkspace.view:preferences.view,gantt=null,exporting=false,history=[],redo=[];
let timelineFitEnabled=!!savedWorkspace.fitContent;
const storedNumber=(key,fallback,min,max)=>{const n=Number(localStorage.getItem(key)??fallback);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
let leftPaddingMonths=preferences.leftMonths,rightPaddingMonths=preferences.rightMonths,snap=preferences.snap;
const persistTimeline=()=>{preferences.leftMonths=leftPaddingMonths;preferences.rightMonths=rightPaddingMonths;storePreferences(localStorage,preferences);};
const shiftMonths=(iso,n)=>{const d=day(iso);const date=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);d.setDate(Math.min(date,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return fmt(d)};
const bounds=()=>{const dates=model.projects.flatMap(p=>p.phases.flatMap(f=>[f.start,f.end])).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));const now=fmt(new Date());return {start:dates.length?dates.reduce((a,b)=>a<b?a:b):now,end:dates.length?dates.reduce((a,b)=>a>b?a:b):now}};
function allowTimelineRange(left,right){try{assertTimelineRenderBudget(taskList(),view,left,right);return true;}catch(error){alert(error.message);return false;}}
function extendTimeline(side,n){const left=side==='left'?Math.max(1,Math.min(120,leftPaddingMonths+n)):leftPaddingMonths,right=side==='right'?Math.max(1,Math.min(120,rightPaddingMonths+n)):rightPaddingMonths;if(!allowTimelineRange(left,right))return;leftPaddingMonths=left;rightPaddingMonths=right;persistTimeline();renderGantt(true)}
let paneHeight=storedNumber('drag.paneHeight',68,25,78);
let inspectorCollapsed=true;
let explicitOutlineSelection=false;
const collapsedProjects=new Set();
let inspectorWidth=storedNumber('drag.inspectorWidth',300,260,420);
let globalMenuPinned=false;
let suppressGlobalFocus=false;
const editorSections={basic:true,schedule:true,appearance:true};
const app=document.querySelector('#app');
function showGlobalMenu(){
 if(suppressGlobalFocus||app.querySelector('.view-settings[open]'))return;
 const menu=app.querySelector('#global-action-menu'),trigger=app.querySelector('[data-action="global-menu"]');
 if(!menu||!trigger)return;
 menu.hidden=false;trigger.setAttribute('aria-expanded','true');
}
function hideGlobalMenu(focus=false){globalMenuPinned=false;const menu=app.querySelector('#global-action-menu'),trigger=app.querySelector('[data-action="global-menu"]');if(!menu||!trigger)return;menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus){suppressGlobalFocus=true;trigger.focus();queueMicrotask(()=>{suppressGlobalFocus=false;});}}
let documentDialogMode='new',deleteDocumentId=null;
const documentDialog=document.createElement('dialog');documentDialog.id='document-dialog';documentDialog.className='document-dialog';documentDialog.setAttribute('aria-labelledby','document-dialog-title');
documentDialog.innerHTML=`<form method="dialog"><h2 id="document-dialog-title">${t('新增時間軸檔案','New roadmap file')}</h2><label for="document-name">${t('名稱','Name')}</label><input id="document-name" name="name" required maxlength="200" autocomplete="off"/><div class="document-dialog-actions"><button type="button" data-document-action="cancel">${t('取消','Cancel')}</button><button type="submit">${t('建立','Create')}</button></div></form>`;document.body.append(documentDialog);
documentDialog.querySelector('[data-document-action="cancel"]').onclick=()=>documentDialog.close();
documentDialog.querySelector('input').oninput=event=>event.target.setCustomValidity('');
documentDialog.querySelector('form').onsubmit=event=>{event.preventDefault();const input=documentDialog.querySelector('input'),name=input.value.trim();if(!name){input.setCustomValidity(t('請輸入時間軸檔案名稱','Enter a roadmap file name'));input.reportValidity();return;}documentDialog.close();if(documentDialogMode==='rename')void operateDocument('rename',{name});else void changeDocument({model:{title:name,projects:[],locks:{title:true}},name});};
const documentMenu=document.createElement('div');documentMenu.id='document-menu';documentMenu.className='document-menu';documentMenu.hidden=true;documentMenu.setAttribute('role','menu');documentMenu.setAttribute('aria-label',t('時間軸檔案操作','Roadmap file actions'));
documentMenu.innerHTML=`<button role="menuitem" data-document-action="rename">${t('重新命名','Rename')}</button><button role="menuitem" data-document-action="delete" class="danger">${t('刪除','Delete')}</button><button role="menuitem" data-document-action="trash">${t('回收區','Trash')}</button>`;document.body.append(documentMenu);
const deleteDialog=document.createElement('dialog');deleteDialog.id='document-delete-dialog';deleteDialog.className='document-dialog';deleteDialog.setAttribute('aria-labelledby','document-delete-title');deleteDialog.innerHTML=`<form method="dialog"><h2 id="document-delete-title">${t('刪除時間軸檔案','Delete roadmap file')}</h2><p class="document-delete-name"></p><p>${t('檔案將移入回收區。','The file will move to Trash.')}</p><div class="document-dialog-actions"><button type="button" data-document-action="cancel-delete">${t('取消','Cancel')}</button><button type="submit" class="danger">${t('刪除','Delete')}</button></div></form>`;document.body.append(deleteDialog);
deleteDialog.querySelector('[data-document-action="cancel-delete"]').onclick=()=>deleteDialog.close();deleteDialog.querySelector('form').onsubmit=event=>{event.preventDefault();const id=deleteDocumentId;deleteDialog.close();void operateDocument('remove',{id});};
const trashDialog=document.createElement('dialog');trashDialog.id='document-trash-dialog';trashDialog.className='document-dialog';trashDialog.setAttribute('aria-labelledby','document-trash-title');trashDialog.innerHTML=`<h2 id="document-trash-title">${t('回收區','Trash')}</h2><div class="document-trash-list"></div><div class="document-dialog-actions"><button data-document-action="close-trash">${t('關閉','Close')}</button></div>`;document.body.append(trashDialog);
trashDialog.querySelector('[data-document-action="close-trash"]').onclick=()=>trashDialog.close();trashDialog.addEventListener('click',event=>{const id=event.target.closest('[data-document-restore]')?.dataset.documentRestore;if(id){trashDialog.close();void operateDocument('restore',{id});}});
function hideDocumentMenu(focus=false){documentMenu.hidden=true;const trigger=app.querySelector('[data-action="document-menu"]');trigger?.setAttribute('aria-expanded','false');if(focus)trigger?.focus();}
function sizeDocumentDialog(dialog){dialog.style.fontSize=({small:'13.6px',medium:'16px',large:'18.4px'})[uiSize];}
function showDocumentDialog(mode){documentDialogMode=mode;sizeDocumentDialog(documentDialog);documentDialog.querySelector('h2').textContent=mode==='rename'?t('重新命名時間軸檔案','Rename roadmap file'):t('新增時間軸檔案','New roadmap file');documentDialog.querySelector('button[type="submit"]').textContent=mode==='rename'?t('儲存','Save'):t('建立','Create');const input=documentDialog.querySelector('input');input.value=mode==='rename'?files.active.name:t('新時間軸','New roadmap');input.setCustomValidity('');documentDialog.showModal();input.focus();input.select();}
function showDocumentMenu(){
 if(!documentMenu.hidden){hideDocumentMenu();return;}
 const trigger=app.querySelector('[data-action="document-menu"]');documentMenu.style.fontSize=({small:'13.6px',medium:'16px',large:'18.4px'})[uiSize];documentMenu.querySelector('[data-document-action="trash"]').disabled=!files.trash().length;documentMenu.hidden=false;trigger.setAttribute('aria-expanded','true');
 const rect=trigger.getBoundingClientRect();documentMenu.style.left=Math.max(8,Math.min(innerWidth-documentMenu.offsetWidth-8,rect.right-documentMenu.offsetWidth))+'px';documentMenu.style.top=Math.max(8,Math.min(innerHeight-documentMenu.offsetHeight-8,rect.bottom+5))+'px';documentMenu.querySelector('button').focus();
}
documentMenu.onclick=event=>{const command=event.target.closest('[data-document-action]')?.dataset.documentAction;if(!command)return;hideDocumentMenu();if(command==='rename')showDocumentDialog('rename');else if(command==='delete'){deleteDocumentId=files.activeId;sizeDocumentDialog(deleteDialog);deleteDialog.querySelector('.document-delete-name').textContent=files.active.name;deleteDialog.showModal();deleteDialog.querySelector('[data-document-action="cancel-delete"]').focus();}else if(command==='trash'){sizeDocumentDialog(trashDialog);trashDialog.querySelector('.document-trash-list').innerHTML=files.trash().map(file=>`<div class="document-trash-item"><span>${esc(file.name)}</span><button data-document-restore="${file.id}">${t('還原','Restore')}</button></div>`).join('');trashDialog.showModal();}};
function refreshDocumentChrome(){
 documentDialog.querySelector('label').textContent=t('名稱','Name');
 documentDialog.querySelector('[data-document-action="cancel"]').textContent=t('取消','Cancel');
 documentMenu.setAttribute('aria-label',t('時間軸檔案操作','Roadmap file actions'));
 for(const [action,zh,en] of [['rename','重新命名','Rename'],['delete','刪除','Delete'],['trash','回收區','Trash']])documentMenu.querySelector(`[data-document-action="${action}"]`).textContent=t(zh,en);
 deleteDialog.querySelector('h2').textContent=t('刪除時間軸檔案','Delete roadmap file');
 deleteDialog.querySelector('p:not(.document-delete-name)').textContent=t('檔案將移入回收區。','The file will move to Trash.');
 deleteDialog.querySelector('[data-document-action="cancel-delete"]').textContent=t('取消','Cancel');
 deleteDialog.querySelector('button[type="submit"]').textContent=t('刪除','Delete');
 trashDialog.querySelector('h2').textContent=t('回收區','Trash');
 trashDialog.querySelector('[data-document-action="close-trash"]').textContent=t('關閉','Close');
}
window.addEventListener('drag:localechange',refreshDocumentChrome);
document.addEventListener('click',event=>{if(!event.target.closest('#document-menu,[data-action="document-menu"]'))hideDocumentMenu();});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.global-actions'))hideGlobalMenu();});
window.addEventListener('resize',anchorInspector);
document.addEventListener('pointerdown',event=>{const range=app.querySelector('.range-options[open]');if(range&&!range.contains(event.target))range.open=false;});
document.addEventListener('keydown',event=>{const menu=app.querySelector('#global-action-menu');if(!menu||menu.hidden)return;if(event.key==='Escape'){event.preventDefault();hideGlobalMenu(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();}});
document.addEventListener('keydown',event=>{if(documentMenu.hidden)return;if(event.key==='Escape'){event.preventDefault();hideDocumentMenu(true);}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...documentMenu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}});
const systemTheme=matchMedia('(prefers-color-scheme: dark)');
function applyUISize(){
 app.dataset.uiSize=uiSize;
 document.documentElement.dataset.uiDensity=preferences.density;
 app.classList.toggle('sidebar-hidden',!preferences.sidebarVisible);
 document.documentElement.dataset.theme=preferences.theme==='system'?(systemTheme.matches?'dark':'light'):preferences.theme;
 document.documentElement.dataset.palette = preferences.palette;
 document.documentElement.dataset.typeface = preferences.typeface;
 document.documentElement.dataset.canvasSurface = preferences.canvasSurface;
 document.documentElement.dataset.reduceMotion=String(preferences.reduceMotion);
 const dialog=document.querySelector('#settings-dialog');if(dialog)dialog.style.setProperty('--settings-font',({small:'13.6px',medium:'16px',large:'18.4px'})[uiSize]);
 for(const button of document.querySelectorAll('button[data-ui-size]'))button.setAttribute('aria-pressed',String(button.dataset.uiSize===uiSize));
 sidebarPanel?.layout();
}
systemTheme.addEventListener('change',()=>applyUISize());
let workspaceWarning=false;
function rememberWorkspace(){
 if(filesBusy)return;
 try{
 if(preferences.startupMode!=='last'&&!preferences.rememberPictures)return;
 if(gantt&&mode==='timeline')timelinePosition={day:gantt.visibleDay(),top:app.querySelector('.preview').scrollTop};
 const workspace={mode,view,timeline:timelinePosition,pictures:pictureViews,fitContent:timelineFitEnabled};
 localStorage.setItem('drag.workspace',JSON.stringify(workspace));
 files.saveView(workspace);
 }catch(error){if(!workspaceWarning){workspaceWarning=true;alert(t('無法儲存檢視設定：','Could not save view settings: ')+error.message);}}
}
function rememberTimelineFit(){
 try{const workspace={...(files.active.workspace||{}),fitContent:timelineFitEnabled};files.saveView(workspace);localStorage.setItem('drag.workspace',JSON.stringify({...savedWorkspace,...workspace}));}
 catch(error){if(!workspaceWarning){workspaceWarning=true;alert(t('無法儲存檢視設定：','Could not save view settings: ')+error.message);}}
}
async function changePreferences(key,value){
 const next=normalizePreferences({...preferences,[key]:value},true),before=preferences;
 if(window.dragDesktop)await window.dragDesktop.configure({rememberSaveDirectory:next.rememberSaveDirectory,shortcuts:next.shortcuts,language:next.language});
 preferences=next;uiSize=next.uiSize;storePreferences(localStorage,preferences);setLocale(next.language);
 if(before.language!==next.language)render(true);else applyUISize();
 const timelineChanged=['view','snap','leftMonths','rightMonths','autoPan'].some(k=>before[k]!==next[k]);
 if(timelineChanged){if(before.view!==next.view)view=next.view;snap=next.snap;leftPaddingMonths=next.leftMonths;rightPaddingMonths=next.rightMonths;if(mode==='timeline')renderGantt(true);}
 rememberWorkspace();backups.stage(model,preferences);updateControls();
}
async function resetCategory(category){
 const before=preferences;let next={...preferences};for(const key of GROUPS[category]||[])next[key]=deep(DEFAULTS[key]);
 // Validate the whole category before applying it, including shortcut conflicts.
 next=normalizePreferences(next,true);
 if(window.dragDesktop)await window.dragDesktop.configure({rememberSaveDirectory:next.rememberSaveDirectory,shortcuts:next.shortcuts,language:next.language});
 preferences=next;uiSize=next.uiSize;storePreferences(localStorage,next);if(category==='editing'){view=next.view;snap=next.snap;leftPaddingMonths=next.leftMonths;rightPaddingMonths=next.rightMonths;}
 setLocale(next.language);if(before.language!==next.language)render(true);else applyUISize();if(category==='editing'&&mode==='timeline')renderGantt(true);rememberWorkspace();backups.stage(model,preferences);updateControls();
}
async function workspaceAction(command){
 preferences.sidebarVisible=true;storePreferences(localStorage,preferences);
 if(command==='reset-layout'){inspectorWidth=300;localStorage.setItem('drag.inspectorWidth','300');sidebarState={mode:'docked',dockWidth:224,float:{x:24,y:24,width:224,height:480}};paneHeight=68;localStorage.setItem('drag.paneHeight','68');}
 else{sidebarState.mode=command==='dock'?'docked':'floating';}
 localStorage.setItem('drag.sidebar',JSON.stringify(sidebarState));render(true);
}

function fileView(){
 pictureViewport?.remember();
 if(gantt&&mode==='timeline')timelinePosition={day:gantt.visibleDay(),top:app.querySelector('.preview').scrollTop};
 return{mode,view,timeline:deep(timelinePosition),pictures:deep(pictureViews),fitContent:timelineFitEnabled,selected:deep(selected),treeTop:app.querySelector('aside')?.scrollTop||0,editorTop:app.querySelector('#editor')?.scrollTop||0,history,redo};
}
function loadFileView(id){
 inspectorCollapsed=true;explicitOutlineSelection=false;collapsedProjects.clear();
 const stored=files.active.workspace||{};
 const state=fileStates.get(id)||{...(preferences.startupMode==='last'?{mode:stored.mode,view:stored.view,timeline:stored.timeline}:{}),...(preferences.rememberPictures?{pictures:stored.pictures}:{}),fitContent:stored.fitContent};
 model=files.model;history=state.history||[];redo=state.redo||[];selected=state.selected||{project:0,phase:0};
 mode=normalizeViewMode(state.mode);view=['Day','Week','Month','Quarter','Year'].includes(state.view)?state.view:preferences.view;timelinePosition=Number.isFinite(state.timeline?.day)&&Math.abs(state.timeline.day)<5000000?{day:state.timeline.day,top:Math.max(0,Number(state.timeline.top)||0)}:null;
 timelineFitEnabled=!!state.fitContent;
 for(const key of ['simple','infographic']){const value=state.pictures?.[key];pictureViews[key]=value&&Number.isFinite(value.zoom)&&Number.isFinite(value.center?.x)&&Number.isFinite(value.center?.y)?{zoom:Math.max(.001,Math.min(8,value.zoom)),center:{x:Math.max(-1000,Math.min(1000,value.center.x)),y:Math.max(-1000,Math.min(1000,value.center.y))}}:{zoom:1,center:{x:.5,y:.5}};}
 render();app.querySelector('aside').scrollTop=state.treeTop||0;app.querySelector('#editor').scrollTop=state.editorTop||0;
}
async function changeDocument({id,model:next,name}){
 if(filesBusy||id===files.activeId)return;
 filesBusy=true;app.inert=true;
 const oldId=files.activeId;fileStates.set(oldId,fileView());
 try{
  if(preferences.startupMode==='last'||preferences.rememberPictures){const state=fileStates.get(oldId);files.saveView({mode:state.mode,view:state.view,timeline:state.timeline,pictures:state.pictures});}
  await files.flush();await backups.flush();
  if(next)id=await files.create(next,name);else await files.activate(id);
  await backups.setDocument(id,id===files.originalId);
  loadFileView(id);backups.stage(model,preferences);
 }catch(error){
  loadFileView(files.activeId);alert(t('無法開啟時間軸檔案：','Could not open roadmap file: ')+error.message);
 }finally{filesBusy=false;app.inert=false;}
}

async function operateDocument(operation,value){
 if(filesBusy)return;filesBusy=true;app.inert=true;
 const oldId=files.activeId;fileStates.set(oldId,fileView());
 try{
  if(preferences.startupMode==='last'||preferences.rememberPictures){const state=fileStates.get(oldId);files.saveView({mode:state.mode,view:state.view,timeline:state.timeline,pictures:state.pictures});}
  await files.flush();await backups.flush();
  if(operation==='rename')await files.rename(oldId,value.name);else if(operation==='remove')await files.remove(value.id);else await files.restore(value.id);
  await backups.setDocument(files.activeId,files.activeId===files.originalId);loadFileView(files.activeId);backups.stage(model,preferences);
 }catch(error){loadFileView(files.activeId);alert(t('檔案操作失敗：','File operation failed: ')+error.message);}finally{filesBusy=false;app.inert=false;}
}

const colorHex=(h)=>/^#[0-9a-f]{6}$/i.test(h)?h:'#64748b';
function normalize(){model.projects??=[];for(const p of model.projects){p.id??=uid();p.color??='#64748b';p.phases??=[];p.locks??={};for(const f of p.phases){f.id??=uid();f.locks??={};}}}
normalize();
function snapshot(){history.push(deep(model));if(history.length>100)history.shift();redo=[];}
function persist(){files.save(model);backups.stage(model,preferences);}
function mutate(fn,{reveal=false}={}){if(filesBusy)return;const before=deep(model),selection=deep(selected),previousRedo=redo;snapshot();try{fn();persist();}catch(error){model=before;selected=selection;history.pop();redo=previousRedo;alert(t('無法儲存變更：','Could not save changes: ')+error.message);}render(true);if(reveal)revealSelection();}
function normalizeSelection(){
selected.project=Math.max(0,Math.min(selected.project,model.projects.length-1));
const p=model.projects[selected.project];
if(!p||selected.phase!==null&&!p.phases[selected.phase])selected.phase=null;
if(!p){explicitOutlineSelection=false;inspectorCollapsed=true;}
}
function revealSelection(){
const aside=app.querySelector('aside'),item=aside.querySelector('.tree-item.selected');
if(item){const a=aside.getBoundingClientRect(),b=item.getBoundingClientRect(),top=a.top+aside.querySelector('.sidebar-top').offsetHeight+8;if(b.top<top)aside.scrollTop+=b.top-top;else if(b.bottom>a.bottom-8)aside.scrollTop+=b.bottom-a.bottom+8;}
app.querySelector('#editor').scrollTop=0;
}
function updateControls(){
const viewControl=app.querySelector('#view'),snapControl=app.querySelector('#snap');if(viewControl)viewControl.value=view;if(snapControl)snapControl.value=snap;
const preview=app.querySelector('.preview');if(!preview)return;
const timelineReady=mode==='timeline'&&!!gantt&&!!app.querySelector('#gantt svg');
const outputReady=mode==='timeline'?timelineReady:!!app.querySelector('.infographic-preview svg');
const set=(action,disabled)=>{for(const button of app.querySelectorAll(`[data-action="${action}"]`))button.disabled=disabled;};
set('undo',!history.length);
set('redo',!redo.length);
set('prev',!timelineReady||preview.scrollLeft<=1);
set('next',!timelineReady||preview.scrollLeft>=preview.scrollWidth-preview.clientWidth-1);
set('today',!timelineReady);
for(const side of ['left','right']){const n=side==='left'?leftPaddingMonths:rightPaddingMonths;set(`expand-${side}`,!timelineReady||n>=120);set(`shrink-${side}`,!timelineReady||n<=1);}
for(const action of ['svg','png','gif'])set(action,!outputReady||Boolean(exporting));
const exportStatus=app.querySelector('.image-export-status');
exportStatus.textContent=exporting==='gif'?t('正在製作 GIF…','Creating GIF…'):'';
const pngLabel=mode==='timeline'?t('匯出 PNG','Export PNG'):`${t('匯出 PNG','Export PNG')} · ${{fullhd:'Full HD','2k':'2K','4k':'4K'}[preferences.pictureSize]}`;
const pngButton=app.querySelector('[data-action="png"]');pngButton.setAttribute('aria-label',pngLabel);pngButton.querySelector('span').textContent=pngLabel;
app.querySelector('[data-action="fit-content"]')?.setAttribute('aria-pressed',String(timelineFitEnabled));
for(const button of app.querySelectorAll('.tabs button'))button.setAttribute('aria-pressed',String(button.dataset.action===mode));
}
async function exportImage(format){
if(exporting)return;
const source=app.querySelector(mode==='timeline'?'#gantt svg':'.infographic-preview svg');
if(!source){alert(t('目前沒有可匯出的圖表，請先新增任務或修正圖片設定。','There is no chart to export. Add a task or fix the image settings.'));return;}
exporting=format;updateControls();
try{const options={...preferences,filename:imageFilename(preferences,model.title,mode,format)};if(mode==='timeline')await exportTimeline(app.querySelector('#gantt'),format,model.title,options);else await exportInfographicImage(source,format,options);}
catch(error){alert(t('匯出失敗：','Export failed: ')+error.message);}
finally{exporting=false;updateControls();}
}
function goToday(){
if(!gantt)return;
const today=fmt(new Date()),range=bounds(),x=gantt.dateToX(today),width=gantt.chart.$svg.width.baseVal.value;
const monthGap=(a,b)=>(day(b).getFullYear()-day(a).getFullYear())*12+day(b).getMonth()-day(a).getMonth();
let left=leftPaddingMonths,right=rightPaddingMonths;
if(x<0)left=Math.max(left,monthGap(today,range.start)+2);
if(x>width)right=Math.max(right,monthGap(range.end,today)+2);
if(left>120||right>120){alert(t('今天超出可延伸的 120 個月範圍，無法定位；任務日期保持原樣。','Today is beyond the extendable 120-month range. Task dates were not changed.'));return;}
if(left!==leftPaddingMonths||right!==rightPaddingMonths){if(!allowTimelineRange(left,right))return;leftPaddingMonths=left;rightPaddingMonths=right;persistTimeline();renderGantt(true);if(!gantt)return;}
const preview=app.querySelector('.preview'),svg=gantt.chart.$svg,offset=svg.getBoundingClientRect().left-preview.getBoundingClientRect().left+preview.scrollLeft;
gantt.scrollTo(Math.max(0,offset+gantt.dateToX(today)-preview.clientWidth/2));
updateControls();
}
function saveFile(name,body,type){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([body],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function exportJson(){saveFile(documentFilename(files.active.name),JSON.stringify(model,null,2),'application/json');}
function moveOutlineItem(from,to,edge){
 const move=outlineMove(model.projects,from,to,edge);
 if(!move)return;
 explicitOutlineSelection=true;
 collapsedProjects.delete(model.projects[to.project].id);
 mutate(()=>{selected=move();},{reveal:true});
}
function moveMobileItem(project, phase, delta){
 const from={project,phase}, next=phase===null?project+delta:phase+delta;
 const siblings=phase===null?model.projects:model.projects[project].phases;
 if(next>=0 && next<siblings.length){
  const to=phase===null?{project:next,phase:null}:{project,phase:next};
  moveOutlineItem(from,to,delta<0?'before':'after');
  return;
 }
 const neighbor=project+delta;
 if(phase===null || !model.projects[neighbor])return;
 const beforeFirst=delta>0 && model.projects[neighbor].phases.length>0;
 moveOutlineItem(from,{project:neighbor,phase:beforeFirst?0:null},beforeFirst?'before':'inside');
}
function addMobileSortControls(){
 const tree=app.querySelector('#tree');
 for(const item of tree.querySelectorAll('.tree-item')){
  const pi=Number(item.closest('.project').dataset.p),fi=item.dataset.f===undefined?null:Number(item.dataset.f),last=fi===null?model.projects.length-1:model.projects[pi].phases.length-1;
  const controls=document.createElement('span');controls.className='mobile-sort';
  for(const [delta,symbol,label] of [[-1,'↑',t('上移','Move up')],[1,'↓',t('下移','Move down')]]){
   const button=document.createElement('button');button.type='button';button.textContent=symbol;const name=fi===null?model.projects[pi].name:model.projects[pi].phases[fi].label;button.setAttribute('aria-label',getLocale()==='en'?`${label} ${fi===null?'project':'task'} ${name}`:`${label}${fi===null?'專案':'任務'} ${name}`);
   button.disabled=fi===null?(delta<0?pi===0:pi===last):(delta<0?fi===0&&pi===0:fi===last&&pi===model.projects.length-1);
   button.onclick=event=>{event.stopPropagation();moveMobileItem(pi,fi,delta);};controls.append(button);
  }
  item.append(controls);
 }
}
function taskList(){const out=[];model.projects.forEach((p,pi)=>p.phases.forEach((f,fi)=>{
  if(!/^\d{4}-\d\d-\d\d$/.test(f.start)||!/^\d{4}-\d\d-\d\d$/.test(f.end))return;
  const progress = taskProgress(f.progress);
  const status = typeof f.status === 'string' ? f.status.trim() : '';
  const title = [f.icon, f.label].filter(Boolean).join(' ');
  const caption = [title, progress === null ? '' : `${progress}%`].filter(Boolean).join(' · ');
  out.push({id:`bar-${pi}-${fi}`,_modelId:f.id,name:esc(caption),status,start:f.start,end:f.end,
    progress, hasProgress:progress!==null, custom_class:`project-${pi}`,color:colorHex(p.color),
    light:!!f.light,fontSize:f.fontSize,_pi:pi,_fi:fi});
}));return out}
function fittingTimelineView(tasks,width){
 if(!tasks.length)return view;
 const dates=tasks.flatMap(task=>[task.start,task.end]);
 const span=Math.max(1,ordinal(dates.reduce((a,b)=>a>b?a:b))-ordinal(dates.reduce((a,b)=>a<b?a:b))+1)+Math.max(0,leftPaddingMonths+rightPaddingMonths)*31;
 const modes=[['Day',1,38,1],['Week',7,80,7],['Month',30.4,100,31],['Quarter',91.25,130,92],['Year',365.25,130,366]];
 let best='Year';
 for(const [name,step,normalWidth,maximumDays] of modes){
  const snapDays=snap==='auto'?{Day:1,Week:1,Month:7,Quarter:7,Year:30}[name]:Number.parseInt(snap);
  const column=Math.max(normalWidth,Math.ceil(maximumDays*2/snapDays));
  if((Math.ceil(span/step)+3)*column<=Math.max(280,width-44)){best=name;break;}
 }
 return best;
}
function render(preserveScroll=false){
const panelScroll=['aside','#editor'].map(selector=>{const node=app.querySelector(selector);return node?{selector,top:node.scrollTop,left:node.scrollLeft}:null;}).filter(Boolean);
const preview=app.querySelector('.preview');
const floatingBox=sidebarState.mode==='floating'?app.querySelector('aside.is-floating')?.getBoundingClientRect():null;
sidebarPanel?.destroy();sidebarPanel=null;
timelineFitObserver?.disconnect();timelineFitObserver=null;
globalMenuPinned=false;
pictureViewport?.destroy();pictureViewport=null;
const pos=preserveScroll&&gantt?{day:gantt.visibleDay(),top:preview.scrollTop}:null;gantt?.destroy();gantt=null;normalize();normalizeSelection();const headerState=rememberHeader(app);
app.innerHTML=`${workspaceHeader({
 title:model.title||t('未命名時間軸','Untitled roadmap'), mode,view,snap,timelineFitEnabled,icon,esc
})}
<main data-inspector="${inspectorCollapsed?'closed':'open'}" style="--inspector-width:${inspectorWidth}px"><aside class="project-sidebar" aria-label="${t("任務結構","Task outline")}"><div class="sidebar-top"><div class="document-picker"><div><label for="document-select">${t("時間軸檔案","Roadmap files")}</label><button data-action="newdocument" class="icon-button" aria-label="${t("新增時間軸檔案","New roadmap file")}" title="${t("新增時間軸檔案","New roadmap file")}">${icon('plus')}<span class="visually-hidden">${t("新增時間軸檔案","New roadmap file")}</span></button><button data-action="document-menu" aria-label="${t("時間軸檔案操作","Roadmap file actions")}" title="${t("時間軸檔案操作","Roadmap file actions")}" aria-haspopup="menu" aria-controls="document-menu" aria-expanded="false">⋯</button></div><select id="document-select" aria-label="${t("時間軸檔案","Roadmap files")}">${files.list().map(file=>`<option value="${file.id}" ${file.id===files.activeId?'selected':''}>${esc(file.name)}</option>`).join('')}</select></div><div class="aside-title"><span class="sidebar-heading">${t("任務結構","Task outline")}</span><button data-action="newproject" class="icon-button" aria-label="${t("新增專案","New project")}" title="${t("新增專案","New project")}">${icon('plus')}<span class="visually-hidden">${t("新增專案","New project")}</span></button><button data-sidebar-action="dock">${t("停靠左側","Dock left")}</button></div></div><div id="tree" role="tree" aria-label="${t('任務結構','Task outline')}">${outlineMarkup(model.projects,explicitOutlineSelection?selected:null,collapsedProjects,esc)}</div><div class="sidebar-corner-resizer" role="separator" tabindex="0" aria-label="${t("調整面板大小","Resize panel")}"></div></aside><div class="sidebar-resizer" role="separator" aria-orientation="vertical" tabindex="0" aria-label="${t("調整側欄寬度","Resize sidebar")}"></div><section class="preview${mode==='timeline'?'':' is-picture'}"><div id="gantt" ${mode!=='timeline'?'hidden':''}></div><section id="infographic-panel" ${mode==='timeline'?'hidden':''}></section></section><div class="split" id="split" role="separator" tabindex="0" aria-label="${t("調整屬性面板大小","Resize properties panel")}" ${inspectorCollapsed?'hidden':''}></div>
<section class="bottom" ${inspectorCollapsed?'hidden':''}>
<article id="editor"></article></section></main><input id="import" type="file" accept=".json,application/json" hidden/>`;
renderEditor();if(mode==='timeline')renderGantt(false,pos||timelinePosition);else renderReport();
restoreHeader(app,headerState);
for(const position of panelScroll){const node=app.querySelector(position.selector);if(node){node.scrollTop=position.top;node.scrollLeft=position.left;}}
applyUISize();wire();if(mobileLayout.matches){app.querySelectorAll('#tree [draggable]').forEach(node=>{node.draggable=false;});addMobileSortControls();}
if(!mobileLayout.matches)sidebarPanel=new SidebarPanel(app.querySelector('main'),sidebarState,state=>localStorage.setItem('drag.sidebar',JSON.stringify(state)));applyUISize();if(sidebarPanel&&floatingBox&&sidebarState.mode==='floating'){
 const difference=floatingBox.top-app.querySelector('aside').getBoundingClientRect().top;
 if(Math.abs(difference)>.5){sidebarState.float.y+=difference;sidebarPanel.layout();localStorage.setItem('drag.sidebar',JSON.stringify(sidebarState));}
}if(mode==='timeline'){
 let lastWidth=app.querySelector('.preview').getBoundingClientRect().width;
 timelineFitObserver=new ResizeObserver(()=>{const width=app.querySelector('.preview')?.getBoundingClientRect().width||0;if(!timelineFitEnabled||!gantt||Math.abs(width-lastWidth)<8)return;lastWidth=width;if(fittingTimelineView(taskList(),width)!==view)renderGantt(true);});
 timelineFitObserver.observe(app.querySelector('.preview'));
}anchorInspector();updateControls();rememberWorkspace();}
function focusOutlineSelection(){
 let row=app.querySelector('.tree-item.selected')||app.querySelector('.tree-item[tabindex="0"]');
 if(row?.closest('[hidden]'))row=row.closest('.project').querySelector('[data-select-p]');
 row?.focus({preventScroll:true});
}
function displayInspector(open){
 inspectorCollapsed=!open;
 app.querySelector('main').dataset.inspector=open?'open':'closed';
 app.querySelector('.bottom').hidden=!open;
 app.querySelector('#split').hidden=!open;
 anchorInspector();
}
function anchorInspector(){
 if(inspectorCollapsed)return;
 const main=app.querySelector('main'),row=app.querySelector('.tree-item.selected');
 if(main&&row)main.style.setProperty('--selected-row-y',`${row.getBoundingClientRect().top-main.getBoundingClientRect().top}px`);
}
function selectItem(project,phase,fromOutline=false){
 if(fromOutline)explicitOutlineSelection=true;
selected={project,phase};
app.querySelectorAll('.tree-item').forEach(el=>{
 const active=phase===null?el.dataset.selectP===String(project):el.dataset.selectF===`${project}:${phase}`;
 el.classList.toggle('selected',active);
 el.setAttribute('aria-selected',String(active));
 if(explicitOutlineSelection){
  const folded=el.dataset.selectP===String(project)&&el.getAttribute('aria-expanded')==='false';
  el.tabIndex=(active&&!el.closest('[hidden]')||folded)?0:-1;
 }
});
if(fromOutline)displayInspector(true);
else anchorInspector();
const editor=app.querySelector('#editor'),top=editor.scrollTop,left=editor.scrollLeft;
renderEditor();editor.scrollTop=top;editor.scrollLeft=left;
}
let iconExpanded=false;
const iconChoices=()=>[['★',t('星星','Star')],['🏆',t('獎盃','Trophy')],['⚙',t('齒輪','Gear')],['▣',t('螢幕','Screen')],['🛡',t('盾牌','Shield')],['👥',t('團隊','Team')],['🔗',t('連結','Link')],['🔍',t('搜尋','Search')],['✓',t('勾選','Check')],['⚑',t('旗幟','Flag')],['◆',t('菱形','Diamond')],['●',t('圓點','Dot')],['✦',t('閃光','Sparkle')],['💡',t('燈泡','Light bulb')],['📌',t('圖釘','Pin')],['🚀',t('火箭','Rocket')]];
function taskTrackingFields(task) {
 const suggestions = [t('未開始', 'Not started'), t('進行中', 'In progress'), t('受阻', 'Blocked'), t('已完成', 'Completed')];
 const status = typeof task.status === 'string' ? task.status : '';
 return `<label>${t('階段狀態', 'Phase status')}<div class="field"><input type="text" data-field="status" list="phase-status-options" value="${esc(status)}" placeholder="${t('選擇或輸入狀態', 'Choose or enter a status')}"/></div></label>
   <datalist id="phase-status-options">${suggestions.map(value => `<option value="${value}"></option>`).join('')}</datalist>
   <label>${t('完成百分比（%）', 'Completion (%)')}<div class="field"><input type="number" data-field="progress" min="0" max="100" step="any" value="${taskProgress(task.progress) ?? ''}" placeholder="${t('未回報', 'Not reported')}"/></div></label>`;
}
function projectProgressMarkup(project) {
 let reported = 0, total = 0;
 for (const task of project.phases) {
  const value = taskProgress(task.progress);
  if (value === null) continue;
  reported++;
  total += value;
 }
 if (!reported) return '';
 const mean = total / reported;
 const percent = mean.toLocaleString(getLocale(), { maximumFractionDigits: 2 }) + '%';
 const coverage = t(`已回報 ${reported}/${project.phases.length} 項任務`, `${reported}/${project.phases.length} tasks reported`);
 return `<div class="project-progress-summary">
   <span id="project-progress-label">${t('已回報任務的平均完成率', 'Average of reported tasks')}</span><strong aria-hidden="true">${percent}</strong>
   <progress aria-labelledby="project-progress-label" aria-describedby="project-progress-coverage" max="100" value="${mean}">${percent}</progress>
   <small id="project-progress-coverage">${coverage}</small>
 </div>`;
}
function renderEditor(){
const panel=document.querySelector('#editor'),p=model.projects[selected.project];
if(!p){panel.innerHTML='';return;}
const f=selected.phase===null?null:p.phases[selected.phase],target=f||p;
const fields=f?[['label',t('任務名稱','Task name'),'text'],['start',t('開始日期','Start date'),'date'],['end',t('結束日期','End date'),'date'],['milestone',t('里程碑文字','Milestone text'),'text'],['milestoneDate',t('里程碑日期（可留白）','Milestone date (optional)'),'date']]:[['name',t('專案名稱','Project name'),'text'],['color',t('專案配色','Project color'),'color']];
const selectedIcon=String(target.icon??(f?'':'▣'));
const fieldMarkup=keys=>fields.filter(([key])=>keys.includes(key)).map(([key,label,type])=>`<label>${label}<div class="field"><input data-field="${key}" type="${type}" value="${esc(target[key]??(type==='color'?'#64748b':''))}"/></div></label>`).join('');
const iconMarkup=`<div class="icon-field"><label for="editor-icon">${t("圖示","Icon")}</label><div class="icon-input"><span class="icon-preview" aria-hidden="true">${esc(selectedIcon||t('無','None'))}</span><input id="editor-icon" data-field="icon" aria-label="${t("自訂圖示","Custom icon")}" type="text" value="${esc(target.icon??'')}"/></div><details class="icon-picker" ${iconExpanded?'open':''}><summary>${t("選擇圖示","Choose icon")}</summary><div class="icon-options" role="group" aria-label="${t("常用圖示","Common icons")}">${[['',t('無圖示','No icon')],...iconChoices()].map(([value,label])=>`<button type="button" data-icon="${esc(value)}" aria-label="${label}" aria-pressed="${selectedIcon===value}"><span aria-hidden="true">${esc(value||t('無','None'))}</span></button>`).join('')}</div></details></div>`;
const section=(key,title,content)=>`<details class="editor-section" data-editor-section="${key}" ${editorSections[key]?'open':''}><summary>${title}</summary><div class="form">${content}</div></details>`;
const fontMarkup=`<label>${f?t('字體大小','Font size'):t('專案字體大小','Project font size')} (px)<input data-field="fontSize" type="number" min="8" max="160" placeholder="${t("自動","Auto")}" value="${esc(target.fontSize??'')}"/></label>`;
const parentField=f?`<label>${t('所屬專案','Parent project')}<select data-outline-parent>${model.projects.map((project,index)=>`<option value="${index}" ${project===p?'selected':''}>${esc(project.name)}</option>`).join('')}</select></label>`:'';
const basic=f?fieldMarkup(['label'])+parentField+taskTrackingFields(f):fieldMarkup(['name'])+projectProgressMarkup(p);
const schedule=f?`${fieldMarkup(['start','end','milestone','milestoneDate'])}<label>${t("結束未定","End date TBD")}<input data-check="open_end" type="checkbox" ${f.open_end?'checked':''}/></label><div class="date-nudge"><div><button data-nudge="start:-1">${t("開始 −1 日","Start −1 day")}</button><button data-nudge="start:1">${t("開始 +1 日","Start +1 day")}</button><button data-nudge="end:-1">${t("結束 −1 日","End −1 day")}</button><button data-nudge="end:1">${t("結束 +1 日","End +1 day")}</button></div></div>`:`${fieldMarkup(['color'])}${iconMarkup}`;
const appearance=f?`${iconMarkup}<label>${t("淡色階段","Muted task")}<input data-check="light" type="checkbox" ${f.light?'checked':''}/></label>${fontMarkup}`:fontMarkup;
panel.innerHTML=`<div class="editor-title"><button type="button" class="outline-close" data-outline-close aria-label="${t('關閉屬性','Close properties')}" title="${t('關閉屬性','Close properties')}">×</button><h2>${f?t('任務屬性','Task properties'):t('專案屬性','Project properties')}</h2><span class="editor-selection">${esc(f?f.label:p.name)}</span><div><button type="button" data-editor-collapse>${Object.values(editorSections).some(Boolean)?t('收合欄位','Collapse fields'):t('展開欄位','Expand fields')}</button><button data-action="newphase" class="icon-button" aria-label="${t("新增任務","New task")}" title="${t("新增任務","New task")}">${icon('plus')}<span class="visually-hidden">${t("新增任務","New task")}</span></button><button data-action="delete" class="danger">${f?t('刪除任務','Delete task'):t('刪除專案','Delete project')}</button></div></div><div class="editor-sections">${section('basic',t('基本資料','Basics'),basic)}${section('schedule',f?t('日期與里程碑','Dates & milestones'):t('配色與圖示','Color & icon'),schedule)}${section('appearance',f?t('外觀與顯示','Appearance & display'):t('字體','Font'),appearance)}</div>`;
panel.querySelector('[data-outline-close]').onclick=()=>{displayInspector(false);focusOutlineSelection();};
const parentSelect=panel.querySelector('[data-outline-parent]');
if(parentSelect)parentSelect.onchange=()=>moveOutlineItem(selected,{project:Number(parentSelect.value),phase:null},'inside');
panel.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>action(button.dataset.action));
panel.querySelectorAll('[data-editor-section]').forEach(group=>group.ontoggle=()=>{editorSections[group.dataset.editorSection]=group.open;panel.querySelector('[data-editor-collapse]').textContent=Object.values(editorSections).some(Boolean)?t('收合欄位','Collapse fields'):t('展開欄位','Expand fields');});
panel.querySelector('[data-editor-collapse]').onclick=()=>{const open=!Object.values(editorSections).some(Boolean);for(const group of panel.querySelectorAll('[data-editor-section]')){group.open=open;editorSections[group.dataset.editorSection]=open;}panel.querySelector('[data-editor-collapse]').textContent=open?t('收合欄位','Collapse fields'):t('展開欄位','Expand fields');};
panel.querySelector('.icon-picker summary').onclick=()=>{iconExpanded=!panel.querySelector('.icon-picker').open;};
const setIcon=value=>{if(target.icon===value&&target.locks?.icon)return;mutate(()=>{target.icon=value;target.locks??={};target.locks.icon=true;});};
panel.querySelectorAll('[data-icon]').forEach(button=>button.onclick=()=>setIcon(button.dataset.icon));
panel.querySelector('[data-field="icon"]').oninput=e=>{panel.querySelector('.icon-preview').textContent=e.target.value||t('無','None');};
for(const input of panel.querySelectorAll('[data-field]'))input.addEventListener('change',()=>{
const k=input.dataset.field,v=input.type==='number'?(k==='progress'&&input.value===''?'':Number(input.value)):input.value;
if(k==='icon'){setIcon(v);return;}
if(k==='fontSize'&&input.value===''){if(target.fontSize==null)return;mutate(()=>{delete target.fontSize;target.locks??={};target.locks.fontSize=true});return;}
if(k==='milestoneDate'&&v&&!isValidDate(v)){input.value=target[k]||'';alert(t('請輸入有效的里程碑日期','Enter a valid milestone date'));return;}
if(k==='progress'&&(input.validity.badInput||(v!==''&&taskProgress(v)===null))){input.value=taskProgress(target[k])??'';alert(t('進度請使用0至100%，未知可留白','Progress must be from 0 to 100%; leave blank if unknown'));return;}
if(k==='fontSize'&&(!Number.isFinite(v)||v<8||v>160)){input.value=target[k]??'';alert(t('字級請使用8至160 px','Font size must be 8 to 160 px'));return;}
if(f&&(k==='start'||k==='end')&&(!isValidDate(v)||(k==='start'?v>f.end:v<f.start))){input.value=target[k];alert(t('請輸入有效日期，且開始日期不得晚於結束日期','Enter valid dates; the start date cannot be after the end date'));return;}
mutate(()=>{target[k]=v;target.locks??={};target.locks[k]=true;});
});
panel.querySelectorAll('[data-nudge]').forEach(button=>{const [field,delta]=button.dataset.nudge.split(':'),next=addDays(f[field],Number(delta));button.disabled=field==='start'?next>f.end:next<f.start;button.onclick=()=>{if(button.disabled)return;mutate(()=>{f[field]=next;f.locks[field]=true;});};});
panel.querySelectorAll('[data-check]').forEach(input=>input.onchange=()=>mutate(()=>{const key=input.dataset.check;f[key]=input.checked;f.locks[key]=true;}));
}
function renderReport(){
pictureViewport?.destroy();pictureViewport=null;
const panel=document.querySelector('#infographic-panel'),settings=model.presentation||{};
panel.innerHTML=`<div class="report-controls"><label>${t("圖片標題","Image title")}<input id="report-title" value="${esc(settings.title||model.title||t('專案時程規劃','Project roadmap'))}"/></label><label>${t("顯示開始","Display start")}<input id="report-start" type="date" value="${esc(settings.start||'')}"/></label><label>${t("顯示結束","Display end")}<input id="report-end" type="date" value="${esc(settings.end||'')}"/></label><label>${t("里程碑","Milestone")}<select id="report-shape"><option value="circle" ${settings.milestoneShape!=='star'?'selected':''}>${t("圓點","Circle")}</option><option value="star" ${settings.milestoneShape==='star'?'selected':''}>${t("星形","Star")}</option></select></label><details class="align-start" name="picture-display-dates"><summary>${t("起始切齊","Align start")}</summary><div class="align-start-fields"><label>${t("顯示方式","Display mode")}<select id="align-mode"><option value="off" ${!settings.alignMode||settings.alignMode==='off'?'selected':''}>${t("不切齊","Off")}</option><option value="today" ${settings.alignMode==='today'?'selected':''}>${t("今天","Today")}</option><option value="date" ${settings.alignMode==='date'?'selected':''}>${t("指定日期","Chosen date")}</option></select></label><label>${t("切齊日期","Alignment date")}<input id="align-start-date" type="date" value="${esc(settings.alignDate||fmt(new Date()))}" ${settings.alignMode==='date'?'':'disabled'}/></label><button type="button" id="align-start-apply">${t("套用","Apply")}</button></div></details><details class="date-line" name="picture-display-dates"><summary>${t("日期線","Date line")}</summary><div class="align-start-fields"><label>${t("顯示方式","Display mode")}<select id="date-line-mode"><option value="off" ${settings.dateLineMode==='off'?'selected':''}>${t("關閉","Off")}</option><option value="today" ${!settings.dateLineMode||settings.dateLineMode==='today'?'selected':''}>${t("今天","Today")}</option><option value="custom" ${settings.dateLineMode==='custom'?'selected':''}>${t("自訂日期","Custom date")}</option></select></label><label>${t("日期","Date")}<input id="date-line-date" type="date" value="${esc(settings.dateLineDate||fmt(new Date()))}" ${settings.dateLineMode==='custom'?'':'disabled'}/></label><button type="button" id="date-line-apply">${t("套用","Apply")}</button></div></details></div><p class="report-message" role="status"></p><div class="picture-workspace"><div class="picture-viewport"><div class="picture-stage"><div class="infographic-preview picture-canvas"></div></div></div><div class="picture-tools" role="group" aria-label="${t("檢視操作","View controls")}"><div class="picture-zoom-controls"><button type="button" data-picture-action="zoom-out" aria-label="${t("縮小","Zoom out")}">−</button><input data-picture-zoom-slider type="range" min="0" max="1000" step="1" aria-label="${t("圖片縮放拉桿","Image zoom slider")}"/><button type="button" data-picture-action="zoom-in" aria-label="${t("放大","Zoom in")}">＋</button><button type="button" class="picture-zoom-trigger" data-picture-action="zoom-menu" aria-label="${t("選擇縮放比例","Choose zoom level")}" aria-haspopup="menu" aria-expanded="false"><output data-picture-zoom>100%</output><span aria-hidden="true">⌄</span></button></div><div class="picture-view-controls"><button type="button" data-picture-action="actual" class="icon-button" aria-label="${t("原尺寸","Actual size")}" title="${t("原尺寸","Actual size")}">${icon('actual')}<span class="visually-hidden">${t("原尺寸","Actual size")}</span></button><button type="button" data-picture-action="reset" class="icon-button" aria-label="${t("適合視窗","Fit window")}" title="${t("適合視窗","Fit window")}">${icon('fit')}<span class="visually-hidden">${t("適合視窗","Fit window")}</span></button><button type="button" data-picture-action="center" class="icon-button" aria-label="${t("置中","Center")}" title="${t("置中","Center")}">${icon('center')}<span class="visually-hidden">${t("置中","Center")}</span></button></div><div class="picture-zoom-menu" role="menu" aria-label="${t("縮放比例","Zoom levels")}" popover="auto">${PICTURE_ZOOM_LEVELS.map(level=>`<button type="button" role="menuitemradio" aria-checked="false" data-picture-zoom-level="${level}">${Math.round(level*100)}%</button>`).join('')}</div></div>`;
const controls=panel.querySelector('.report-controls');
app.querySelector('.picture-settings-slot').replaceChildren(controls);
const alignedStart=pictureAlignmentDate(settings),startControl=controls.querySelector('#report-start');
if(alignedStart){startControl.value=alignedStart;startControl.disabled=true;if(settings.end&&settings.end<alignedStart)controls.querySelector('#report-end').value='';}
try{const svg=renderSimple(model,{...settings,width:3840,height:2160});panel.querySelector('.infographic-preview').append(svg);pictureViewport=new PictureViewport(panel.querySelector('.picture-workspace'),pictureViews[mode]);}
catch(error){panel.querySelector('.report-message').textContent=t('圖片載入失敗：','Image failed to load: ')+error.message;panel.querySelectorAll('[data-picture-action],[data-picture-zoom-slider]').forEach(control=>control.disabled=true);console.error(error);}
const update=(key,value)=>{
if(key==='title'){if(!value.trim()){alert(t('請輸入圖片標題','Enter an image title'));renderReport();return;}if(value===(settings.title||model.title))return;mutate(()=>{model.presentation??={};model.presentation.title=value;model.presentation.locks??={};model.presentation.locks.title=true;});return;}
if(key==='start'||key==='end'){if(value&&!isValidDate(value)){alert(t('請輸入有效日期','Enter a valid date'));renderReport();return;}const next={...settings,[key]:value},effectiveStart=pictureAlignmentDate(next)||next.start;if(effectiveStart&&next.end&&effectiveStart>next.end){alert(t('顯示開始不得晚於顯示結束','Display start cannot be after display end'));renderReport();return;}}
if(value===(settings[key]||''))return;
mutate(()=>{model.presentation??={};model.presentation[key]=value;model.presentation.locks??={};model.presentation.locks[key]=true;});
};
controls.querySelector('#report-title').onchange=e=>update('title',e.target.value);
controls.querySelector('#report-start').onchange=e=>update('start',e.target.value);
controls.querySelector('#report-end').onchange=e=>update('end',e.target.value);
controls.querySelector('#report-shape').onchange=e=>update('milestoneShape',e.target.value);
const alignMode=controls.querySelector('#align-mode'),alignDate=controls.querySelector('#align-start-date');
alignMode.onchange=()=>{alignDate.disabled=alignMode.value!=='date';};
controls.querySelector('#align-start-apply').onclick=()=>{
  const nextMode=alignMode.value,nextDate=alignDate.value;
  if(nextMode==='date'&&!isValidDate(nextDate)){alert(t('請選擇有效的切齊日期','Choose a valid alignment date'));return;}
  if((settings.alignMode||'off')===nextMode&&(nextMode!=='date'||settings.alignDate===nextDate))return;
  mutate(()=>{model.presentation??={};model.presentation.alignMode=nextMode;if(nextMode==='date')model.presentation.alignDate=nextDate;model.presentation.locks??={};model.presentation.locks.alignMode=true;if(nextMode==='date')model.presentation.locks.alignDate=true;});
};
const lineMode=controls.querySelector('#date-line-mode'),lineDate=controls.querySelector('#date-line-date');
lineMode.onchange=()=>{lineDate.disabled=lineMode.value!=='custom';};
controls.querySelector('#date-line-apply').onclick=()=>{
  const nextMode=lineMode.value,nextDate=lineDate.value;
  if(nextMode==='custom'&&!isValidDate(nextDate)){alert(t('請選擇有效的日期線日期','Choose a valid date line date'));return;}
  if((settings.dateLineMode||'today')===nextMode&&(nextMode!=='custom'||settings.dateLineDate===nextDate))return;
  mutate(()=>{model.presentation??={};model.presentation.dateLineMode=nextMode;if(nextMode==='custom')model.presentation.dateLineDate=nextDate;model.presentation.locks??={};model.presentation.locks.dateLineMode=true;if(nextMode==='custom')model.presentation.locks.dateLineDate=true;});
};
panel.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>action(button.dataset.action));
updateControls();
}
function renderGantt(preserveScroll=false,preferredPosition=null){
const host=document.querySelector('#gantt'),preview=document.querySelector('.preview');
const old=gantt,position=preferredPosition?.day??(preserveScroll&&old?old.visibleDay():null),top=preferredPosition?.top??preview.scrollTop;
old?.destroy();gantt=null;host.innerHTML='';const tasks=taskList();
if(!tasks.length){host.innerHTML='';preview.scrollLeft=0;preview.scrollTop=0;timelinePosition=null;updateControls();return;}
if(timelineFitEnabled)view=fittingTimelineView(tasks,preview.clientWidth);
try{gantt=new Timeline(host,{tasks,view,snap,left:leftPaddingMonths,right:rightPaddingMonths,autoPan:preferences.autoPan,
 onCommit:(id,start,end)=>{const x=locate(id);if(!x||start>end)return;mutate(()=>{if(x.f.start!==start){x.f.start=start;x.f.locks.start=true;}if(x.f.end!==end){x.f.end=end;x.f.locks.end=true;}});},
 onSelect:id=>{const x=locate(id);if(x)selectItem(x.pi,x.fi);},
 onExtend:side=>{if(side==='left'){if(leftPaddingMonths>=120)return false;leftPaddingMonths=Math.min(120,leftPaddingMonths+2);}else{if(rightPaddingMonths>=120)return false;rightPaddingMonths=Math.min(120,rightPaddingMonths+2);}persistTimeline();requestAnimationFrame(updateControls);return true;}
});
const svg=host.querySelector('svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
const style=document.createElementNS('http://www.w3.org/2000/svg','style');style.textContent=model.projects.map((p,i)=>`.project-${i} .bar{fill:${colorHex(p.color)}!important}.project-${i}.light .bar{opacity:.4}`).join('\n');svg.prepend(style);
for(const bar of gantt.chart.bars){const f=locate(bar.task._modelId)?.f;if(f?.light)bar.group.classList.add('light');const label=bar.group.querySelector('.bar-label');if(f?.fontSize)label.style.fontSize=`${f.fontSize}px`;}
const taskBounds=bounds(),startX=gantt.dateToX(taskBounds.start),endX=gantt.dateToX(taskBounds.end);
const requested=position===null?startX-80:gantt.dateToX(position);
const emptyWindow=requested>endX||requested+preview.clientWidth<startX;
gantt.scrollTo(timelineFitEnabled||emptyWindow?Math.max(0,startX-80):requested,timelineFitEnabled?0:top);
}catch(err){host.innerHTML=`<div class="empty">${t('甘特圖載入失敗：','Gantt chart failed to load: ')}${esc(err.message)}</div>`;console.error(err);}
updateControls();
}
function locate(id){for(let pi=0;pi<model.projects.length;pi++){const fi=model.projects[pi].phases.findIndex(x=>x.id===id);if(fi>=0)return {pi,fi,f:model.projects[pi].phases[fi]}}}
function wire(){app.querySelector('.preview').onscroll=updateControls;app.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
const globalActions=app.querySelector('.global-actions');globalActions.onpointerenter=showGlobalMenu;globalActions.onpointerleave=()=>{if(!globalMenuPinned&&!globalActions.contains(document.activeElement))hideGlobalMenu();};globalActions.onfocusin=showGlobalMenu;globalActions.querySelector('[data-action="global-menu"]').onfocus=showGlobalMenu;globalActions.onfocusout=event=>{if(!globalActions.contains(event.relatedTarget)&&!globalMenuPinned)hideGlobalMenu();};
app.querySelector('#workspace-language').onchange=async event=>{
 try {await changePreferences('language',event.target.value);app.querySelector('#workspace-language').focus();}
 catch(error){event.target.value=getLocale();alert(error.message);}
};
app.querySelector('#document-select').onchange=e=>void changeDocument({id:e.target.value});
app.querySelector('#view').onchange=e=>{view=e.target.value;if(timelineFitEnabled){timelineFitEnabled=false;rememberTimelineFit();}updateControls();renderGantt(true);rememberWorkspace()};app.querySelector('#snap').onchange=e=>{snap=e.target.value;preferences.snap=snap;storePreferences(localStorage,preferences);renderGantt(true);rememberWorkspace()};
const tree=app.querySelector('#tree');
bindOutline(tree,{
 select:({project,phase})=>selectItem(project,phase,true),
 step:({project,phase},delta)=>{moveMobileItem(project,phase,delta);focusOutlineSelection();},
 move:moveOutlineItem,
 fold:pi=>{
  const project=model.projects[pi];
  if(collapsedProjects.has(project.id))collapsedProjects.delete(project.id);
  else collapsedProjects.add(project.id);
  render(true);
  const row=app.querySelector(`[data-select-p="${pi}"]`);
  for(const item of app.querySelectorAll('#tree .tree-item'))item.tabIndex=item===row?0:-1;
  row.focus({preventScroll:true});
 },
 rename:({project,phase},name,returnFocus)=>{
  const target=phase===null?model.projects[project]:model.projects[project].phases[phase];
  const key=phase===null?'name':'label';
  selected={project,phase};explicitOutlineSelection=true;
  mutate(()=>{target[key]=name;target.locks??={};target.locks[key]=true;},{reveal:true});
  if(returnFocus)focusOutlineSelection();
 }
});
app.querySelector('aside').addEventListener('scroll',anchorInspector,{passive:true});
const split=app.querySelector('#split'),main=app.querySelector('main');
split.setAttribute('aria-orientation','vertical');
function sizeInspector(px){
 inspectorWidth=Math.round(Math.max(260,Math.min(420,px)));
 main.style.setProperty('--inspector-width',inspectorWidth+'px');
 sidebarPanel?.layout();
}
split.onkeydown=event=>{
 if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
 event.preventDefault();sizeInspector(inspectorWidth+(event.key==='ArrowRight'?16:-16));
 localStorage.setItem('drag.inspectorWidth',String(inspectorWidth));
};
split.onpointerdown=event=>{
 if(event.button!==0)return;
 const start=event.clientX,width=inspectorWidth;
 split.setPointerCapture(event.pointerId);
 split.onpointermove=e=>sizeInspector(width+e.clientX-start);
 split.onpointerup=()=>{split.onpointermove=null;localStorage.setItem('drag.inspectorWidth',String(inspectorWidth));};
 split.onpointercancel=()=>{split.onpointermove=null;sizeInspector(width);};
 split.onlostpointercapture=()=>{split.onpointermove=null;};
};
const range=app.querySelector('.view-settings');
range.onkeydown=e=>{
 if(e.key!=='Escape'||!range.open)return;
 const target=e.target.closest('details[open]')||range;
 e.preventDefault();target.open=false;target.querySelector('summary').focus();
};
range.onfocusout=e=>{if(e.relatedTarget&&!range.contains(e.relatedTarget))range.open=false;};

app.querySelector('#import').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{assertImportFileSize(f.size);const raw=JSON.parse(await f.text());assertImportModelBudget(raw);const v=normalizeModel(raw);await changeDocument({model:v,name:f.name.replace(/\.json$/i,'')||v.title})}catch(err){alert(t('開啟失敗：','Open failed: ')+(err instanceof SyntaxError?t('JSON 格式不正確，請檢查檔案內容','Invalid JSON. Check the file contents.'):err.message))}finally{e.target.value='';}};
}
function action(a){
if(quickTour.open||filesBusy||documentDialog.open||deleteDialog.open||trashDialog.open||settingsDialog?.open&&a!=='settings')return;
if(a==='global-menu'){globalMenuPinned=!globalMenuPinned;if(globalMenuPinned)showGlobalMenu();else hideGlobalMenu();return;}
hideGlobalMenu();
if(a==='document-menu'){showDocumentMenu();return;}hideDocumentMenu();
if(a==='fit-content'&&mode==='timeline'){
 timelineFitEnabled=!timelineFitEnabled;
 renderGantt(true);rememberTimelineFit();rememberWorkspace();
 return;
}
if(a==='newdocument'){showDocumentDialog('new');return;}
if(a==='settings'){settingsDialog.show();return;}
if(a==='toggle-sidebar'){void changePreferences('sidebarVisible',!preferences.sidebarVisible);return;}
if(['timeline','simple'].includes(a)){if(mode===a)return;if(gantt)timelinePosition={day:gantt.visibleDay(),top:app.querySelector('.preview').scrollTop};mode=a;render();return;}
if(a==='save')return exportJson();
if(a==='import'){const input=app.querySelector('#import');input.value='';input.click();return;}
if(a==='undo'||a==='redo'){const from=a==='undo'?history:redo,to=a==='undo'?redo:history;if(from.length){const previous=model,group=model.projects[selected.project],task=group?.phases[selected.phase];model=from.at(-1);try{persist();from.pop();to.push(deep(previous));
 if(selected.phase!==null&&task){const found=locate(task.id);if(found)selected={project:found.pi,phase:found.fi};}
 else if(group){const index=model.projects.findIndex(item=>item.id===group.id);if(index>=0)selected={project:index,phase:null};}
 }catch(error){model=previous;alert(t('無法儲存變更：','Could not save changes: ')+error.message);}render(true);}return;}
if(a==='newproject'){if(model.projects.length>=MAX_PROJECTS){alert(getLocale()==='en'?`Projects cannot exceed ${MAX_PROJECTS}`:`專案數量不可超過 ${MAX_PROJECTS} 個`);return;}explicitOutlineSelection=true;inspectorCollapsed=false;mutate(()=>{model.projects.push({id:uid(),name:t('新專案','New project'),icon:preferences.newIcon,color:preferences.newColor,...(preferences.newProjectFont?{fontSize:preferences.newProjectFont}:{}),phases:[],locks:{name:true}});selected={project:model.projects.length-1,phase:null};},{reveal:true});return;}
if(a==='newphase'){const p=model.projects[selected.project];if(!p)return;explicitOutlineSelection=true;inspectorCollapsed=false;collapsedProjects.delete(p.id);mutate(()=>{const start=fmt(new Date());p.phases.push({id:uid(),label:t('新任務','New task'),start,end:shiftMonths(start,1),...(preferences.newTaskFont?{fontSize:preferences.newTaskFont}:{}),...(preferences.newMilestoneShape!=='inherit'?{milestoneShape:preferences.newMilestoneShape}:{}),locks:{}});selected.phase=p.phases.length-1;},{reveal:true});return;}
if(a==='delete'){if(!confirm(t('確定刪除選取項目？','Delete the selected item?')))return;mutate(()=>{if(selected.phase===null){model.projects.splice(selected.project,1);selected={project:Math.max(0,selected.project-1),phase:null};}else{model.projects[selected.project].phases.splice(selected.phase,1);selected.phase=null;}});return;}
if(a==='svg'||a==='png'||a==='gif')return exportImage(a);
const preview=app.querySelector('.preview');
if(a==='prev'||a==='next'){gantt?.scrollTo(preview.scrollLeft+(a==='prev'?-1:1)*Math.max(300,preview.clientWidth*.65));updateControls();return;}
if(a==='today')return goToday();
if(a==='expand-left'||a==='expand-right')return extendTimeline(a==='expand-left'?'left':'right',3);
if(a==='shrink-left'||a==='shrink-right')return extendTimeline(a==='shrink-left'?'left':'right',-3);
}
window.addEventListener('resize',updateControls);

settingsDialog=new SettingsDialog({
 openTour:()=>quickTour.show(),preferences:()=>preferences,change:changePreferences,resetCategory,workspace:workspaceAction,backups,model:()=>deep(model),validateModel:normalizeModel,saveFile,
 exportPreferences:()=>saveFile('drag-preferences.json',JSON.stringify({format:'drag-preferences',version:1,values:preferences,workspace:{sidebar:sidebarState,paneHeight}},null,2),'application/json'),
 importPreferences:async value=>{const parsed=parsePreferencesFile(value);if(window.dragDesktop)await window.dragDesktop.configure({rememberSaveDirectory:parsed.preferences.rememberSaveDirectory,shortcuts:parsed.preferences.shortcuts,language:parsed.preferences.language});preferences=parsed.preferences;uiSize=preferences.uiSize;view=preferences.view;snap=preferences.snap;leftPaddingMonths=preferences.leftMonths;rightPaddingMonths=preferences.rightMonths;storePreferences(localStorage,preferences);setLocale(preferences.language);if(parsed.workspace){sidebarState=parsed.workspace.sidebar;paneHeight=parsed.workspace.paneHeight;localStorage.setItem('drag.sidebar',JSON.stringify(sidebarState));localStorage.setItem('drag.paneHeight',String(paneHeight));}render(true);backups.stage(model,preferences);},
 restore:async restored=>{await backups.write(model,preferences,'pre-restore');mutate(()=>{model=restored;selected={project:0,phase:0};});},
});
let workspaceFrame;
for(const type of ['pointerup','wheel'])document.addEventListener(type,()=>{cancelAnimationFrame(workspaceFrame);workspaceFrame=requestAnimationFrame(rememberWorkspace);},{passive:true});
window.addEventListener('beforeunload',()=>{rememberWorkspace();void files.flush().catch(()=>{});if(!window.dragDesktop)void backups.flush().catch(()=>{});});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!inspectorCollapsed&&!event.defaultPrevented&&!document.querySelector('dialog[open]')&&!event.target.closest('[open].range-options,.outline-rename')&&app.querySelector('#global-action-menu')?.hidden&&documentMenu.hidden){
  displayInspector(false);focusOutlineSelection();event.preventDefault();return;
 }
 const shortcut=shortcutForEvent(event);if(!shortcut)return;
 const command=Object.entries(preferences.shortcuts).find(([,key])=>key===shortcut)?.[0];if(!command)return;
 if(event.target.closest?.('input,textarea,select,[contenteditable="true"]')&&command!=='settings')return;
 if(quickTour.open||documentDialog.open||deleteDialog.open||trashDialog.open||settingsDialog.open&&command!=='settings')return;
 event.preventDefault();action(command);
});
if(window.dragDesktop){window.dragDesktop.onBackupError(message=>alert(t('備份失敗：','Backup failed: ')+message));void window.dragDesktop.configure({rememberSaveDirectory:preferences.rememberSaveDirectory,shortcuts:preferences.shortcuts,language:preferences.language}).catch(error=>alert(error.message));}
matchMedia('(min-width: 901px)').addEventListener('change',()=>layoutHeaderTools(app));
mobileLayout.addEventListener('change',()=>render(true));
render();
if(!loaded.warning){backups.stage(model,preferences);quickTour.startIfNeeded(firstUse);}
if(loaded.warning)alert(loaded.warning);

}
startApp().catch(error=>{
 console.error(error);
 const app=document.querySelector('#app'),blocked=/儲存|檔案庫|IndexedDB|quota|SecurityError/i.test(`${error?.name} ${error?.message}`);
 const card=document.createElement('section'),heading=document.createElement('h1'),message=document.createElement('p'),button=document.createElement('button');
 app.classList.add('startup-error');card.setAttribute('role','alert');
 heading.textContent=blocked?t('無法使用瀏覽器儲存空間','Browser storage is unavailable'):t('無法載入 drag','Could not load drag');
 message.textContent=blocked?t('請允許此網站使用本機儲存空間與 IndexedDB，或改用一般瀏覽視窗，然後重新整理。','Allow this site to use local storage and IndexedDB, or switch to a regular browsing window, then reload.'):t('請檢查網路連線，然後重新整理。','Check your network connection, then reload.');
 button.type='button';button.textContent=t('重新整理','Reload');button.onclick=()=>location.reload();
 card.append(heading,message,button);app.replaceChildren(card);
});
