import { t } from './i18n.js';
import { taskProgress } from './model.js';
import { statusKind } from './task-glyphs.js';

const kinds = ['blocked', 'overdue', 'unconfirmed', 'due', 'unreported'];
export const reviewLabels = {
  all: ['全部追蹤項目', 'All review items'],
  blocked: ['受阻', 'Blocked'],
  due: ['本週到期', 'Due this week'],
  overdue: ['已逾期', 'Overdue'],
  unconfirmed: ['到期待確認', 'Past due, unconfirmed'],
  unreported: ['未回報進度', 'Progress not reported'],
};

function localDate(date) {
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}

export function weeklyEntries(projects, filter = 'all', today = new Date()) {
  const start = localDate(today);
  const sunday = new Date(today);
  sunday.setDate(sunday.getDate() + (7 - sunday.getDay()) % 7);
  const endOfWeek = localDate(sunday);
  const entries = [];
  projects.forEach(({ name, phases }, project) => {
    phases.forEach((task, phase) => {
      const progress = taskProgress(task.progress);
      if (progress === 100) return;
      const end = task.open_end ? null : task.end;
      const reasons = [];
      if (statusKind(task.status) === 'blocked') reasons.push('blocked');
      if (end && end < start) reasons.push(progress === null ? 'unconfirmed' : 'overdue');
      else if (end && end <= endOfWeek) reasons.push('due');
      if (progress === null) reasons.push('unreported');
      if (!reasons.length || (filter !== 'all' && !reasons.includes(filter))) return;
      entries.push({ project, phase, projectName: name, task, progress, end, kind: reasons[0], reasons });
    });
  });
  return entries.sort((a, b) => {
    const priority = kinds.indexOf(a.kind) - kinds.indexOf(b.kind);
    if (priority) return priority;
    if (!a.end || !b.end) return Number(!a.end) - Number(!b.end);
    return a.end.localeCompare(b.end);
  });
}
