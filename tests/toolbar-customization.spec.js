import {test, expect} from '@playwright/test';

const tools = page => page.locator('[data-toolbar-layout]');
const grip = (page, key) => page.locator(`dialog[open] [data-toolbar-grip="${key}"]`);
const command = (page, key) => page.locator(`dialog[open] [data-toolbar-command="${key}"]`);
const order = page => tools(page).evaluate(node => [...node.children].map(child => child.dataset.toolbarKey || child.dataset.toolbarSpacing).filter(Boolean));
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.preferences')).values.toolbarLayout);

test.beforeEach(async ({page}) => {
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(() => localStorage.setItem('drag.onboarding',JSON.stringify({version:1,status:'completed'})));
  await page.goto('/');
  await expect(tools(page).locator(':scope > [data-toolbar-key]')).toHaveCount(7);
});

test('toolbar items reorder by drag while pages stay fixed, and layout survives a reload', async ({page}) => {
  const original = await order(page);
  const pageTabs = page.getByRole('button',{name:'時間軸',exact:true}).or(page.getByRole('tab',{name:'時間軸',exact:true}));
  const start = await pageTabs.boundingBox();
  await page.locator('[data-action="global-menu"]').click();
  await page.locator('[data-action="customize-toolbar"]').click();
  const first = original[0], last = original.at(-1);
  await expect(grip(page,last)).toBeVisible();
  await grip(page,last).dragTo(grip(page,first),{targetPosition:{x:2,y:8}});
  await expect.poll(() => order(page)).toEqual([last,...original.slice(0,-1)]);
  await command(page,'save').click();
  await expect(page.locator('.toolbar-editor')).toHaveCount(0);
  expect(await saved(page)).toEqual([last,...original.slice(0,-1)]);
  await page.reload();
  await expect.poll(() => order(page)).toEqual([last,...original.slice(0,-1)]);
  const after = await pageTabs.boundingBox();
  expect(Math.abs(after.x-start.x)).toBeLessThan(1);
  await page.locator('[data-action="global-menu"]').click();
  await expect(page.locator('[data-action="customize-toolbar"]')).toBeVisible();
});

test('toolbar keyboard editing adds, moves and removes spacing, cancels drafts, and restores defaults', async ({page}) => {
  const before = await order(page);
  const trigger = page.locator('[data-action="global-menu"]');
  await trigger.focus(); await trigger.press('Shift+F10');
  await expect(page.getByRole('dialog',{name:'自訂工具列'})).toBeVisible();
  await grip(page,'undo').focus();
  await command(page,'separator').click();
  await expect(grip(page,'separator')).toBeFocused();
  await grip(page,'separator').press('Home');
  await command(page,'space').click();
  expect((await order(page)).slice(0,2)).toEqual(['separator','space']);
  expect((await grip(page,'space').boundingBox()).width).toBeGreaterThan(80);
  await grip(page,'space').press('End');
  await grip(page,'space').press('Delete');
  expect(await order(page)).toEqual(['separator',...before]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.toolbar-editor')).toHaveCount(0);
  expect(await order(page)).toEqual(before);
  expect(await saved(page)).toEqual([]);
  await trigger.click({button:'right'});
  await command(page,'space').click();
  await command(page,'save').click();
  expect(await saved(page)).toContain('space');
  await trigger.click({button:'right'});
  await command(page,'default').click();
  await command(page,'cancel').click();
  expect(await order(page)).toContain('space');
  await trigger.click({button:'right'});
  await command(page,'default').click();
  await command(page,'save').click();
  await expect.poll(() => order(page)).toEqual(before);
  expect(await saved(page)).toEqual([]);
});

test('toolbar editor follows language and reduced-motion settings and keeps real tools available', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#workspace-language').selectOption('en');
  await page.locator('[data-action="global-menu"]').click({button:'right'});
  await expect(page.getByRole('dialog',{name:'Customize toolbar'})).toBeVisible();
  await expect(command(page,'space')).toHaveAccessibleName('Add flexible space');
  await grip(page,'more').focus();
  await expect(command(page,'remove')).toBeDisabled();
  expect(await tools(page).locator('[data-toolbar-key="more"]').evaluate(n=>getComputedStyle(n).animationName)).toBe('none');
  await grip(page,'more').press('Delete');
  expect(await order(page)).toContain('more');
  await command(page,'cancel').click();
});
