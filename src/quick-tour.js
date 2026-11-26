import { t } from './i18n.js';

const KEY='drag.onboarding';
const steps=()=>[
 {title:t('建立專案與任務','Create projects and tasks'),text:t('從「文件庫」新增或切換文件，再從左側建立專案與任務，設定起訖日期。','Open Documents to add or switch files. In the outline, create projects and tasks with start and end dates.'),preview:t('<span class="tour-chip">＋ 專案</span><span aria-hidden="true">→</span><span class="tour-chip">＋ 任務</span>','<span class="tour-chip">＋ Project</span><span aria-hidden="true">→</span><span class="tour-chip">＋ Task</span>')},
 {title:t('調整時程','Adjust the schedule'),text:t('拖曳時間條移動任務，拉動兩端調整日期。點上方日期切換尺度，左右拖曳日期列瀏覽時程；在圖檔可上下拖曳專案或任務調整順序。','Drag a task bar to move it, or pull either end to change its dates. Click a date to change the scale, or drag the date strip to pan. In Image, drag projects or tasks vertically to reorder them.'),preview:t('<div class="tour-timeline"><div>1 月　　2 月　　3 月</div><div class="tour-bar"><span>⋮</span>任務<span>⋮</span></div></div>','<div class="tour-timeline"><div>Jan　　Feb　　Mar</div><div class="tour-bar"><span>⋮</span>Task<span>⋮</span></div></div>')},
 {title:t('選擇圖面','Choose a view'),text:t('在「時間軸」編輯時程，切到「圖檔」檢查圖片樣式。圖檔可縮放、平移與置中。','Edit the schedule in Timeline, then switch to Picture to inspect its design. You can zoom, pan and center the picture.'),preview:t('<span class="tour-chip">時間軸</span><span class="tour-chip">圖檔</span>','<span class="tour-chip">Timeline</span><span class="tour-chip">Picture</span>')},
 {title:t('儲存與匯出','Save and export'),text:t('「儲存專案」保留可再編輯的 JSON；「匯出 SVG／PNG」產生圖片。介面、輸出與備份偏好可在設定調整。','Save project downloads an editable JSON file. Export SVG/PNG creates a picture. Adjust interface, export and backup preferences in Settings.'),preview:t('<span class="tour-chip">儲存專案</span><span class="tour-chip">SVG</span><span class="tour-chip">PNG</span>','<span class="tour-chip">Save project</span><span class="tour-chip">SVG</span><span class="tour-chip">PNG</span>')},
];
export class QuickTour{
 constructor(storage,uiSize){
  this.storage=storage;this.uiSize=uiSize;this.step=0;
  this.dialog=document.createElement('dialog');this.dialog.id='quick-tour';this.dialog.setAttribute('aria-labelledby','tour-title');this.dialog.setAttribute('aria-describedby','tour-description');document.body.append(this.dialog);
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.finish('dismissed');});
  this.dialog.addEventListener('click',event=>{
   const command=event.target.closest('[data-tour-action]')?.dataset.tourAction;
   if(command==='skip'||command==='close')this.finish(command==='skip'?'skipped':'dismissed');
   else if(command==='back'&&this.step>0){this.step--;this.render();}
   else if(command==='next'){if(this.step===steps().length-1)this.finish('completed');else{this.step++;this.render();}}
  });
  window.addEventListener('drag:localechange',()=>{if(this.open)this.render();});
 }
 get open(){return this.dialog.open;}
 state(){try{const value=JSON.parse(this.storage.getItem(KEY)||'null');return value?.version===1?value.status:null;}catch{return null;}}
 remember(status){try{this.storage.setItem(KEY,JSON.stringify({version:1,status}));}catch{}}
 startIfNeeded(firstUse){const state=this.state();if(state==='active'||firstUse&&!['completed','skipped','dismissed'].includes(state)){this.remember('active');this.show();}}
 show(){if(this.open)return;this.step=0;this.dialog.style.fontSize=({small:'13.6px',medium:'16px',large:'18.4px'})[this.uiSize()]||'16px';this.render();this.dialog.showModal();this.dialog.querySelector('[data-tour-action="next"]').focus();}
 finish(status){this.remember(status);this.dialog.close();}
 render(){
  const tourSteps=steps(),step=tourSteps[this.step],text=step.text+(this.step===3&&!window.dragDesktop?t(' 網頁版資料和備份只在此瀏覽器，請逐份下載專案 JSON 保存。',' Web data and backups stay in this browser. Download each project JSON to keep a copy.'):'');this.dialog.innerHTML=`<div class="tour-header"><span>${t('快速導覽','Quick tour')}</span><button data-tour-action="close" aria-label="${t('關閉快速導覽','Close quick tour')}">×</button></div><div class="tour-content"><div class="tour-progress" aria-label="${t(`第 ${this.step+1} 步，共 ${tourSteps.length} 步`,`Step ${this.step+1} of ${tourSteps.length}`)}">${tourSteps.map((_,i)=>`<span class="${i<=this.step?'is-current':''}"></span>`).join('')}</div><h2 id="tour-title">${step.title}</h2><p id="tour-description">${text}</p><div class="tour-preview" aria-hidden="true">${step.preview}</div></div><footer class="tour-footer"><button data-tour-action="skip">${t('跳過','Skip')}</button><div><button data-tour-action="back" ${this.step===0?'disabled':''}>${t('上一步','Back')}</button><button data-tour-action="next" class="tour-primary">${this.step===tourSteps.length-1?t('開始使用','Get started'):t('下一步','Next')}</button></div></footer>`;
  if(this.open)this.dialog.querySelector('[data-tour-action="next"]').focus();
 }
}
