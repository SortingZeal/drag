import { t } from './i18n.js';
import { taskProgress } from './model.js';
import './quick-report.css';

// Scope unsubmitted edits to the open document and task, including across
// inspector redraws, language changes and switches between local documents.
const drafts = new Map();
const names = ['status', 'progress', 'progressNote'];

export function bindQuickReport(form, documentId, taskId, save) {
  const key = JSON.stringify([documentId, taskId]);
  const fields = form.elements;
  const original = Object.fromEntries(names.map(name => [name, fields[name].value]));
  const discard = form.querySelector('[data-weekly-discard]');
  for (const [name, value] of Object.entries(drafts.get(key) || {})) fields[name].value = value;

  function remember() {
    const entries = names.filter(name => fields[name].value !== original[name])
      .map(name => [name, fields[name].value]);
    if (entries.length) drafts.set(key, Object.fromEntries(entries));
    else drafts.delete(key);
    discard.hidden = !entries.length;
  }
  remember();
  form.oninput = () => {
    fields.progress.setCustomValidity('');
    remember();
  };
  discard.onclick = () => {
    for (const name of names) fields[name].value = original[name];
    fields.progress.setCustomValidity('');
    fields.status.dispatchEvent(new Event('input', { bubbles: true }));
    fields.status.focus();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const raw = fields.progress.value.trim();
    const progress = taskProgress(raw);
    if (raw && progress === null) {
      fields.progress.setCustomValidity(t('請輸入 0 至 100 之間的數字，或留白。', 'Enter a number from 0 to 100, or leave it blank.'));
      fields.progress.reportValidity();
      return;
    }
    const changes = {};
    for (const name of names) {
      if (fields[name].value === original[name]) continue;
      if (name === 'progress') {
        if (progress !== taskProgress(original.progress)) changes.progress = progress ?? undefined;
      } else {
        changes[name] = fields[name].value || undefined;
      }
    }
    if (save(changes)) drafts.delete(key);
  };
}
