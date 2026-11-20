import { t } from './i18n.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

// Read tracking data without changing the imported document. Older files can
// contain a decimal string; blank and invalid values mean no progress report.
export function taskProgress(value) {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    value = Number(value);
  }
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

// An imported document can render one row per project in the editor and both
// picture formats, even when it has no tasks. Keep this in line with the
// existing 2,000-task timeline budget before cloning or persisting it. Stored
// documents are intentionally not limited so an upgrade never locks users out
// of their existing work.
export const MAX_PROJECTS = 2000;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export function assertImportFileSize(size) {
  if (!Number.isFinite(size) || size < 0 || size > MAX_IMPORT_BYTES) {
    throw new Error(t('開啟的專案檔超過 8MB，請縮小檔案後再開啟','The project file exceeds 8 MB. Reduce its size and try again.'));
  }
}

export function assertImportModelBudget(value) {
  if (!isRecord(value) || !Array.isArray(value.projects)) return;
  if (value.projects.length > MAX_PROJECTS) {
    throw new Error(t(`專案數量不可超過 ${MAX_PROJECTS} 個`,`A file can contain at most ${MAX_PROJECTS} projects.`));
  }
}

/** Validate a real calendar date without timezone or Date rollover effects. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, date] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || date < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return date <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Bound work done by Frappe before it creates date columns and SVG nodes.
// This is a render guard: existing files remain readable and exportable.
export function assertTimelineRenderBudget(tasks, view, leftMonths, rightMonths) {
  if (tasks.length > 2000) throw new Error(t('時間軸任務過多，請縮小檔案後再顯示','Too many timeline tasks. Reduce the file size before displaying it.'));
  if (!tasks.length) return;
  let first = Infinity, last = -Infinity;
  for (const task of tasks) {
    if (Number(task.start.slice(0, 4)) < 100 || Number(task.end.slice(0, 4)) < 100) {
      throw new Error(t('時間軸不支援 0100 年以前的日期，原始資料仍可編輯及匯出','The timeline cannot display dates before year 0100. You can still edit and export the source data.'));
    }
    first = Math.min(first, Date.parse(`${task.start}T00:00:00Z`));
    last = Math.max(last, Date.parse(`${task.end}T00:00:00Z`));
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error(t('時間軸日期無效','Invalid timeline dates'));
  // Each month has at most 31 days. Include one extra month for Frappe's
  // alignment of the chart start and end to the selected view.
  const days = Math.ceil((last - first) / 86400000) + 1 +
    (leftMonths + rightMonths + 1) * 31;
  const minimumStepDays = { Day: 1, Week: 7, Month: 28, Quarter: 84, Year: 365 }[view];
  if (!minimumStepDays || days > 36600 || Math.ceil(days / minimumStepDays) > 5000) {
    throw new Error(t('時間軸日期範圍過大，請縮短期間或改用較粗的顆粒度','The timeline spans too many dates. Shorten the period or use a coarser scale.'));
  }
}

/**
 * Return an independent model, preserving all supplied fields and metadata.
 * Invalid imports are rejected before the caller replaces its current model.
 */
export function normalizeModel(value) {
  if (!isRecord(value) || !Array.isArray(value.projects)) {
    throw new Error(t('JSON 檔案必須包含專案清單','The JSON file must contain a projects list.'));
  }
  const model = clone(value);
  if (model.locks != null && !isRecord(model.locks)) throw new Error(t('專案資料的欄位設定格式不正確','Invalid project field settings'));
  if (model.presentation != null) {
    const settings = model.presentation;
    if (!isRecord(settings)) throw new Error(t('圖片設定格式不正確','Invalid picture settings'));
    if (settings.locks != null && !isRecord(settings.locks)) throw new Error(t('圖片的欄位設定格式不正確','Invalid picture field settings'));
    for (const key of ['start', 'end']) {
      if (settings[key] != null && settings[key] !== '' && !isValidDate(settings[key])) throw new Error(t(`圖片的${key === 'start' ? '顯示開始' : '顯示結束'}必須是有效日期或留白`,`Picture ${key === 'start' ? 'display start' : 'display end'} must be a valid date or blank.`));
    }
    if (settings.start && settings.end && settings.start > settings.end) throw new Error(t('顯示開始不得晚於顯示結束','Display start cannot be after display end.'));
    if (settings.milestoneShape != null && !['circle', 'star'].includes(settings.milestoneShape)) throw new Error(t('里程碑形狀請選擇圓點或星形','Choose a circle or star milestone shape.'));
    if (settings.alignMode != null && !['off', 'today', 'date'].includes(settings.alignMode)) throw new Error(t('起始切齊方式無效','Invalid start alignment mode'));
    if (settings.alignDate != null && settings.alignDate !== '' && !isValidDate(settings.alignDate)) throw new Error(t('起始切齊日期無效','Invalid start alignment date'));
    if (settings.alignMode === 'date' && !isValidDate(settings.alignDate)) throw new Error(t('請選擇有效的切齊日期','Choose a valid alignment date.'));
    if (settings.dateLineMode != null && !['off', 'today', 'custom'].includes(settings.dateLineMode)) throw new Error(t('日期線方式無效','Invalid date line mode'));
    if (settings.dateLineDate != null && settings.dateLineDate !== '' && !isValidDate(settings.dateLineDate)) throw new Error(t('日期線日期無效','Invalid date line date'));
    if (settings.dateLineMode === 'custom' && !isValidDate(settings.dateLineDate)) throw new Error(t('請選擇有效的日期線日期','Choose a valid date line date.'));
  }
  const entries = [];
  const ids = new Set();
  model.projects.forEach((project, projectIndex) => {
    const projectPath = t(`第${projectIndex + 1}個專案`,`Project ${projectIndex + 1}`);
    if (!isRecord(project) || !Array.isArray(project.phases)) {
      throw new Error(t(`${projectPath}必須包含任務清單`,`${projectPath} must contain a tasks list.`));
    }
    entries.push([project, projectPath]);
    project.phases.forEach((phase, phaseIndex) => {
      const phasePath = t(`${projectPath}的第${phaseIndex + 1}個任務`,`${projectPath}, task ${phaseIndex + 1}`);
      if (!isRecord(phase)) throw new Error(t(`${phasePath}資料格式不正確`,`${phasePath} has invalid data.`));
      if (!isValidDate(phase.start) || !isValidDate(phase.end)) {
        throw new Error(t(`${phasePath}必須包含有效的起訖日期（YYYY-MM-DD）`,`${phasePath} must have valid start and end dates (YYYY-MM-DD).`));
      }
      if (phase.start > phase.end) throw new Error(t(`${phasePath}的開始日期不得晚於結束日期`,`${phasePath} starts after it ends.`));
      if (phase.milestoneDate != null && phase.milestoneDate !== '' && !isValidDate(phase.milestoneDate)) throw new Error(t(`${phasePath}的里程碑日期必須是有效日期或留白`,`${phasePath} must have a valid milestone date or a blank value.`));
      entries.push([phase, phasePath]);
    });
  });

  // Reserve every supplied id before generating missing ids. Duplicate ids must
  // never be silently repaired: dates and locks are associated with these ids.
  for (const [entry, path] of entries) {
    if (entry.id !== undefined && entry.id !== null) {
      if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error(t(`${path}的識別碼必須是非空白文字`,`${path} must have a nonempty text ID.`));
      if (ids.has(entry.id)) throw new Error(t(`重複的識別碼：${entry.id}`,`Duplicate ID: ${entry.id}`));
      ids.add(entry.id);
    }
    if (entry.locks !== undefined && entry.locks !== null && !isRecord(entry.locks)) {
      throw new Error(t(`${path}的欄位設定格式不正確`,`${path} has invalid field settings.`));
    }
  }

  for (const [entry] of entries) {
    if (entry.id === undefined || entry.id === null) {
      let id;
      do {
        id = globalThis.crypto?.randomUUID?.()
          ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      } while (ids.has(id));
      entry.id = id;
      ids.add(id);
    }
    entry.locks ??= {};
  }
  for (const project of model.projects) project.color ??= '#64748b';
  return model;
}

/** Read the draft without ever writing, deleting, or repairing the stored key. */
export function readDraft(seed, storage) {
  const fallback = normalizeModel(seed);
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store || typeof store.getItem !== 'function') throw new Error(t('無法存取瀏覽器草稿儲存空間','Cannot access browser draft storage.'));
    const raw = store.getItem('drag.draft');
    if (raw === null || raw === undefined) return { model: fallback, warning: null };
    return { model: normalizeModel(JSON.parse(raw)), warning: null };
  } catch (error) {
    return {
      model: fallback,
      warning: t(`無法載入本機草稿，已保留原始草稿並載入初始資料。${error.message}`,`Cannot load the local draft. The original draft was preserved and the starter data was loaded. ${error.message}`),
    };
  }
}
