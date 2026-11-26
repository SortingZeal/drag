import { openVisiblePictureTask } from './picture-selection.js';
import { globalClick, clickAction, openViewOptions, documentItems, currentDocument, chooseDocument } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const action = (page, name) => page.locator(`[data-action="${name}"]`);
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const journal = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.documentDraft')));
const active = page => currentDocument(page).getAttribute('data-document-id');
function fixture(title = '保留原始時間軸') {
 const model = structuredClone(seed);model.title = title;model.metadata = { keep: ['自訂', { value: 71 }] };model.locks = { title: true };
 model.projects[0].locks = { color: true, name: true };model.projects[0].phases[0].locks = { start: true, label: true };
 return model;
}
async function mount(page,model = fixture()) {
 await page.addInitScript(model => {
  if(localStorage.getItem('documents.fixture'))return;
  localStorage.setItem('drag.draft', JSON.stringify(model));
  localStorage.setItem('drag.preferences', JSON.stringify({ version:1,values:{autoBackup:false} }));
  localStorage.setItem('documents.fixture','1');
 },model);
 await page.goto('/');await expect(page.locator('[data-action=document-menu]')).toBeVisible();
 await expect(action(page,'newproject')).toBeEnabled();expect(await draft(page)).toEqual(model);return model;
}
async function ready(page) { await expect(page.locator('#app')).not.toHaveAttribute('inert',''); }
async function create(page,name) {
 await clickAction(page, 'newdocument');await page.locator('#document-name').fill(name);await page.locator('#document-dialog button[type=submit]').click();
 await expect.poll(()=>currentDocument(page).textContent()).toBe(name);await ready(page);return active(page);
}
async function select(page,id) {
 await chooseDocument(page,id);
 await expect.poll(async()=>(await journal(page)).record.id).toBe(id);await ready(page);
}
async function open(page,model,name='外部時間軸.json') {
 const pending=page.waitForEvent('filechooser');await globalClick(page,'import');
 await(await pending).setFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(model))});
 await expect.poll(()=>draft(page)).toEqual(model);await ready(page);return active(page);
}
async function edit(page,label) {
 await page.locator('[data-select-f="0:0"]').click();
 const field=page.locator('#editor [data-field="label"]');await field.fill(label);await field.press('Tab');await field.blur();
 await expect.poll(async()=>(await draft(page)).projects[0].phases[0].label).toBe(label);
}
async function download(page,name) {const pending=page.waitForEvent('download');await clickAction(page, name);const file=await pending;return readFile(await file.path());}
async function db(page,callback,arg) {
 return page.evaluate(async({callback,arg})=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('drag-documents',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=database.transaction(['documents','meta'],'readwrite');let value;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);
   if(callback==='stale'){const r=tx.objectStore('documents').get(arg.id);r.onsuccess=()=>{r.result.body=JSON.stringify(arg.model);tx.objectStore('documents').put(r.result);};}
   if(callback==='recovery'){const r=tx.objectStore('meta').get('recovered-journal');r.onsuccess=()=>{value=r.result?.value;};}
  });}finally{database.close();}
 },{callback,arg});
}

test('legacy draft migrates once with exact metadata and locks; new files stay independent after restart',async({page})=>{
 const original=await mount(page),first=await active(page);await expect(documentItems(page)).toHaveCount(1);
 const second=await create(page,'第二份時間軸');expect(second).not.toBe(first);expect((await draft(page)).projects).toEqual([]);
 await clickAction(page, 'newproject');await clickAction(page, 'newphase');await edit(page,'第二份的任務');const changed=await draft(page);
 await select(page,first);expect(await draft(page)).toEqual(original);await expect(action(page,'undo')).toBeDisabled();
 await select(page,second);expect(await draft(page)).toEqual(changed);await page.reload();await expect(documentItems(page)).toHaveCount(2);expect(await active(page)).toBe(second);expect(await draft(page)).toEqual(changed);
 await select(page,first);expect(await draft(page)).toEqual(original);
});

test('opening JSON adds a separate file, permits shared model IDs, and keeps undo/redo inside each file',async({page})=>{
 const original=await mount(page),first=await active(page);await edit(page,'第一份的修改');const edited=await draft(page);
 const incoming=fixture('第二份原始資料');incoming.projects[0].phases[0].label='第二份初始';const second=await open(page,incoming);
 await expect(documentItems(page)).toHaveCount(2);await expect(action(page,'undo')).toBeDisabled();await edit(page,'第二份修改');
 await globalClick(page,'undo');expect(await draft(page)).toEqual(incoming);await expect(action(page,'redo')).toBeEnabled();
 await select(page,first);expect(await draft(page)).toEqual(edited);await expect(action(page,'redo')).toBeDisabled();
 await globalClick(page,'undo');expect(await draft(page)).toEqual(original);
 await select(page,second);await globalClick(page,'redo');expect((await draft(page)).projects[0].phases[0].label).toBe('第二份修改');
});

test('cancelled creation and invalid JSON leave every file, model and history untouched',async({page})=>{
 const original=await mount(page),first=await active(page);await clickAction(page, 'newdocument');await page.locator('[data-document-action=cancel]').click();await expect(documentItems(page)).toHaveCount(1);expect(await draft(page)).toEqual(original);
 await create(page,'保留空白檔');const second=await active(page),empty=await draft(page);
 const error=page.waitForEvent('dialog');const chooser=page.waitForEvent('filechooser');await globalClick(page,'import');await(await chooser).setFiles({name:'錯誤.json',mimeType:'application/json',buffer:Buffer.from('{bad')});const dialog=await error;expect(dialog.message()).toContain('開啟失敗');await dialog.accept();
 await expect(documentItems(page)).toHaveCount(2);expect(await active(page)).toBe(second);expect(await draft(page)).toEqual(empty);await expect(action(page,'undo')).toBeDisabled();
 await select(page,first);expect(await draft(page)).toEqual(original);
});

test('each file exports only its own original JSON and vector content',async({page})=>{
 const original=await mount(page),first=await active(page);const incoming=fixture('另一份的圖面');incoming.projects=incoming.projects.slice(0,1);incoming.projects[0].phases=incoming.projects[0].phases.slice(0,1);incoming.projects[0].phases[0].label='獨立向量任務';
 await open(page,incoming);expect(JSON.parse(await download(page,'save'))).toEqual(incoming);
 await clickAction(page, 'simple');const vector=(await download(page,'svg')).toString();expect(vector).toContain('獨立向量任務');expect(vector).not.toContain('drag.documentDraft');
 await select(page,first);expect(JSON.parse(await download(page,'save'))).toEqual(original);await clickAction(page, 'simple');const firstVector=(await download(page,'svg')).toString();expect(firstVector).not.toContain('獨立向量任務');
});

test('picture display settings stay inside their file and do not alter tasks or global preferences',async({page})=>{
 const original=await mount(page),first=await active(page);
 const preferences=await page.evaluate(()=>localStorage.getItem('drag.preferences'));
 await clickAction(page, 'simple');
 await openViewOptions(page);await page.locator('#report-title').fill('第一份圖片標題');await page.locator('#report-title').press('Tab');
 await page.locator('.align-start summary').click();await page.locator('#align-mode').selectOption('date');await page.locator('#align-start-date').fill('2030-01-01');await page.locator('#align-start-apply').click();
 const firstPicture=await draft(page);expect(firstPicture.title).toBe(original.title);expect(firstPicture.projects).toEqual(original.projects);expect(firstPicture.presentation.title).toBe('第一份圖片標題');
 const second=await create(page,'第二份工作區');await clickAction(page, 'newproject');
 expect((await draft(page)).presentation).toBeUndefined();
 await select(page,first);expect(await draft(page)).toEqual(firstPicture);await expect(page.locator('#report-title')).toHaveValue('第一份圖片標題');
 await select(page,second);expect((await draft(page)).presentation).toBeUndefined();
 expect(await page.evaluate(()=>localStorage.getItem('drag.preferences'))).toBe(preferences);
});

test('view modes, picture zoom and project selection return independently for each file',async({page})=>{
 await mount(page);const first=await active(page);await clickAction(page, 'simple');await page.locator('[data-picture-action="actual"]').click();await page.locator('[data-picture-action="zoom-in"]').click();
 const second=await create(page,'另一個視角');await expect(action(page,'timeline')).toHaveAttribute('aria-selected','true');await clickAction(page, 'newproject');
 await select(page,first);await expect(action(page,'simple')).toHaveAttribute('aria-selected','true');await expect(page.locator('[data-picture-zoom]')).toHaveText('110%');await expect(page.locator('#editor')).toBeHidden();await openVisiblePictureTask(page);await expect(page.locator('#editor [data-field="label"]')).toBeVisible();
 await select(page,second);await expect(action(page,'timeline')).toHaveAttribute('aria-selected','true');await expect(page.locator('#editor [data-field="name"]')).toHaveValue('新專案');
});

test('a durable current-file journal recovers the latest edit over an older database snapshot',async({page})=>{
 const original=await mount(page),id=await active(page);await edit(page,'已寫入草稿的新內容');const edited=await draft(page);
 await db(page,'stale',{id,model:original});await page.reload();await expect(page.locator('[data-action=document-menu]')).toBeVisible();expect(await draft(page)).toEqual(edited);expect(await active(page)).toBe(id);
});

test('corrupt journal is retained for recovery and never replaces valid saved documents',async({page})=>{
 const original=await mount(page);await page.evaluate(()=>localStorage.setItem('drag.documentDraft','{unreadable'));
 const warning=page.waitForEvent('dialog');const navigation=page.reload();const dialog=await warning;expect(dialog.message()).toContain('原始內容已保留');await dialog.accept();await navigation;
 expect(await draft(page)).toEqual(original);expect(await db(page,'recovery')).toBe('{unreadable');await expect(documentItems(page)).toHaveCount(1);
});

test('journal quota failure rejects the edit and prevents a file switch from losing the existing model',async({page})=>{
 const original=await mount(page),first=await active(page),second=await create(page,'容量測試的另一份');await select(page,first);await page.evaluate(()=>{window.originalDocumentSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='drag.documentDraft')throw new DOMException('容量不足','QuotaExceededError');return window.originalDocumentSet.call(this,key,value);};});
 await page.locator('[data-select-f="0:0"]').click();
 const messages=[];page.once('dialog',async dialog=>{messages.push(dialog.message());await dialog.accept();});const field=page.locator('#editor [data-field="label"]');await field.fill('不能保存的修改');await field.press('Tab');expect(messages[0]).toContain('無法儲存變更');
 expect(await draft(page)).toEqual(original);await expect(action(page,'undo')).toBeDisabled();await expect(page.locator('#editor [data-field="label"]')).toHaveValue(original.projects[0].phases[0].label);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('無法開啟時間軸檔案');await dialog.accept();});await chooseDocument(page,second);await expect(page.locator('[data-action=document-menu]')).toHaveAttribute('data-active-id',first);expect(await draft(page)).toEqual(original);
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalDocumentSet;});await select(page,second);expect((await draft(page)).projects).toEqual([]);
});

test('backup lists and retention belong to the selected timeline file',async({page})=>{
 const original=await mount(page),first=await active(page);
 const backup=async()=>{await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await page.locator('[data-settings-action="backup"]').click();await expect(page.locator('.backup-row')).toHaveCount(1);await page.keyboard.press('Escape');};
 await backup();const second=await create(page,'另一份備份');await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row')).toHaveCount(0);await page.keyboard.press('Escape');await backup();
 await select(page,first);await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row b')).toHaveText(original.title);await page.keyboard.press('Escape');
 await select(page,second);await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row b')).toHaveText('另一份備份');
});

for(const uiSize of ['small','medium','large'])test(`file controls stay in the header when the outline floats at ${uiSize} size`,async({page},info)=>{
 await mount(page);await page.setViewportSize({width:1024,height:700});await globalClick(page,'settings');await page.locator(`button[data-ui-size="${uiSize}"]`).click();await page.keyboard.press('Escape');
 const title=await page.locator('.aside-title').boundingBox(),main=await page.locator('main').boundingBox();await page.mouse.move(title.x+30,title.y+title.height/2);await page.mouse.down();await page.mouse.move(main.x+300,main.y+90,{steps:6});await page.mouse.up();
 await expect(page.locator('aside')).toHaveClass(/is-floating/);await create(page,'浮動中的檔案');await expect(documentItems(page)).toHaveCount(2);
 const header=page.locator('header');
 const library=header.locator('.document-picker > button');
 await expect(library).toHaveCount(1);await expect(library).toBeInViewport();
 await action(page,'document-menu').click();await expect(page.locator('#document-menu')).toBeInViewport();
 await page.keyboard.press('Escape');await expect(header.locator('[data-action=document-menu]')).toBeFocused();
 await page.screenshot({path:info.outputPath(`documents-${uiSize}.png`)});
});

test('pre-existing unscoped backups remain available only to the migrated original file',async({page})=>{
 const original=await mount(page),first=await active(page);
 await page.evaluate(async model=>{
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('drag-backups',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=database.transaction('snapshots','readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.objectStore('snapshots').put({id:crypto.randomUUID(),createdAt:Date.now(),title:'移轉前的備份',projects:model.projects.length,tasks:15,reason:'manual',body:JSON.stringify(model)});});database.close();
 },original);
 await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row b')).toHaveText('移轉前的備份');await page.locator('[data-backup-preview]').click();await expect(page.locator('#backup-preview')).toContainText(original.projects[0].name);await page.keyboard.press('Escape');
 await create(page,'新的檔案不共用舊備份');await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row')).toHaveCount(0);await page.keyboard.press('Escape');
 await select(page,first);await page.reload();await expect(page.locator('[data-action=document-menu]')).toHaveAttribute('data-active-id',first);await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row b')).toHaveText('移轉前的備份');
});

test('reopening a same-named file keeps both copies distinguishable without changing the JSON title',async({page})=>{
 await mount(page);const incoming=fixture('保持原始標題');const first=await open(page,incoming,'同名檔案.json');await edit(page,'第一個副本');const edited=await draft(page);const second=await open(page,incoming,'同名檔案.json');expect(second).not.toBe(first);await expect(currentDocument(page)).toHaveText('同名檔案（2）');expect(await draft(page)).toEqual(incoming);await select(page,first);expect(await draft(page)).toEqual(edited);
});

test('new-file dialog validates names, cancels with Escape and creates with Enter',async({page})=>{
 const original=await mount(page);await clickAction(page, 'newdocument');await expect(page.locator('#document-dialog')).toBeVisible();await page.locator('#document-name').fill('   ');await page.locator('#document-name').press('Enter');await expect(page.locator('#document-dialog')).toBeVisible();await expect(documentItems(page)).toHaveCount(1);
 await page.keyboard.press('Escape');await expect(page.locator('#document-dialog')).not.toBeVisible();expect(await draft(page)).toEqual(original);await clickAction(page, 'newdocument');await page.locator('#document-name').fill('鍵盤建立時間軸');await page.locator('#document-name').press('Enter');await expect(currentDocument(page)).toHaveText('鍵盤建立時間軸');expect((await draft(page)).projects).toEqual([]);
});

test('workspace titles support keyboard editing, composition, undo and switching files', async ({page}) => {
 const model=fixture();model.locks={notes:true};
 const initial=await mount(page,model),first=await active(page);
 const title=page.locator('.workspace-title'), input=page.locator('.workspace-title-input'), file=currentDocument(page);
 const filename=await file.innerText();
 await title.focus();await page.keyboard.press('Enter');await expect(input).toBeFocused();
 await input.fill('取消的變更');await input.press('Escape');await expect(title).toBeFocused();expect(await draft(page)).toEqual(initial);
 await title.click();await input.fill('產品工作區');
 await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(input).toBeFocused();
 expect(await draft(page)).toEqual(initial);
 await input.press('Enter');await expect(title).toBeFocused();await expect(title).toHaveText('產品工作區');
 expect(await draft(page)).toEqual({...initial,title:'產品工作區',locks:{notes:true,title:true}});await expect(file).toHaveText(filename);
 await action(page,'undo').click();await expect(title).toHaveText(initial.title);
 await action(page,'redo').click();await expect(title).toHaveText('產品工作區');
 await title.click();await input.fill('交付時程');await action(page,'simple').click();
 await expect(page.locator('.picture-canvas svg [data-role=title]')).toHaveText('交付時程');
 await title.click();await input.fill('最終交付');await action(page,'document-menu').click();
 await expect(page.locator('#document-menu')).toBeVisible();
 await expect(page.locator('.picture-canvas svg [data-role=title]')).toHaveText('最終交付');
 await page.keyboard.press('Escape');
 await create(page,'新檔案');await expect(title).toHaveText('新檔案');
 await select(page,first);await expect(title).toHaveText('最終交付');
 await page.reload();await expect(title).toHaveText('最終交付');await expect(file).toHaveText(filename);
 await page.locator('#workspace-language').selectOption('en');
 await expect(title).toHaveAccessibleName('Edit workspace title · 最終交付');
 await expect(page.getByRole('button',{name:'Documents',exact:true})).toBeVisible();
});
