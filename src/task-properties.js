import { isValidDate } from './model.js';
import { t } from './i18n.js';
import { statusKind } from './task-glyphs.js';

export function completedStatus(status) {
  return statusKind(status) === 'complete' ? status : t('已完成', 'Completed');
}

export function applyTrackingUpdate(task, changes) {
  const fields = changes.progress === 100
    ? {...changes, status: completedStatus(changes.status ?? task.status)}
    : changes;
  task.locks ??= {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) delete task[name];
    else task[name] = value;
    task.locks[name] = true;
  }
}

function milestoneRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readTaskMilestone(task) {
  const marker = task.milestone;
  const label = typeof marker === 'string' ? marker : typeof marker?.label === 'string' ? marker.label : '';
  let date = task.milestoneDate || marker?.date;
  // A cleared date must stay cleared even when a legacy label resembles a date.
  if (task.locks?.milestoneDate && task.milestoneDate === '') date = null;
  else if (!date && !task.locks?.milestoneDate) date = label;
  return { label, date: isValidDate(date) ? date : null };
}

export function setTaskMilestoneDate(task, date) {
  if (date && !isValidDate(date)) throw new RangeError('Invalid milestone date');
  if (milestoneRecord(task.milestone) && !Object.hasOwn(task, 'milestoneDate')) {
    task.milestone.date = date;
  } else {
    task.milestoneDate = date;
  }
  task.locks ??= {};
  task.locks.milestoneDate = true;
}

export function setTaskMilestoneLabel(task, label) {
  if (milestoneRecord(task.milestone)) task.milestone.label = label;
  else task.milestone = label;
  task.locks ??= {};
  task.locks.milestone = true;
}

const validShape = value => value === 'circle' || value === 'star';

export function taskMilestoneShape(task, presentation = {}) {
  if (validShape(task.milestoneShape) && (task.locks?.milestoneShape || !presentation?.locks?.milestoneShape)) {
    return task.milestoneShape;
  }
  return presentation?.milestoneShape === 'star' ? 'star' : 'circle';
}
