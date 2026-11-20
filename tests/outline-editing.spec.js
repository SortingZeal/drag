import { test, expect } from './audit-fixture.js';
import { clickAction } from './global-actions.js';

const task = (page, pi, fi) => page.locator(`[data-select-f="${pi}:${fi}"]`);
const project = (page, pi) => page.locator(`[data-select-p="${pi}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const selected = page => page.locator('#tree [aria-selected="true"]');

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await expect(task(page, 0, 0)).toBeVisible();
});

test('outline double-click and F2 rename in place, with cancel and reversible history', async ({page}) => {
  const row = task(page, 0, 0), label = row.locator('.tree-label');
  const before = await draft(page);
  await label.dblclick();
  const input = row.locator('.outline-rename');
  await expect(input).toBeFocused();
  await input.fill('Rename the selected task');
  await input.press('Enter');
  await expect(label).toHaveText('Rename the selected task');
  const expected = structuredClone(before), item = expected.projects[0].phases[0];
  item.label = 'Rename the selected task';
  item.locks = {...item.locks, label:true};
  expect(await draft(page)).toEqual(expected);
  await row.press('F2');
  await input.fill('Discard me');
  await input.press('Escape');
  await expect(label).toHaveText(item.label);
  await expect(row).toBeFocused();
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(before);
  await clickAction(page, 'redo');
  expect(await draft(page)).toEqual(expected);
});

test('moving to another project keeps the inspected task selected across undo and redo', async ({page}) => {
  const before = await draft(page), source = before.projects[0].phases[0];
  const last = before.projects[1].phases.length;
  await task(page, 0, 0).click();
  await page.locator('[data-outline-parent]').selectOption('1');
  const expected = structuredClone(before), moved = expected.projects[0].phases.shift();
  moved.locks = {...moved.locks, parent:true};
  expected.projects[1].phases.push(moved);
  expect(await draft(page)).toEqual(expected);
  await expect(selected(page)).toHaveAttribute('data-select-f', `1:${last}`);
  await clickAction(page, 'undo');
  expect(await draft(page)).toEqual(before);
  await expect(selected(page)).toHaveAttribute('data-select-f', '0:0');
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue(source.label);
  await clickAction(page, 'redo');
  await expect(selected(page)).toHaveAttribute('data-select-f', `1:${last}`);
  await page.locator('[data-outline-close]').click();
  await expect(selected(page)).toBeFocused();
});

test('outline keys navigate, fold and move tasks without a pointer', async ({page}) => {
  const group = project(page, 0), first = task(page, 0, 0);
  await group.focus();
  await group.press('ArrowLeft');
  await expect(first).toBeHidden();
  await group.press('ArrowRight');
  await expect(first).toBeVisible();
  await group.press('ArrowRight');
  await expect(first).toBeFocused();
  await expect(page.locator('.bottom')).toBeHidden();
  await first.press('Enter');
  await expect(page.locator('.bottom')).toBeVisible();
  const initial = await draft(page);
  await first.press('Alt+ArrowDown');
  await expect(task(page, 0, 1)).toBeFocused();
  expect((await draft(page)).projects[0].phases[1].id).toBe(initial.projects[0].phases[0].id);
  await page.keyboard.press('Escape');
  await expect(page.locator('.bottom')).toBeHidden();
  await expect(task(page, 0, 1)).toBeFocused();
});

test('chart selection respects a closed inspector and folding returns focus to a visible parent', async ({page}) => {
  const drawer = page.locator('.bottom'), row = task(page, 0, 0), group = project(page, 0);
  const bar = page.locator('.bar-wrapper .handle.left').first();
  await expect(drawer).toBeHidden();
  await bar.click();
  await expect(drawer).toBeHidden();
  await row.click();
  await expect(drawer).toBeVisible();
  await group.locator('.outline-fold').click();
  await expect(row).toBeHidden();
  await page.locator('[data-outline-close]').click();
  await expect(group).toBeFocused();
  await expect(page.locator('#tree .tree-item:visible[tabindex="0"]')).toHaveCount(1);
  await group.press('ArrowDown');
  await expect(project(page, 1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#tree .tree-item').last()).toBeFocused();
  await page.keyboard.press('Enter');
  const box = await drawer.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.locator('[data-outline-close]').click();
  await expect(page.locator('#tree .tree-item').last()).toBeFocused();
  await bar.click();
  await expect(drawer).toBeHidden();
});
