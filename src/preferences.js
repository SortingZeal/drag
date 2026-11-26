import { t } from './i18n.js';

export const PREF_KEY='drag.preferences';
export const DEFAULT_SHORTCUTS={settings:'Mod+,',save:'Mod+s',import:'Mod+o',undo:'Mod+z',redo:'Mod+Shift+z',svg:'Mod+Shift+e',png:'Mod+Shift+p',timeline:'Mod+1',simple:'Mod+3'};
export const SHORTCUT_LABELS={settings:'設定',save:'儲存專案',import:'開啟專案',undo:'復原圖表',redo:'重做圖表',svg:'匯出 SVG',png:'匯出 PNG',timeline:'時間軸',simple:'圖檔'};
export const shortcutLabels=()=>({settings:t('設定','Settings'),save:t('儲存專案','Save project'),import:t('開啟專案','Open project'),undo:t('復原圖表','Undo chart'),redo:t('重做圖表','Redo chart'),svg:t('匯出 SVG','Export SVG'),png:t('匯出 PNG','Export PNG'),timeline:t('時間軸','Timeline'),simple:t('圖檔','Picture')});
export const DEFAULTS={language:'zh-TW',uiSize:'medium',density:'normal',toolbarLayout:[],theme:'light',palette:'jade',typeface:'system',canvasSurface:'dots',completionLight:'original',reduceMotion:false,sidebarVisible:true,startupMode:'timeline',rememberPictures:false,view:'Month',snap:'auto',leftMonths:6,rightMonths:6,autoPan:true,autoBackup:true,backupMinutes:5,backupCount:10,rememberSaveDirectory:false,pictureSize:'4k',background:'white',filename:'',timelineScale:2,newColor:'#64748b',newIcon:'▣',newProjectFont:'',newTaskFont:'',newMilestoneShape:'inherit',shortcuts:DEFAULT_SHORTCUTS};
export const GROUPS={interface:['language','uiSize','density','toolbarLayout','theme','palette','typeface','canvasSurface','completionLight','reduceMotion'],workspace:['sidebarVisible','startupMode','rememberPictures'],editing:['view','snap','leftMonths','rightMonths','autoPan','newColor','newIcon','newProjectFont','newTaskFont','newMilestoneShape','shortcuts'],storage:['autoBackup','backupMinutes','backupCount','rememberSaveDirectory'],export:['pictureSize','background','filename','timelineScale'],about:[]};
const enums={language:['zh-TW','en'],uiSize:['small','medium','large'],density:['compact','normal','comfortable'],theme:['light','dark','system'],palette:['jade','ocean','plum'],typeface:['system','book','mono'],canvasSurface:['dots','grid','plain'],completionLight:['original','subtle','soft'],startupMode:['timeline','simple','tracking','last'],view:['Day','Week','Month','Quarter','Year'],snap:['auto','1d','7d','30d'],pictureSize:['fullhd','2k','4k'],background:['white','transparent'],newMilestoneShape:['inherit','circle','star']};
const numbers={leftMonths:[1,120],rightMonths:[1,120],backupMinutes:[1,60],backupCount:[1,50],timelineScale:[1,2]};
const bools=['reduceMotion','sidebarVisible','rememberPictures','autoPan','autoBackup','rememberSaveDirectory'];
export function normalizeShortcut(value){
 if(value==='')return '';
 if(typeof value!=='string')throw Error(t('快捷鍵格式不正確','Invalid shortcut format'));
 const parts=value.split('+'),key=parts.pop();
 if(!/^[a-z0-9,\-.=\[\]\\/]$/i.test(key)||!parts.includes('Mod')||parts.some(x=>!['Mod','Shift','Alt'].includes(x))||new Set(parts).size!==parts.length)throw Error(t('快捷鍵須包含 ⌘／Ctrl 與單一按鍵','A shortcut must include ⌘/Ctrl and one key'));
 if(key.toLowerCase()==='q'||key.toLowerCase()==='w'||key.toLowerCase()==='r'||key.toLowerCase()==='l'||['c','v','x','a'].includes(key.toLowerCase()))throw Error(t('此快捷鍵由系統保留','This shortcut is reserved by the system'));
 return ['Mod','Alt','Shift'].filter(x=>parts.includes(x)).concat(key.toLowerCase()).join('+');
}
export const TOOLBAR_LAYOUT_LIMIT=32;
const toolbarKeys=new Set(['documents','undo','redo','display','export','language','more']);
export function isToolbarLayout(value){
 if(!Array.isArray(value)||value.length>TOOLBAR_LAYOUT_LIMIT)return false;
 const seen=new Set();
 const supported=value.every(key=>{
  if(key==='separator'||key==='space')return true;
  if(!toolbarKeys.has(key)||seen.has(key))return false;
  seen.add(key);return true;
 });
 return supported && value.length+toolbarKeys.size-seen.size<=TOOLBAR_LAYOUT_LIMIT;
}
export function normalizePreferences(input={},strict=false){
 const result=structuredClone(DEFAULTS);
 if(!input||typeof input!=='object'||Array.isArray(input)) {if(strict)throw Error(t('設定格式不正確','Invalid settings format'));return result;}
 if(strict&&Object.keys(input).some(k=>!Object.hasOwn(DEFAULTS,k)))throw Error(t('設定包含不支援的項目','Settings contain unsupported fields'));
 for(const key of Object.keys(DEFAULTS)){
  if(!Object.hasOwn(input,key))continue;
  const value=key==='startupMode'&&input[key]==='infographic'?'simple':input[key];let valid=true;
  if(enums[key])valid=enums[key].includes(value);
  else if(numbers[key])valid=typeof value==='number'&&Number.isInteger(value)&&value>=numbers[key][0]&&value<=numbers[key][1];
  else if(bools.includes(key))valid=typeof value==='boolean';
  else if(key==='toolbarLayout'){
   if(isToolbarLayout(value)){result.toolbarLayout=[...value];continue;}
   valid=false;
  }
  else if(key==='newColor')valid=typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  else if(key==='newIcon')valid=typeof value==='string'&&value.length<=64;
  else if(['newProjectFont','newTaskFont'].includes(key))valid=value===''||typeof value==='number'&&value>=8&&value<=160;
  else if(key==='filename')valid=typeof value==='string'&&value.length<=100&&!/[\\/:*?"<>|\x00-\x1f]/.test(value)&&![...value.matchAll(/\{([^}]+)\}/g)].some(m=>!['title','mode','date'].includes(m[1]));
  else if(key==='shortcuts'){
   try{
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='infographic'&&!Object.hasOwn(DEFAULT_SHORTCUTS,k)))throw Error(t('快捷鍵格式不正確','Invalid shortcut format'));
    const shortcuts={...DEFAULT_SHORTCUTS};for(const action of Object.keys(DEFAULT_SHORTCUTS))if(Object.hasOwn(value,action))shortcuts[action]=normalizeShortcut(value[action]);
    const assigned=Object.values(shortcuts).filter(Boolean);if(new Set(assigned).size!==assigned.length)throw Error(t('快捷鍵與其他功能重複','Shortcut is already assigned to another action'));result.shortcuts=shortcuts;continue;
   }catch(error){if(strict)throw error;continue;}
  }
  if(valid)result[key]=value;else if(strict)throw Error(t('設定值無效：','Invalid setting: ')+key);
 }
 return result;
}
export function loadPreferences(storage){
 let saved;try{saved=JSON.parse(storage.getItem(PREF_KEY)||'null')}catch{}
 if(saved?.version===1)return normalizePreferences(saved.values);
 const legacy={};for(const[key,old]of Object.entries({uiSize:'drag.uiSize',snap:'drag.snap',leftMonths:'drag.leftPaddingMonths',rightMonths:'drag.rightPaddingMonths'})){
  const value=storage.getItem(old);if(value!==null)legacy[key]=['leftMonths','rightMonths'].includes(key)?Number(value):value;
 }return normalizePreferences(legacy);
}
export function storePreferences(storage,prefs){storage.setItem(PREF_KEY,JSON.stringify({version:1,values:prefs}));storage.setItem('drag.uiSize',prefs.uiSize);storage.setItem('drag.snap',prefs.snap);storage.setItem('drag.leftPaddingMonths',String(prefs.leftMonths));storage.setItem('drag.rightPaddingMonths',String(prefs.rightMonths));}
export function parsePreferencesFile(value){
 if(!value||value.format!=='drag-preferences'||value.version!==1)throw Error(t('不是支援的 drag 設定檔','This is not a supported drag settings file'));
 if(!value.values||typeof value.values!=='object'||Array.isArray(value.values))throw Error(t('設定內容格式不正確','Invalid settings content'));
 const preferences=normalizePreferences(value.values,true);
 let workspace=null;if(value.workspace!=null){
  const w=value.workspace;if(!w||typeof w!=='object'||Array.isArray(w))throw Error(t('工作區配置格式不正確','Invalid workspace layout'));
  const sidebar=w.sidebar??{};if(!sidebar||typeof sidebar!=='object'||Array.isArray(sidebar)||Object.keys(sidebar).some(k=>!['mode','dockWidth','float'].includes(k)))throw Error(t('面板配置格式不正確','Invalid panel layout'));
  if(sidebar.mode!=null&&!['floating','docked'].includes(sidebar.mode))throw Error(t('面板模式不正確','Invalid panel mode'));
  if(sidebar.dockWidth!=null&&(!Number.isFinite(sidebar.dockWidth)||sidebar.dockWidth<96||sidebar.dockWidth>2000))throw Error(t('面板寬度不正確','Invalid panel width'));
  if(sidebar.float!=null){if(typeof sidebar.float!=='object'||Array.isArray(sidebar.float))throw Error(t('浮動面板格式不正確','Invalid floating panel layout'));for(const [k,v]of Object.entries(sidebar.float))if(!['x','y','width','height'].includes(k)||!Number.isFinite(v)||Math.abs(v)>100000)throw Error(t('浮動面板尺寸不正確','Invalid floating panel dimensions'));}
  if(w.paneHeight!=null&&(!Number.isFinite(w.paneHeight)||w.paneHeight<25||w.paneHeight>78))throw Error(t('分割比例不正確','Invalid split ratio'));
  workspace={sidebar:structuredClone(sidebar),paneHeight:w.paneHeight??68};
 }return{preferences,workspace};
}
export function shortcutForEvent(event){
 if(!(event.metaKey||event.ctrlKey)||event.isComposing||event.repeat)return '';
 const codes={Comma:',',Period:'.',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Slash:'/'};
 const key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3).toLowerCase():/^Digit[0-9]$/.test(event.code)?event.code.slice(5):codes[event.code]??event.key.toLowerCase();if(key.length!==1)return '';
 return ['Mod',...(event.altKey?['Alt']:[]),...(event.shiftKey?['Shift']:[]),key].join('+');
}
export function normalizeViewMode(mode){return mode==='infographic'?'simple':['timeline','simple','tracking'].includes(mode)?mode:'timeline';}
export function imageFilename(prefs,title,mode,format){
 mode=normalizeViewMode(mode);
 if(!prefs.filename)return `${mode==='timeline'?'drag-roadmap':'drag-simple'}.${format}`;
 const clean=x=>String(x).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').trim();
 const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const value=prefs.filename.replace(/\{(title|mode|date)\}/g,(_,key)=>({title:clean(title)||'drag',mode,date})[key]);
 return `${clean(value).slice(0,140)||'drag'}.${format}`;
}
