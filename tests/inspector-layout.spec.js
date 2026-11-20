import { globalClick, clickAction } from './global-actions.js';
import {test,expect} from './audit-fixture.js';
const action=(page,name)=>page.locator(`[data-action="${name}"]`);
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));

test('compact icon picker exposes all choices on demand while preserving the model and undo',async({page})=>{
 await page.goto('/');await expect(action(page,'newproject')).toBeEnabled();await page.locator('[data-select-f="0:0"]').click();const initial=await draft(page);
 await expect(page.locator('.icon-picker')).not.toHaveAttribute('open','');await expect(page.locator('.icon-options')).toBeHidden();
 await page.locator('.icon-picker summary').click();await expect(page.locator('.icon-options')).toBeVisible();await expect(page.locator('.icon-options button')).toHaveCount(17);expect(await draft(page)).toEqual(initial);
 await page.locator('[data-icon="🚀"]').click();expect((await draft(page)).projects[0].phases[0].icon).toBe('🚀');await expect(page.locator('.icon-picker')).toHaveAttribute('open','');
 await globalClick(page,'undo');expect(await draft(page)).toEqual(initial);await page.locator('.icon-picker summary').click();await expect(page.locator('.icon-options')).toBeHidden();expect(await draft(page)).toEqual(initial);
});

test('new workspace favours the canvas without overwriting a saved divider; dark inspector remains readable',async({page})=>{
 await page.goto('/');await expect(action(page,'newproject')).toBeEnabled();await expect(page.locator('.bottom')).toBeHidden();
 await page.evaluate(()=>localStorage.setItem('drag.paneHeight','43'));await page.reload();await page.locator('[data-select-f="0:0"]').click();expect(await page.evaluate(()=>localStorage.getItem('drag.paneHeight'))).toBe('43');
 await globalClick(page,'settings');await page.locator('[data-settings-category="interface"]').click();await page.locator('[data-pref="theme"]').selectOption('dark');await page.keyboard.press('Escape');
 const colors=await page.locator('#editor').evaluate(n=>({background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n.querySelector('.editor-title')).color}));expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');expect(colors.color).not.toBe(colors.background);
 await page.locator('.icon-picker summary').click();await expect(page.locator('.icon-options')).toBeVisible();
});

test('closing and reopening task properties preserves the canvas and draft in both views',async({page})=>{
 await page.goto('/');await expect(action(page,'newproject')).toBeEnabled();await page.locator('[data-select-f="0:0"]').click();const initial=await draft(page);
 for(const mode of ['timeline', 'simple']){
  await clickAction(page, mode);
  const before=await page.locator('.preview').boundingBox();
  await page.locator('[data-outline-close]').click();
  await expect(page.locator('.bottom')).toBeHidden();
  expect(await page.locator('.preview').boundingBox()).toEqual(before);
  await expect(action(page,'svg')).toBeEnabled();
  expect(await draft(page)).toEqual(initial);
  await page.locator('[data-select-f="0:0"]').click();
  await expect(page.locator('.bottom')).toBeVisible();
  expect(await page.locator('.preview').boundingBox()).toEqual(before);
 }
 expect(await page.evaluate(()=>localStorage.getItem('drag.paneHeight'))).toBeNull();await expect(action(page,'undo')).toBeDisabled();expect(await draft(page)).toEqual(initial);
});

test('keyboard users can expand the palette, choose an icon, and return to the inspector',async({page})=>{
 await page.goto('/');await expect(action(page,'newproject')).toBeEnabled();await page.locator('[data-select-f="0:0"]').click();const summary=page.locator('.icon-picker summary');await summary.focus();await page.keyboard.press('Enter');await expect(page.locator('.icon-options')).toBeVisible();
 const choice=page.getByRole('button',{name:'星星',exact:true});await choice.focus();await page.keyboard.press('Enter');expect((await draft(page)).projects[0].phases[0].icon).toBe('★');
 const row=page.locator('[data-select-f="0:0"]');
 await page.getByRole('button',{name:'關閉屬性'}).press('Enter');
 await expect(page.locator('.bottom')).toBeHidden();
 await expect(row).toBeFocused();
 await row.press('Enter');
 await expect(page.locator('.bottom')).toBeVisible();
 await expect(page.locator('#editor [data-field="label"]')).toHaveValue((await draft(page)).projects[0].phases[0].label);
});
