import { t } from './i18n.js';
import { taskProgress } from './model.js';
import { statusTone } from './task-glyphs.js';
import { completedStatus, readTaskMilestone } from './task-properties.js';

const statusOptions = [
  {label: ['未開始', 'Not started'], progress: 0},
  {label: ['進行中', 'In progress'], progress: undefined},
  {label: ['受阻', 'Blocked'], progress: undefined},
  {label: ['已完成', 'Completed'], progress: 100},
];

export function taskTrackingFields(task, quick, esc) {
  const status = typeof task.status === 'string' ? task.status : '';
  const progress = taskProgress(task.progress);
  const note = typeof task.progressNote === 'string' ? task.progressNote : '';
  const id = name => (quick ? 'weekly-report-' : 'task-report-') + (name === 'progressNote' ? 'note' : name);
  const field = name => `id="${id(name)}" ${quick ? `name="${name}"` : `data-field="${name}"`}`;
  const options = statusOptions.map(({label: pair}, index) => {
    const value = t(...pair);
    return `<button type="button" data-status-choice="${index}" aria-pressed="${pair.includes(status)}">
      <span class="status-dot" style="--dot:${statusTone(value).accent}" aria-hidden="true"></span>${value}</button>`;
  }).join('');
  const unknown = t('未回報', 'Not reported');
  return `<div class="task-tracking" data-task-tracking>
    <div class="tracking-control">
      <label for="${id('status')}">${t('階段狀態', 'Phase status')}</label>
      <div class="status-choices" role="group" aria-label="${t('階段狀態','Phase status')}">${options}</div>
      <div class="custom-status">
        <input type="text" data-task-status ${field('status')} list="phase-status-options" value="${esc(status)}" placeholder="${t('自訂狀態…','Custom status…')}"/>
        <button type="button" data-clear-status aria-label="${t('清除狀態','Clear status')}" title="${t('清除狀態','Clear status')}">×</button>
      </div>
      <datalist id="phase-status-options">${statusOptions.map(({label})=>`<option value="${t(...label)}"></option>`).join('')}</datalist>
    </div>
    <div class="tracking-control">
      <div class="progress-heading"><label for="${id('progress')}">${t('完成進度','Progress')}</label>
        <button type="button" data-clear-progress aria-pressed="${progress === null}" aria-label="${t('標為未回報','Mark as not reported')}">${unknown}</button></div>
      <div class="progress-adjust">
        <input data-progress-slider type="range" min="0" max="100" step="1" value="${progress ?? 0}" aria-label="${t('調整完成進度','Adjust completion')}"/>
        <div class="exact-progress"><input data-task-progress ${field('progress')} ${quick?'type="text" inputmode="decimal"':'type="number" min="0" max="100" step="any"'} value="${progress ?? ''}" aria-label="${t('完成百分比（%）','Completion (%)')}" placeholder="—"/><span aria-hidden="true">%</span></div>
      </div>
    </div>
  </div><label>${t('進度備註（選填）','Progress note (optional)')}<textarea class="report-note" rows="2" ${field('progressNote')}>
${esc(note)}</textarea></label>`;
}

export function bindTrackingControls(root, savePreset) {
  const status = root.querySelector('[data-task-status]');
  const progress = root.querySelector('[data-task-progress]');
  const slider = root.querySelector('[data-progress-slider]');
  const clearStatus = root.querySelector('[data-clear-status]');
  const clearProgress = root.querySelector('[data-clear-progress]');
  const choices = root.querySelectorAll('[data-status-choice]');
  function sync() {
    const value = taskProgress(progress.value);
    slider.value = value ?? 0;
    slider.setAttribute('aria-valuetext', value === null ? t('未回報','Not reported') : value + '%');
    slider.style.setProperty('--complete', (value ?? 0) + '%');
    clearProgress.setAttribute('aria-pressed', String(value === null));
    clearStatus.disabled = !status.value;
    for (const button of choices) {
      button.setAttribute('aria-pressed', String(statusOptions[Number(button.dataset.statusChoice)].label.includes(status.value)));
    }
  }
  function update(input, value, commit, selector) {
    if (input.value !== value) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (commit) {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (!root.isConnected) document.querySelector('#editor ' + selector)?.focus({preventScroll:true});
    }
  }
  let priorStatus;
  root.oninput = event => {
    if (event.target === progress) {
      if (taskProgress(progress.value) === 100) {
        priorStatus ??= status.value;
        status.value = completedStatus(status.value);
      } else if (priorStatus !== undefined) {
        status.value = priorStatus;
        priorStatus = undefined;
      }
    } else if (event.target === status) {
      priorStatus = undefined;
    } else return;
    sync();
  };
  for (const button of choices) button.onclick = () => {
    const preset = statusOptions[Number(button.dataset.statusChoice)];
    const label = preset.label.includes(status.value) ? status.value : t(...preset.label);
    const percent = String(preset.progress ?? '');
    priorStatus = undefined;
    if (label === status.value && percent === progress.value) return;
    status.value = label;
    progress.value = percent;
    status.dispatchEvent(new Event('input', {bubbles: true}));
    if (savePreset) {
      savePreset({status: label, progress: preset.progress});
      if (!root.isConnected) document.querySelector(`#editor [data-status-choice="${button.dataset.statusChoice}"]`)?.focus({preventScroll:true});
    }
  };
  clearStatus.onclick = () => update(status, '', true, '[data-task-status]');
  clearProgress.onclick = () => {
    if (progress.value) update(progress, '', true, '[data-clear-progress]');
  };
  slider.oninput = () => update(progress, slider.value, false);
  slider.onchange = () => update(progress, slider.value, true, '[data-progress-slider]');
  // Native ranges start at zero. Choosing that same position still reports 0%.
  slider.onclick = () => { if (progress.value === '') update(progress, slider.value, true, '[data-progress-slider]'); };
  slider.onkeydown = event => {
    if (event.key === 'Home' && progress.value === '') {
      event.preventDefault(); update(progress, '0', true, '[data-progress-slider]');
    }
  };
  sync();
}

export function milestoneFields(task, presentation, esc) {
  const { label, date } = readTaskMilestone(task);
  const shape = !task.locks?.milestoneShape && presentation?.locks?.milestoneShape ? '' : task.milestoneShape || '';
  const options = [
    ['', t('沿用','Default'), ''], ['circle', t('圓點','Circle'), '●'], ['star', t('星形','Star'), '★'],
  ];
  return `<fieldset class="milestone-controls"><legend>${t('里程碑','Milestone')}</legend>
    <label>${t('里程碑名稱','Milestone name')}<input type="text" data-field="milestone" placeholder="${t('例如：驗收','e.g. Sign-off')}" value="${esc(label)}"/></label>
    <label>${t('里程碑日期','Milestone date')}<input type="date" data-field="milestoneDate" value="${date || ''}"/></label>
    <div class="milestone-shortcuts" role="group" aria-label="${t('設定里程碑日期','Set milestone date')}">
      <button type="button" data-milestone-anchor="start">${t('用開始日','Use start')}</button>
      <button type="button" data-milestone-anchor="end" ${task.open_end ? 'disabled' : ''}>${t('用結束日','Use end')}</button>
      <button type="button" data-milestone-anchor="clear" ${date ? '' : 'disabled'}>${t('清除日期','Clear date')}</button>
    </div>
    <div class="marker-shapes" role="group" aria-label="${t('里程碑形狀','Milestone shape')}">
      ${options.map(([key,name,mark])=>`<button type="button" data-milestone-shape="${key}" aria-pressed="${shape===key}"><span aria-hidden="true">${mark}</span>${name}</button>`).join('')}
    </div>
  </fieldset>`;
}
