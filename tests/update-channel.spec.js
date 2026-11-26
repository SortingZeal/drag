import { globalClick } from './global-actions.js';
import {test,expect} from './audit-fixture.js';

const updateButton=page=>page.locator('[data-settings-action="get-update"]');
async function about(page,label='重新載入網頁'){
 await globalClick(page,'settings');
 await page.locator('[data-settings-category="about"]').click();
 await expect(updateButton(page)).toHaveText(label);
}
const draft=page=>page.evaluate(()=>localStorage.getItem('drag.draft'));

test('web update reloads the site without opening GitHub or editing documents',async({page,context},info)=>{
 const externalRequests=[];
 await context.route('https://github.com/**',route=>{externalRequests.push({url:route.request().url(),referer:route.request().headers().referer||null});return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Release route test</title>'});});
 await page.goto('/');await expect.poll(()=>draft(page)).not.toBeNull();const original=await draft(page);await about(page);
 await expect(page.locator('.settings-about')).toContainText('Frappe Gantt');
 const currentURL=page.url();await Promise.all([page.waitForEvent('load'),updateButton(page).click()]);
 expect(page.url()).toBe(currentURL);expect(context.pages()).toHaveLength(1);expect(externalRequests).toEqual([]);
 expect(await draft(page)).toBe(original);await expect(page.locator('[data-action="undo"]')).toBeDisabled();
 await about(page);await page.screenshot({path:info.outputPath('about-web-reload.png'),fullPage:true});
});

test('desktop About uses the zero-argument bridge and recovers from an open failure without a web fallback',async({page})=>{
 await page.goto('/');await expect.poll(()=>draft(page)).not.toBeNull();const original=await draft(page);
 await page.evaluate(()=>{
  window.updateCalls=[];window.unexpectedWebOpens=[];
  window.open=(...args)=>window.unexpectedWebOpens.push(args);
  window.dragDesktop={captureShortcuts:async()=>{},info:async()=>({dataPath:'test-profile'}),openUpdates:async(...args)=>{window.updateCalls.push(args);if(window.updateCalls.length===1)throw Error('無法開啟更新頁面');}};
 });
 await about(page,'取得新版');await updateButton(page).click();await expect(page.locator('#settings-error')).toHaveText('無法開啟更新頁面');await expect(updateButton(page)).toBeEnabled();
 await updateButton(page).click();await expect(page.locator('#settings-error')).toBeHidden();await expect(updateButton(page)).toBeEnabled();
 expect(await page.evaluate(()=>window.updateCalls)).toEqual([[],[]]);expect(await page.evaluate(()=>window.unexpectedWebOpens)).toEqual([]);
 await expect(page.locator('#settings-data-path')).toHaveText('test-profile');await expect(page.locator('[data-settings-action="open-data"]')).toBeVisible();
 expect(await draft(page)).toBe(original);await page.keyboard.press('Escape');await expect(page.locator('[data-action="undo"]')).toBeDisabled();
});
