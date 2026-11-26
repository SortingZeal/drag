import { isValidDate } from './model.js';
import { t } from './i18n.js';

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export function pictureAlignmentDate(settings = {}) {
  if (settings.alignMode === 'off' || !settings.alignMode) return null;
  if (settings.alignMode === 'today') return localToday();
  if (settings.alignMode === 'date' && isValidDate(settings.alignDate)) return settings.alignDate;
  throw new Error(t('請選擇有效的切齊日期', 'Choose a valid alignment date.'));
}

export function pictureDateLine(settings = {}) {
  const mode = settings.dateLineMode ?? 'today';
  if (mode === 'off') return null;
  if (mode === 'today') return { date: localToday(), label: t('今天', 'Today') };
  if (mode === 'custom' && isValidDate(settings.dateLineDate)) return { date: settings.dateLineDate, label: t('指定日期', 'Selected date') };
  throw new Error(t('請選擇有效的日期線日期', 'Choose a valid date line date.'));
}

const firstMonth = value => `${value.slice(0, 7)}-01`;
const lastMonth = value => {
  const [year, month] = value.split('-').map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return `${value.slice(0, 7)}-${String(days[month - 1]).padStart(2, '0')}`;
};

export function pictureDisplayRange(settings, minimum, maximum) {
  if ((settings.start && !isValidDate(settings.start)) || (settings.end && !isValidDate(settings.end))) throw new Error(t('圖片日期範圍無效', 'Invalid picture date range'));
  const aligned = pictureAlignmentDate(settings);
  const start = aligned || settings.start || firstMonth(settings.end && settings.end < minimum ? settings.end : minimum);
  const end = aligned && settings.end && settings.end < start
    ? lastMonth(maximum > start ? maximum : start)
    : settings.end || lastMonth(start > maximum ? start : maximum);
  if (start > end) throw new Error(t('圖片開始日期不得晚於結束日期', 'Picture start date cannot be after its end date.'));
  return { start, end };
}
