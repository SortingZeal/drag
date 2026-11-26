import { getLocale, t } from './i18n.js';
import { weeklyEntries, reviewLabels } from './weekly-tracking.js';
import { taskTrackingFields, bindTrackingControls } from './task-controls.js';
import { bindQuickReport } from './quick-report.js';

const categories = Object.keys(reviewLabels);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function trackingState(saved = {}) {
  return {
    category:categories.includes(saved?.category) ? saved.category : 'all',
    projectId:typeof saved?.projectId === 'string' ? saved.projectId : '',
    taskId:typeof saved?.taskId === 'string' ? saved.taskId : '',
  };
}

export function trackingWeek(date) {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate()+6);
  const fmt = new Intl.DateTimeFormat(getLocale(),{year:'numeric',month:'short',day:'numeric'});
  return fmt.formatRange(monday,sunday);
}

export function trackingRows(entries, taskId) {
  return entries.map(({project,phase,projectName,task,progress,end,reasons}) => {
    const title=safe(task.label || t('未命名任務','Untitled task'));
    const flags=reasons.map(key=>`<span class="review-reason" data-kind="${key}">${t(...reviewLabels[key])}</span>`).join('');
    const percent=progress===null?'—':progress+'%';
    return `<button type="button" class="weekly-row" data-weekly-project="${project}" data-weekly-phase="${phase}" ${taskId===task.id?'aria-current="true"':''}>
      <span class="review-task"><strong class="weekly-name">${title}</strong><span class="review-task-detail"><small class="weekly-project">${safe(projectName || t('未命名專案','Untitled project'))}</small><span class="weekly-flags">${flags}</span></span></span>
      <span class="weekly-end">${end?`<time datetime="${safe(end)}">${safe(end)}</time>`:t('結束未定','Open end')}</span>
      <span class="review-status">${safe(task.status || t('未設定','Not set'))}</span>
      <span class="weekly-progress">${percent}<progress max="100" value="${progress??0}" aria-label="${t('完成度','Completion')}" aria-valuetext="${progress===null?t('進度未回報','Progress not reported'):percent}"></progress></span>
    </button>`;
  }).join('');
}

function reportMarkup(entry) {
  if (!entry) return `<div class="review-prompt"><h2>${t('快速回報','Quick update')}</h2><p>${t('選擇清單中的任務即可更新狀態與完成度。','Select a task to update its status and progress.')}</p></div>`;
  return `<div class="review-form-heading"><span>${safe(entry.projectName)}</span>
    <button type="button" data-weekly-close aria-label="${t('關閉回報','Close update')}" title="${t('關閉回報','Close update')}">×</button></div>
    <h2 class="editor-selection">${safe(entry.task.label || t('未命名任務','Untitled task'))}</h2>
    <form class="form" id="weekly-report-form" aria-label="${t('快速回報','Quick update')}">
      ${taskTrackingFields(entry.task,true,safe)}
      <div class="weekly-report-actions"><button type="submit" data-weekly-save>${t('儲存並前往下一項','Save and next')}</button>
      <button type="button" data-weekly-discard hidden>${t('捨棄修改','Discard edits')}</button></div>
    </form>`;
}

export function mountTrackingPage(page, projects, documentId, state, save, remember) {
  let queue=[], current, timer;
  const reviewed=new Set();
  function focus(selector){page.querySelector(selector)?.focus({preventScroll:true});}
  function render() {
    const now=new Date();
    const all=weeklyEntries(projects,'all',now);
    if(state.projectId&&!projects.some(p=>p.id===state.projectId))state.projectId='';
    const scoped=all.filter(e=>!state.projectId||projects[e.project].id===state.projectId);
    queue=state.category==='all'?scoped:scoped.filter(e=>e.reasons.includes(state.category));
    current=queue.find(e=>e.task.id===state.taskId);
    if(!current)state.taskId='';
    const counts=Object.fromEntries(categories.map(key=>[key,0]));
    counts.all=scoped.length;
    for(const entry of scoped)for(const reason of entry.reasons)counts[reason]++;
    const dirty=state.projectId||state.category!=='all';
    const filterBtns=categories.map(key=>`<button type="button" data-weekly-filter="${key}" aria-pressed="${state.category===key}"><span>${t(...reviewLabels[key])}</span><b>${counts[key]}</b></button>`).join('');
    const options=projects.map(p=>`<option value="${safe(p.id)}" ${state.projectId===p.id?'selected':''}>${safe(p.name||t('未命名專案','Untitled project'))}</option>`).join('');
    const scroll=page.querySelector('.review-task-list')?.scrollTop||0;
    page.innerHTML=`<div class="tracking-inner"><div class="review-header"><div><h1 id="tracking-heading">${t('本週追蹤','Weekly review')}</h1><p>${trackingWeek(now)}</p></div>
      <label for="tracking-project-filter">${t('專案','Project')} <select id="tracking-project-filter"><option value="">${t('所有專案','All projects')}</option>${options}</select></label></div>
      <div class="review-categories" role="group" aria-label="${t('篩選追蹤任務','Filter review tasks')}">${filterBtns}</div>
      <div class="review-columns"><section id="weekly-review" aria-label="${t('追蹤清單','Review list')}">
        <div class="review-columns-head" aria-hidden="true"><span>${t('任務／專案','Task / project')}</span><span>${t('截止日','Due date')}</span><span>${t('階段狀態','Phase status')}</span><span>${t('完成度','Completion')}</span></div>
        <div class="review-task-list">${queue.length?trackingRows(queue,state.taskId):`<div class="review-empty"><p class="weekly-empty">${t('沒有符合條件的任務','No matching tasks')}</p>${dirty?`<button type="button" data-weekly-reset>${t('清除篩選','Clear filters')}</button>`:''}</div>`}</div>
      </section><section class="review-report editor-section" aria-label="${t('快速回報','Quick update')}"></section></div>
      <p id="weekly-feedback" role="status" aria-live="polite"></p></div>`;
    page.querySelector('.review-task-list').scrollTop=scroll;
    renderReport();
    clearTimeout(timer);
    const midnight=new Date(now);midnight.setHours(24,0,0,0);
    timer=setTimeout(render,Math.max(1,midnight-now));
  }
  function renderReport() {
    const panel=page.querySelector('.review-report');
    panel.innerHTML=reportMarkup(current);
    const form=page.querySelector('#weekly-report-form');
    if(form){
      bindQuickReport(form,documentId,current.task.id,changes=>{
        const done=current;
        const next=queue.slice(queue.indexOf(done)+1).find(e=>!reviewed.has(e.task.id));
        if(Object.keys(changes).length&&!save(done.task,changes))return false;
        reviewed.add(done.task.id);
        state.taskId=next?.task.id||'';
        render();
        if(next&&!matchMedia('(max-width:700px)').matches)page.querySelector('.weekly-row[aria-current=true]')?.scrollIntoView({block:'nearest'});
        focus(next?'#weekly-report-status':'[data-weekly-filter][aria-pressed=true]');
        page.querySelector('#weekly-feedback').textContent=[Object.keys(changes).length?t('已儲存回報','Report saved.'):null,next?t('已前往下一項','Moved to the next task.'):t('已到清單末端','Reached the end of the list.')].filter(Boolean).join(' ');
        remember();
        return true;
      });
      bindTrackingControls(form.querySelector('[data-task-tracking]'));
    }
  }
  function selectEntry(entry) {
    page.querySelector('.weekly-row[aria-current]')?.removeAttribute('aria-current');
    state.taskId=entry?.task.id||'';
    current=entry;
    if(entry)page.querySelector(`[data-weekly-project="${entry.project}"][data-weekly-phase="${entry.phase}"]`)?.setAttribute('aria-current','true');
    page.querySelector('#weekly-feedback').textContent='';
    renderReport();remember();
  }
  function closeReport(){
    const entry=current;if(!entry)return;
    selectEntry(null);focus(`[data-weekly-project="${entry.project}"][data-weekly-phase="${entry.phase}"]`);
  }
  page.onclick=event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.hasAttribute('data-weekly-close')){closeReport();return;}
    if(button.hasAttribute('data-weekly-filter')||button.hasAttribute('data-weekly-reset')){
      state.category=button.dataset.weeklyFilter||'all';
      if(button.hasAttribute('data-weekly-reset'))state.projectId='';
      state.taskId='';reviewed.clear();render();focus('[data-weekly-filter][aria-pressed=true]');remember();return;
    }
    if(button.hasAttribute('data-weekly-phase')){
      const p=Number(button.dataset.weeklyProject),f=Number(button.dataset.weeklyPhase);
      reviewed.clear();selectEntry(queue.find(e=>e.project===p&&e.phase===f));
      focus(event.detail===0?'#weekly-report-status':'[aria-current=true]');
    }
  };
  page.onchange=event=>{
    if(event.target.id!=='tracking-project-filter')return;
    state.projectId=event.target.value;state.taskId='';reviewed.clear();render();focus('#tracking-project-filter');remember();
  };
  page.onkeydown=event=>{
    if(event.key==='Escape'&&!event.isComposing&&current&&event.target.closest('#weekly-report-form,.review-report')){
      event.preventDefault();event.stopPropagation();closeReport();
    }
  };
  render();
  return ()=>clearTimeout(timer);
}
