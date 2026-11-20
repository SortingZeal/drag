import { clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const iconInput = page => page.locator('#editor [data-field="icon"]');
const iconOption = (page, value) => page.locator(`.icon-options [data-icon="${value}"]`);
const projectGroup = page => page.locator('.infographic-preview [data-project-id="icons-project-0"]');
const phaseGroup = page => page.locator('.infographic-preview [data-phase-id="icons-phase-0-0"]');
const phaseBarLabel = page => page.locator('.bar-wrapper[data-id="icons-phase-0-0"] .bar-label');
const technicalCopy = /Frappe Gantt|手動優先|自動鎖定|手動屬性鎖定|必須由你確認後套用|參考圖版型|起始年度按月、後續按季|完整日期才按實際日期定位|日期留白會涵蓋全部資料|目前未提供套用建議功能|拖曳移動|拉動兩端調整日期|尚未匯出 JSON|已匯出 JSON|已送出下載/;

function fixture() {
  const model = structuredClone(seed);
  model.metadata = { source: 'ui-copy-icons', nested: ['保留', { version: 3 }] };
  model.locks = { title: true };
  model.projects.forEach((project, pi) => {
    project.id = `icons-project-${pi}`;
    project.locks = { name: true, color: true };
    project.metadata = { keep: ['project', pi] };
    project.phases.forEach((phase, fi) => {
      phase.id = `icons-phase-${pi}-${fi}`;
      phase.locks = { label: true, start: true };
      phase.metadata = { keep: ['phase', pi, fi] };
    });
  });
  return model;
}

async function mount(page, model = fixture()) {
  await page.addInitScript(value => {
    if (!localStorage.getItem('icons.seeded')) {
      localStorage.setItem('drag.draft', JSON.stringify(value));
      localStorage.setItem('drag.leftPaddingMonths', '3');
      localStorage.setItem('drag.rightPaddingMonths', '3');
      localStorage.setItem('icons.seeded', 'true');
    }
  }, model);
  await page.goto('/');
  await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  expect(await draft(page)).toEqual(model);
  await page.locator('[data-select-f="0:0"]').click();
  await page.locator('.icon-picker summary').click();
  return model;
}

async function show(page, mode) {
  await clickAction(page, mode);
  if (mode === 'timeline') await expect(page.locator('#gantt svg')).toBeVisible();
  else await expect(page.locator('.infographic-preview svg')).toBeVisible();
}

async function download(page, name) {
  const pending = page.waitForEvent('download');
  await clickAction(page, name);
  return pending;
}

async function savedJson(page) {
  const file = await download(page, 'save');
  expect(file.suggestedFilename()).toBe((await page.locator('#document-select option:checked').innerText()) + '.json');
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}

async function setCustomIcon(page, value) {
  await iconInput(page).fill(value);
  await iconInput(page).press('Tab');await iconInput(page).blur();
  await expect(iconInput(page)).toHaveValue(value);
  await expect(page.locator('.icon-preview')).toHaveText(value || '無');
}

async function expectProjectIcon(page, value) {
  await expect(page.locator('[data-select-p="0"] .tree-icon')).toHaveText(value);
  for (const mode of ['simple']) {
    await show(page, mode);
    await expect(projectGroup(page).locator('[data-role="project-icon"]')).toHaveText(value);
  }
}

async function expectPhaseIcon(page, value, label) {
  await show(page, 'timeline');
  await expect(phaseBarLabel(page)).toContainText(label);
  await expect(phaseBarLabel(page)).toContainText(value);
  await expect(page.locator('[data-select-f="0:0"]')).toContainText(value);
  await show(page, 'simple');
  await expect(phaseGroup(page).locator('[data-role="phase-label"]')).toContainText(value);
  await expect(phaseGroup(page).locator('[data-role="phase-label"]')).toContainText(label);
}

test.beforeEach(async ({ page }, info) => {
  info.iconPageErrors = [];
  page.on('pageerror', error => info.iconPageErrors.push(error.message));
});
test.afterEach(async ({}, info) => { expect(info.iconPageErrors).toEqual([]); });

test('both editing modes show product controls without development notes', async ({ page }, info) => {
  const model = await mount(page);
  for (const mode of ['timeline', 'simple']) {
    await show(page, mode);
    for (const selector of ['[data-select-f="0:0"]', '[data-select-p="0"]']) {
      await page.locator(selector).click();
      expect(await page.locator('#app').innerText()).not.toMatch(technicalCopy);
      const titles = await page.locator('#app [title]').evaluateAll(nodes => nodes.map(node => node.title).join('\n'));
      expect(titles).not.toMatch(technicalCopy);
      await expect(page.locator('.brand small, #editor .note, #editor .field > span, #tree [title="手動屬性鎖定"], .report-hint, .hint, .save-state, .action-status')).toHaveCount(0);
      await expect(page.locator('#editor')).not.toContainText('Unicode');
      await expect(iconInput(page)).not.toHaveAttribute('placeholder', /\S/);
    }
    await page.screenshot({ path: info.outputPath(`${mode}-clean-ui.png`), fullPage: true });
  }
  expect(await draft(page)).toEqual(model);
});

test('empty icons offer visible choices, selection records intent, and repeating a locked choice adds no history', async ({ page }) => {
  const model = await mount(page);
  const options = ['', '★', '🏆', '⚙', '▣', '🛡', '👥', '🔗', '🔍', '✓', '⚑', '◆', '●', '✦', '💡', '📌', '🚀'];
  await expect(iconInput(page)).toHaveValue('');
  await expect(page.locator('.icon-preview')).toHaveText('無');
  expect(await page.locator('.icon-options [data-icon]').evaluateAll(nodes => nodes.map(node => node.dataset.icon))).toEqual(options);
  await expect(iconOption(page, '')).toHaveAttribute('aria-pressed', 'true');
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await iconOption(page, '').click();
  const explicitNone = structuredClone(model);
  explicitNone.projects[0].phases[0].icon = '';
  explicitNone.projects[0].phases[0].locks.icon = true;
  expect(await draft(page)).toEqual(explicitNone);
  await iconOption(page, '').click();
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await page.locator('[data-select-p="0"]').click();
  await expect(page.locator('.icon-preview')).toHaveText('★');
  await expect(iconOption(page, '★')).toHaveAttribute('aria-pressed', 'true');
  await iconOption(page, '★').click();
  const explicitStar = structuredClone(model);
  explicitStar.projects[0].locks.icon = true;
  expect(await draft(page)).toEqual(explicitStar);
  await iconOption(page, '★').click();
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
});

test('project icon choices update the tree and the picture mode with one undo, JSON preservation, and reload', async ({ page }) => {
  const model = await mount(page);
  await page.locator('[data-select-p="0"]').click();
  await iconOption(page, '🏆').click();
  const expected = structuredClone(model);
  expected.projects[0].icon = '🏆';
  expected.projects[0].locks.icon = true;
  expect(await draft(page)).toEqual(expected);
  await expect(iconInput(page)).toHaveValue('🏆');
  await expect(iconOption(page, '🏆')).toHaveAttribute('aria-pressed', 'true');
  await expectProjectIcon(page, '🏆');
  await iconOption(page, '🏆').click();
  expect(await draft(page)).toEqual(expected);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(expected);
  expect(await savedJson(page)).toEqual(expected);
  await page.reload();
  expect(await draft(page)).toEqual(expected);
  await page.locator('[data-select-p="0"]').click();
  await expect(page.locator('.icon-preview')).toHaveText('🏆');
  await expectProjectIcon(page, '🏆');
});

test('task icon choices appear on timeline bars, the tree, and the picture mode and survive history and JSON', async ({ page }) => {
  const model = await mount(page);
  await iconOption(page, '🚀').click();
  const expected = structuredClone(model);
  expected.projects[0].phases[0].icon = '🚀';
  expected.projects[0].phases[0].locks.icon = true;
  expect(await draft(page)).toEqual(expected);
  await expect(iconOption(page, '🚀')).toHaveAttribute('aria-pressed', 'true');
  await expectPhaseIcon(page, '🚀', model.projects[0].phases[0].label);
  await iconOption(page, '🚀').click();
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(model);
  await expect(action(page, 'undo')).toBeDisabled();
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(expected);
  expect(await savedJson(page)).toEqual(expected);
  await page.reload();
  expect(await draft(page)).toEqual(expected);
  await expect(iconInput(page)).toHaveValue('🚀');
  await expectPhaseIcon(page, '🚀', model.projects[0].phases[0].label);
});

test('choosing no icon removes explicit project and task icons without restoring a fallback or changing omitted defaults', async ({ page }) => {
  const model = fixture();
  model.projects[0].phases[0].icon = '🚀';
  delete model.projects[1].icon;
  await mount(page, model);
  await iconOption(page, '').click();
  await page.locator('[data-select-p="0"]').click();
  await iconOption(page, '').click();
  const expected = structuredClone(model);
  expected.projects[0].icon = '';
  expected.projects[0].locks.icon = true;
  expected.projects[0].phases[0].icon = '';
  expected.projects[0].phases[0].locks.icon = true;
  expect(await draft(page)).toEqual(expected);
  await expect(page.locator('.icon-preview')).toHaveText('無');
  await expect(iconOption(page, '')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-select-p="0"] .tree-icon')).toHaveText('');
  await expect(page.locator('[data-select-p="1"] .tree-icon')).toHaveText('▣');
  await expect(page.locator('[data-select-f="0:0"]')).not.toContainText('🚀');
  await expect(page.locator('[data-select-f="0:0"] .phase-icon')).toHaveText('↳');
  await expect(phaseBarLabel(page)).toHaveText(model.projects[0].phases[0].label);
  for (const mode of ['simple']) {
    await show(page, mode);
    expect((await projectGroup(page).locator('[data-role="project-icon"]').allTextContents()).join('')).toBe('');
    const automatic = page.locator('.infographic-preview [data-project-id="icons-project-1"] [data-role="project-icon"]');
    await expect(automatic).toHaveCount(1);
    await expect(automatic).toContainText('▣');
    await expect(phaseGroup(page).locator('[data-role="phase-icon"]')).toHaveCount(0);
    await expect(phaseGroup(page).locator('[data-role="phase-label"]')).toHaveText(model.projects[0].phases[0].label);
  }
  await page.locator('[data-select-p="1"]').click();
  await expect(iconInput(page)).toHaveValue('');
  await expect(page.locator('.icon-preview')).toHaveText('▣');
  await expect(iconOption(page, '▣')).toHaveAttribute('aria-pressed', 'true');
  expect(await draft(page)).toEqual(expected);
  expect(await savedJson(page)).toEqual(expected);
  await page.reload();
  expect(await draft(page)).toEqual(expected);
  await expect(page.locator('[data-select-p="0"] .tree-icon')).toHaveText('');
});

test('custom multi-codepoint emoji remain intact in inputs, previews, model metadata, and every applicable chart', async ({ page }) => {
  const model = await mount(page);
  const phaseIcon = '🧑🏽‍🚀', projectIcon = '👩🏽‍💻🛰️';
  await setCustomIcon(page, phaseIcon);
  await expectPhaseIcon(page, phaseIcon, model.projects[0].phases[0].label);
  await page.locator('[data-select-p="0"]').click();
  await setCustomIcon(page, projectIcon);
  await expectProjectIcon(page, projectIcon);
  const expected = structuredClone(model);
  expected.projects[0].icon = projectIcon;
  expected.projects[0].locks.icon = true;
  expected.projects[0].phases[0].icon = phaseIcon;
  expected.projects[0].phases[0].locks.icon = true;
  expect(await draft(page)).toEqual(expected);
  expect(await savedJson(page)).toEqual(expected);
  await page.reload();
  expect(await draft(page)).toEqual(expected);
  await expect(page.locator('.icon-preview')).toHaveText(phaseIcon);
});

test('both SVG downloads contain chart data and no development', async ({ page }, info) => {
  const model = await mount(page);
  for (const mode of ['timeline', 'simple']) {
    await show(page, mode);
    const file = await download(page, 'svg');
    await file.saveAs(info.outputPath(`${mode}-clean.svg`));
    const xml = await readFile(await file.path(), 'utf8');
    const content = await page.evaluate(body => {
      const svg = new DOMParser().parseFromString(body, 'image/svg+xml');
      return { errors: svg.querySelectorAll('parsererror').length, legends: svg.querySelectorAll('[data-role="legend"]').length, text: [...svg.querySelectorAll('text,title,desc')].map(node => node.textContent).join('\n') };
    }, xml);
    expect(content.errors).toBe(0);
    expect(content.legends).toBe(0);
    expect(content.text).not.toMatch(technicalCopy);
    expect(content.text).toContain(model.projects[0].phases[0].label);
    expect(await draft(page)).toEqual(model);
  }
});
