import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Test-only event ledger. It never ships in dist or reads a user's profile.
export const test = base.extend({
  interactionAudit: [async ({ context }, use, info) => {
    const events = [];
    await context.exposeBinding('__dragAuditRecord', ({ page }, event) => {
      events.push({ ...event, page: page.url() });
    });
    await context.addInitScript(() => {
      localStorage.setItem('drag.onboarding',JSON.stringify({version:1,status:'completed'}));
      const attrs = ['data-action','data-field','data-check','data-nudge','data-icon','data-picture-action','data-picture-zoom-slider','data-editor-section','data-editor-collapse','data-sidebar-action','data-ui-size','data-select-p','data-select-f','data-pref','data-reset-pref','data-settings-category','data-settings-action','data-shortcut','data-reset-shortcut','data-backup-preview','data-backup-restore','data-backup-export','data-document-action','data-document-restore'];
      const selector = attrs.map(key => key==='data-ui-size'?'button[data-ui-size]':`[${key}]`).join(',') + ',#settings-search,.timeline-date-dock,[data-scale],#snap,#report-title,#report-start,#report-end,#report-shape,.sidebar-resizer,.sidebar-corner-resizer,#split,.aside-title,.grid-header,.picture-viewport,[draggable]';
      for (const type of ['click','change','pointerdown','dblclick','keydown','dragstart','drop']) document.addEventListener(type, event => {
        const node = event.target instanceof Element ? event.target.closest(selector) : null;
        if (!node || (type === 'keydown' && !['Enter','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Backspace','Delete'].includes(event.key)&&!event.metaKey&&!event.ctrlKey)) return;
        const attributes = Object.fromEntries(attrs.filter(key => node.hasAttribute(key)).map(key => [key, node.getAttribute(key)]));
        void window.__dragAuditRecord({ type, trusted: event.isTrusted, key: event.key, id: node.id || null, class: typeof node.className === 'string' ? node.className : null, attributes, value: node.value, checked: node.checked, mode: document.querySelector('[data-action="simple"].active') ? 'simple' : 'timeline' }).catch(() => {});
      }, true);
    });
    await use();
    const target = info.outputPath('audit-interactions.json');
    await writeFile(target, JSON.stringify({ title: info.title, status: info.status, events }, null, 2));
    await info.attach('actual-control-interactions', { path: target, contentType: 'application/json' });
  }, { auto: true }],
});
export { expect };
