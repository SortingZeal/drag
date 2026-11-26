import { globalClick, clickAction, documentItems, currentDocument } from './global-actions.js';
import {test,expect} from './audit-fixture.js';
import {readFile} from 'node:fs/promises';
const seed=JSON.parse(await readFile(new URL('../public/roadmap.json',import.meta.url),'utf8'));
const action=(page,name)=>page.locator(`[data-action="${name}"]`);
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
const record=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.documentDraft')).record);
const name=page=>currentDocument(page).textContent();
const ready=page=>expect(page.locator('#app')).not.toHaveAttribute('inert','');
async function mount(page){
 const model=structuredClone(seed);model.metadata={keep:['個別資料',{n:91}]};model.locks={title:true};model.projects[0].phases[0].locks={start:true,label:true};
 await page.addInitScript(model=>{if(localStorage.getItem('lifecycle.fixture'))return;localStorage.setItem('lifecycle.fixture','1');localStorage.setItem('drag.draft',JSON.stringify(model));localStorage.setItem('drag.preferences',JSON.stringify({version:1,values:{autoBackup:false}}));},model);
 await page.goto('/');await expect(action(page,'newproject')).toBeEnabled();return model;
}
async function menu(page,command){await clickAction(page, 'document-menu');await page.locator(`[data-document-action="${command}"]`).click();}
async function rename(page,value){await menu(page,'rename');await page.locator('#document-name').fill(value);await page.locator('#document-dialog button[type=submit]').click();await ready(page);}
async function remove(page){await menu(page,'delete');await page.locator('#document-delete-dialog button[type=submit]').click();await ready(page);}
async function restore(page,id){await menu(page,'trash');await page.locator(`[data-document-restore="${id}"]`).click();await ready(page);}
async function create(page,value){await clickAction(page, 'newdocument');await page.locator('#document-name').fill(value);await page.locator('#document-dialog button[type=submit]').click();await expect.poll(()=>name(page)).toBe(value);await ready(page);return(await record(page)).id;}

test('rename preserves JSON title, metadata, locks and history; name survives reload and names the download',async({page})=>{
 await mount(page);const id=(await record(page)).id;
 await page.locator('[data-select-f="0:0"]').click();
 const field=page.locator('#editor [data-field="label"]');await field.fill('手動修改保留');await field.press('Tab');await expect(action(page,'undo')).toBeEnabled();const model=await draft(page);
 await rename(page,'新的時間軸檔名');await expect.poll(()=>name(page)).toBe('新的時間軸檔名');expect(await draft(page)).toEqual(model);expect((await record(page)).id).toBe(id);await expect(action(page,'undo')).toBeEnabled();
 const pending=page.waitForEvent('download');await globalClick(page,'save');const file=await pending;expect(file.suggestedFilename()).toBe('新的時間軸檔名.json');expect(JSON.parse(await readFile(await file.path(),'utf8'))).toEqual(model);
 await globalClick(page,'undo');expect((await draft(page)).projects[0].phases[0].label).not.toBe('手動修改保留');await globalClick(page,'redo');expect(await draft(page)).toEqual(model);
 await page.reload();await expect.poll(()=>name(page)).toBe('新的時間軸檔名');expect(await draft(page)).toEqual(model);
});

test('rename validates empty and duplicate names and both dialogs cancel without changes',async({page})=>{
 const model=await mount(page);await menu(page,'rename');await page.locator('#document-name').fill('  ');await page.locator('#document-name').press('Enter');await expect(page.locator('#document-dialog')).toBeVisible();await page.keyboard.press('Escape');expect(await draft(page)).toEqual(model);
 const originalName=await name(page);await create(page,'第二份');const before=await record(page);let message;page.once('dialog',async dialog=>{message=dialog.message();await dialog.accept();});await rename(page,originalName);await expect.poll(()=>message).toContain('相同名稱');expect(await record(page)).toMatchObject({id:before.id,name:'第二份',body:before.body});
 await menu(page,'delete');await page.locator('[data-document-action="cancel-delete"]').click();await expect(page.locator('#document-delete-dialog')).not.toBeVisible();await menu(page,'delete');await page.keyboard.press('Escape');await expect(documentItems(page)).toHaveCount(2);
});

test('delete switches file, keeps body and session undo, and restore after restart retains identity',async({page})=>{
 const original=await mount(page),first=(await record(page)).id;const second=await create(page,'第二份');await clickAction(page, 'newproject');const changed=await draft(page);await expect(action(page,'undo')).toBeEnabled();await remove(page);expect((await record(page)).id).toBe(first);expect(await draft(page)).toEqual(original);
 await restore(page,second);expect(await draft(page)).toEqual(changed);await expect(action(page,'undo')).toBeEnabled();await remove(page);await page.reload();await expect(action(page,'newproject')).toBeEnabled();await restore(page,second);expect((await record(page)).id).toBe(second);expect(await draft(page)).toEqual(changed);await expect(documentItems(page)).toHaveCount(2);
});

test('deleting the last file creates an empty file and duplicate restore names are distinct',async({page})=>{
 const model=await mount(page),first=await record(page);await remove(page);expect((await draft(page)).projects).toEqual([]);await expect(documentItems(page)).toHaveCount(1);expect((await record(page)).id).not.toBe(first.id);
 await rename(page,first.name);await restore(page,first.id);expect(await name(page)).toBe(first.name+'（2）');expect(await draft(page)).toEqual(model);await page.reload();await expect.poll(()=>name(page)).toBe(first.name+'（2）');expect((await record(page)).id).toBe(first.id);
});

for(const size of ['small','medium','large'])test(`document library stays in the viewport with a floating outline at ${size}`,async({page},info)=>{
 await mount(page);await page.setViewportSize({width:1024,height:700});await globalClick(page,'settings');await page.locator(`button[data-ui-size="${size}"]`).click();await page.keyboard.press('Escape');await expect(page.locator('#app')).toHaveAttribute('data-ui-size',size);
 const title=await page.locator('.aside-title').boundingBox(),main=await page.locator('main').boundingBox();await page.mouse.move(title.x+30,title.y+title.height/2);await page.mouse.down();await page.mouse.move(main.x+300,main.y+90,{steps:6});await page.mouse.up();await expect(page.locator('aside')).toHaveClass(/is-floating/);await clickAction(page, 'document-menu');const box=await page.locator('#document-menu').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(1024);expect(box.y+box.height).toBeLessThanOrEqual(700);
 await page.locator('[data-document-action="rename"]').focus();await page.keyboard.press('ArrowDown');await expect(page.locator('[data-document-action="delete"]')).toBeFocused();await page.keyboard.press('Escape');await expect(action(page,'document-menu')).toBeFocused();await rename(page,'可操作的檔案');await expect.poll(()=>name(page)).toBe('可操作的檔案');await menu(page,'delete');await page.screenshot({path:info.outputPath('file-delete-dialog.png')});await page.keyboard.press('Escape');
});

// Load the actual persistence module in a disposable browser origin, exercising
// real IndexedDB transactions and failure recovery without test code in dist.
async function library(page){
 const localeSource=await readFile(new URL('../src/i18n.js',import.meta.url),'utf8');
 await page.route('**/i18n.js',route=>route.fulfill({contentType:'text/javascript',body:localeSource}));
 const source=await readFile(new URL('../src/documents.js',import.meta.url),'utf8');
 await page.route('**/qa-documents.js',route=>route.fulfill({contentType:'text/javascript',body:source.replace("'./model.js'","'./qa-model.js'")}));
 const modelSource=await readFile(new URL('../src/model.js',import.meta.url),'utf8');
 await page.route('**/qa-model.js',route=>route.fulfill({contentType:'text/javascript',body:modelSource}));
 await page.goto('/');await expect(action(page,'newproject')).toBeEnabled();
 await page.evaluate(async seed=>{const {Documents}=await import('/qa-documents.js');window.qaStorage=new Map();const storage={getItem:k=>qaStorage.get(k)||null,setItem:(k,v)=>qaStorage.set(k,v),removeItem:k=>qaStorage.delete(k)};window.qaFiles=new Documents(storage);await qaFiles.open(seed);window.Documents=Documents;window.qaAdapter=storage;},seed);
}

test('saving an unchanged view skips the document journal and preserves subsequent changes', async ({page}) => {
  await library(page);
  const result = await page.evaluate(async () => {
    const writes = [];
    const setItem = qaAdapter.setItem.bind(qaAdapter);
    qaAdapter.setItem = (key, value) => { writes.push(key); setItem(key, value); };
    const first = {mode: 'timeline', selected: {project: 0, phase: 1}};
    qaFiles.saveView(first);
    await qaFiles.flush();
    const record = qaFiles.active;
    writes.length = 0;
    qaFiles.saveView(structuredClone(first));
    const repeatedWrites = [...writes];
    const sameRecord = record === qaFiles.active;
    const next = {...first, mode: 'simple'};
    qaFiles.saveView(next);
    await qaFiles.flush();
    return {sameRecord, repeatedWrites, persisted: JSON.parse(qaStorage.get('drag.documentDraft')).record.workspace};
  });
  expect(result.sameRecord).toBe(true);
  expect(result.repeatedWrites).toEqual([]);
  expect(result.persisted).toEqual({mode: 'simple', selected: {project: 0, phase: 1}});
});

test('stale journals and queued writes cannot resurrect deleted files or undo a rename',async({page})=>{
 await library(page);
 const result=await page.evaluate(async()=>{
  const f=qaFiles,original=structuredClone(f.active);await f.rename(original.id,'durable-name');qaStorage.set('drag.documentDraft',JSON.stringify({version:1,record:{...original,updatedAt:Date.now()+100000,body:JSON.stringify({title:'stale-body',projects:[]})}}));
  const reopened=new Documents(qaAdapter);await reopened.open({title:'seed',projects:[]});const renamed=structuredClone(reopened.active);await reopened.remove(original.id);qaStorage.set('drag.documentDraft',JSON.stringify({version:1,record:original}));const next=new Documents(qaAdapter);await next.open({title:'seed',projects:[]});let rejected=false;try{await next.enqueue(original);}catch{rejected=true;}return{renamed,original,live:next.list(),trash:next.trash(),rejected};
 });
 expect(result.renamed.name).toBe('durable-name');expect(result.renamed.body).toBe(result.original.body);expect(result.rejected).toBe(true);expect(result.live.some(file=>file.id===result.original.id)).toBe(false);expect(result.trash.map(file=>file.id)).toContain(result.original.id);
});

test('durable delete survives journal quota failure; invalid restore leaves trash untouched',async({page})=>{
 await library(page);
 const result=await page.evaluate(async()=>{
  const f=qaFiles,id=f.activeId;const before=structuredClone(f.active);qaAdapter.setItem=()=>{throw Error('quota');};await f.remove(id);qaAdapter.setItem=(k,v)=>qaStorage.set(k,v);const next=new Documents(qaAdapter);await next.open({title:'seed',projects:[]});
  await next.transaction('readwrite',(_docs,meta)=>meta.put({key:'trash:'+id,value:{...before,body:'broken',deletedAt:Date.now()}}));let error;try{await next.restore(id);}catch(e){error=e.message;}
  const state=await next.transaction('readonly',(docs,meta)=>{const out={};docs.get(id).onsuccess=e=>out.live=e.target.result;meta.get('trash:'+id).onsuccess=e=>out.trash=e.target.result;return out;});return{id,active:next.activeId,error,state};
 });
 expect(result.active).not.toBe(result.id);expect(result.error).toContain('原始內容已保留');expect(result.state.live).toBeUndefined();expect(result.state.trash.value.body).toBe('broken');
});

test('an aborted delete leaves live and trash stores unchanged',async({page})=>{
 await library(page);const result=await page.evaluate(async()=>{
  const f=qaFiles,before=structuredClone(f.active);const db=await f.database(),transaction=db.transaction.bind(db);
  db.transaction=(...args)=>{const tx=transaction(...args);if(args[1]==='readwrite')tx.objectStore('documents').getAll().onsuccess=()=>tx.abort();return tx;};
  let rejected=false;try{await f.remove(before.id);}catch{rejected=true;}db.transaction=transaction;
  const state=await f.transaction('readonly',(docs,meta)=>{const out={};docs.get(before.id).onsuccess=e=>out.live=e.target.result;meta.get('trash:'+before.id).onsuccess=e=>out.trash=e.target.result;return out;});return{rejected,before,active:f.active,state};
 });expect(result.rejected).toBe(true);expect(result.active).toEqual(result.before);expect(result.state.live).toEqual(result.before);expect(result.state.trash).toBeUndefined();
});

test('deleting the original never reassigns legacy backup ownership and restoring it recovers those backups',async({page})=>{
 const original=await mount(page),id=(await record(page)).id;
 await page.evaluate(async model=>{const db=await new Promise(resolve=>{const r=indexedDB.open('drag-backups',1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);});await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.objectStore('snapshots').put({id:crypto.randomUUID(),createdAt:Date.now(),title:'原檔歷史備份',projects:model.projects.length,tasks:15,reason:'manual',body:JSON.stringify(model)});});db.close();},original);
 await remove(page);await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row')).toHaveCount(0);await page.keyboard.press('Escape');await page.reload();await expect(action(page,'newproject')).toBeEnabled();await restore(page,id);await globalClick(page,'settings');await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('.backup-row b')).toHaveText('原檔歷史備份');await page.keyboard.press('Escape');expect(await draft(page)).toEqual(original);
});
