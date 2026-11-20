import { globalClick as currentGlobalClick } from './global-actions.js';

// Older packages expose actions directly on the toolbar.
async function globalClick(page, command) {
 if (await page.locator('[data-action="global-menu"]').count()) return currentGlobalClick(page, command);
 await page.locator(`[data-action="${command}"]`).click();
}
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron} from 'playwright';
import {expect} from '@playwright/test';

// Both executables must be released packages. A same-version repackage has a
// separate assertion so it is never reported as a cross-version upgrade.
const sameVersionReplacement=process.env.DRAG_SAME_VERSION_REPLACEMENT==='1';
test(sameVersionReplacement?'released data survives same-version package replacement':'previous released data upgrades to the new packaged app with complete documents, preferences and backups',{timeout:120000},async t=>{
 const oldPath=process.env.DRAG_PREVIOUS_EXECUTABLE,newPath=process.env.DRAG_DESKTOP_EXECUTABLE,previousVersion=process.env.DRAG_PREVIOUS_VERSION;
 assert.ok(oldPath && newPath && previousVersion, 'Provide both package executables and DRAG_PREVIOUS_VERSION');
 const directory=await mkdtemp(path.join(os.tmpdir(),'drag-upgrade-')),profile=path.join(directory,'profile');let app;
 t.after(async()=>{if(app)await app.close();await rm(directory,{recursive:true,force:true});});
 const launch=async executablePath=>{
  app=await electron.launch({executablePath,args:['--user-data-dir='+profile],timeout:30000});
  const page=await app.firstWindow(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try{await expect(page.locator('[data-action="newproject"]')).toBeVisible({timeout:20000});}
  catch(error){
   const state=await Promise.allSettled([
    page.evaluate(()=>({url:location.href,readyState:document.readyState,body:document.body?.innerText.slice(0,600)})),
    app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({url:window.webContents.getURL(),title:window.getTitle(),visible:window.isVisible()}))),
   ]);
   t.diagnostic(JSON.stringify({stage:'launch',state:state.map(item=>item.status==='fulfilled'?item.value:String(item.reason)),errors}));
   throw error;
  }
  if(await page.locator('#quick-tour').isVisible())await page.locator('[data-tour-action="skip"]').click();
  return page;
 };
 let page=await launch(oldPath);assert.equal((await page.evaluate(()=>window.dragDesktop.info())).version,previousVersion);
 const model=JSON.parse(await readFile(new URL('../public/roadmap.json',import.meta.url),'utf8'));model.title='升級保留的圖表';model.presentation={title:'保留的圖片呈現',start:'2027-01-01',end:'2028-06-30',dateLineMode:'custom',dateLineDate:'2027-07-01',locks:{title:true,start:true}};model.metadata={nested:['保留',{value:31}]};model.projects[0].locks={name:true,color:true};model.projects[0].phases[0].locks={start:true,end:true,label:true};
 const pending=page.waitForEvent('filechooser');await globalClick(page,'import');await(await pending).setFiles({name:'升級測試.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(model))});await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')))).toEqual(model);
 const id=await page.locator('#document-select').inputValue(),hadPresentation=await page.locator('[data-action="infographic"]').count()>0;await globalClick(page,'settings');await page.locator('button[data-ui-size="small"]').click();await page.locator('[data-settings-category="workspace"]').click();await page.locator('[data-pref="startupMode"]').selectOption(hadPresentation?'infographic':'simple');await page.locator('[data-pref="rememberPictures"]').check();await page.locator('[data-settings-category="storage"]').click();await page.locator('[data-pref="autoBackup"]').uncheck();await page.locator('[data-settings-action="backup"]').click();await expect.poll(()=>page.locator('.backup-row').count()).toBeGreaterThanOrEqual(1);await page.keyboard.press('Escape');
 await page.locator(hadPresentation?'[data-action="infographic"]':'[data-action="simple"]').click();
 const before=await page.evaluate(async id=>({record:JSON.parse(localStorage.getItem('drag.documentDraft')).record,preferences:localStorage.getItem('drag.preferences'),backups:await window.dragDesktop.listBackups(id,false),files:[...document.querySelectorAll('#document-select option')].map(node=>({id:node.value,name:node.textContent}))}),id);
 await app.close();app=null;page=await launch(newPath);const currentVersion=(await page.evaluate(()=>window.dragDesktop.info())).version;
 if(sameVersionReplacement)assert.equal(currentVersion,previousVersion);
 else assert.notEqual(currentVersion,previousVersion);
 const after=await page.evaluate(async id=>({record:JSON.parse(localStorage.getItem('drag.documentDraft')).record,preferences:localStorage.getItem('drag.preferences'),backups:await window.dragDesktop.listBackups(id,false),files:[...document.querySelectorAll('#document-select option')].map(node=>({id:node.value,name:node.textContent}))}),id);
 assert.equal(after.record.id,id);assert.equal(after.record.name,before.record.name);assert.equal(after.record.body,before.record.body);const expectedPreferences=JSON.parse(before.preferences);if(expectedPreferences.values.startupMode==='infographic')expectedPreferences.values.startupMode='simple';delete expectedPreferences.values.shortcuts.infographic;if(!Object.hasOwn(expectedPreferences.values,'language'))expectedPreferences.values.language='zh-TW';for (const [key, value] of Object.entries({palette:'jade',typeface:'system',canvasSurface:'dots'})) {
  if (!Object.hasOwn(expectedPreferences.values,key)) expectedPreferences.values[key]=value;
 }
 assert.deepEqual(JSON.parse(after.preferences),expectedPreferences);await expect(page.locator('[data-action="simple"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-action="infographic"]')).toHaveCount(0);await expect(page.locator('.roadmap-simple')).toBeVisible();assert.deepEqual(after.backups,before.backups);assert.deepEqual(after.files,before.files);await expect(page.locator('#app')).toHaveAttribute('data-ui-size','small');
 const backup=await page.evaluate(async({backupId,id})=>JSON.parse(await window.dragDesktop.readBackup(backupId,id,false)),{backupId:before.backups[0].id,id});assert.deepEqual(backup,model);
 t.diagnostic(JSON.stringify({transition:sameVersionReplacement?'same-version-replacement':'cross-version-upgrade',from:previousVersion,to:currentVersion,files:after.files.length,backups:after.backups.length,exactBody:true,preferencesPreservedExceptRetiredMode:true,retiredModeMigrated:hadPresentation}));
});
