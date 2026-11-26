// Keep the locale separate from user roadmap JSON. Preferences own persistence.
let locale = 'zh-TW';

export function setLocale(value) {
  const next = value === 'en' ? 'en' : 'zh-TW';
  const changed = locale !== next;
  locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next === 'en' ? 'en' : 'zh-Hant';
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event('drag:localechange'));
  return locale;
}

export function getLocale() { return locale; }
export function localeTag() { return locale === 'en' ? 'en-US' : 'zh-TW'; }
export function t(zh, en) { return locale === 'en' && en !== undefined ? en : zh; }
export const tr = t;
