import { selectTimelineScale, globalClick, clickAction, openViewOptions } from './global-actions.js';
import {test,expect}from'./audit-fixture.js';
import{readFile}from'node:fs/promises';import{readFileSync}from'node:fs';
const mod=process.platform==='darwin'?'Meta':'Control';
const seed=JSON.parse(readFileSync(new URL('../public/roadmap.json',import.meta.url),'utf8'));
const action=(p,a)=>p.locator(`[data-action="${a}"]`),draft=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
const dialog=p=>p.locator('#settings-dialog'),pref=(p,k)=>p.locator(`[data-pref="${k}"]`);
function fixture(){const m=structuredClone(seed);m.metadata={source:'settings-513',nested:[true,{keep:27}]};m.locks={title:true};m.projects.forEach((p,pi)=>{p.id=`settings-p${pi}`;p.locks={color:true};p.phases.forEach((f,fi)=>{f.id=`settings-f${pi}-${fi}`;f.locks={start:true,icon:true};f.metadata={keep:[pi,fi]};});});return m;}
async function mount(page,values={},legacy={}){const model=fixture();await page.addInitScript(({model,values,legacy})=>{if(!localStorage.getItem('settings.seeded')){localStorage.setItem('drag.draft',JSON.stringify(model));if(Object.keys(values).length)localStorage.setItem('drag.preferences',JSON.stringify({version:1,values}));for(const[k,v]of Object.entries(legacy))localStorage.setItem(k,v);localStorage.setItem('settings.seeded','1');}}, {model,values,legacy});await page.goto('/');await expect(action(page,'global-menu')).toBeVisible();return model;}
async function selectFirstTask(page) {
 await page.locator('#tree [data-select-f="0:0"] .tree-label').click();
 await expect(page.locator('.bottom')).toBeVisible();
}
async function open(page,section='interface'){if(!await dialog(page).isVisible())await globalClick(page,'settings');await page.locator(`[data-settings-category="${section}"]`).click();}
async function close(page){await page.keyboard.press('Escape');await expect(dialog(page)).not.toBeVisible();}
async function select(page,key,value){await pref(page,key).selectOption(value);await expect(pref(page,key)).toHaveValue(value);}
async function number(page,key,value){await pref(page,key).fill(String(value));await pref(page,key).press('Tab');await pref(page,key).blur();}
async function download(page,name){const wait=page.waitForEvent('download');await clickAction(page, name);const d=await wait;return{file:d,bytes:await readFile(await d.path())};}
const values=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.preferences')).values);
test.beforeEach(async({page},info)=>{info.settingsErrors=[];page.on('pageerror',e=>info.settingsErrors.push(e.message));});test.afterEach(async({},info)=>expect(info.settingsErrors).toEqual([]));

test('full dialog preserves legacy preferences, searches and resets one setting/category without editing model',async({page},info)=>{
 const model=await mount(page,{}, {'drag.uiSize':'small','drag.snap':'7d','drag.leftPaddingMonths':'9','drag.rightPaddingMonths':'4'});
 await open(page);await expect(page.locator('button[data-ui-size="small"]')).toHaveAttribute('aria-pressed','true');
 await select(page,'density','compact');await select(page,'theme','dark');
 await page.locator('[data-reset-pref="theme"]').click();await expect(pref(page,'theme')).toHaveValue('light');expect((await values(page)).density).toBe('compact');
 await page.locator('[data-settings-action="reset-category"]').click();await expect(pref(page,'density')).toHaveValue('normal');expect((await values(page)).snap).toBe('7d');
 await page.locator('#settings-search').fill('吸附');await expect(pref(page,'snap')).toHaveValue('7d');await expect(pref(page,'theme')).toHaveCount(0);
 await page.locator('#settings-search').fill('儲存專案');await expect(page.locator('[data-shortcut="save"]')).toBeVisible();
 await page.locator('#settings-search').fill('不存在的設定');await expect(page.locator('.settings-empty')).toHaveText('沒有符合的設定');
 await page.locator('#settings-search').fill('');await page.screenshot({path:info.outputPath('settings-interface.png'),fullPage:true});
 await close(page);expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
 await page.keyboard.press(mod+'+,');await expect(dialog(page)).toBeVisible();await close(page);await page.reload();expect(await draft(page)).toEqual(model);await expect(page.locator('#app')).toHaveAttribute('data-ui-size','medium');
});

test('dock retains width, layout reset is distinct, hiding and floating preserve data and picture zoom',async({page})=>{
 const model=await mount(page);await page.locator('.sidebar-resizer').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 await clickAction(page, 'simple');await page.locator('[data-picture-action="actual"]').click();await page.locator('[data-picture-action="zoom-in"]').click();await expect(page.locator('aside')).toHaveCount(0);await clickAction(page,'timeline');await open(page,'workspace');await page.locator('[data-settings-action="float"]').click();await page.locator('[data-settings-action="dock"]').click();await expect(page.locator('aside')).not.toHaveClass(/is-floating/);await page.locator('[data-settings-action="float"]').click();await close(page);
 await expect(page.locator('aside')).toHaveClass(/is-floating/);await expect(page.locator('[data-sidebar-action="reset"]')).toHaveCount(0);await page.locator('[data-sidebar-action="dock"]').click();expect((await page.locator('aside').boundingBox()).width).toBeCloseTo(244,0);
 await open(page,'workspace');await pref(page,'sidebarVisible').uncheck();await close(page);await expect(page.locator('aside')).not.toBeVisible();await expect(action(page,'global-menu')).toBeVisible();
 await open(page,'workspace');await page.locator('[data-settings-action="reset-layout"]').click();await close(page);await expect(page.locator('aside')).toBeVisible();expect((await page.locator('aside').boundingBox()).width).toBeCloseTo(224,0);expect(await page.evaluate(()=>Number(localStorage.getItem('drag.paneHeight')))).toBe(68);await clickAction(page,'simple');await expect(page.locator('[data-picture-zoom]')).toHaveText('110%');
 await expect(page.locator('[data-picture-action="reset"]')).toHaveText('適合視窗');expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
});

test('startup mode, timeline granularity and free picture viewport survive reload only when requested',async({page})=>{
 const model=await mount(page);await open(page,'workspace');await select(page,'startupMode','last');await pref(page,'rememberPictures').check();await close(page);
 await selectTimelineScale(page, 'Week');await clickAction(page, 'simple');await page.locator('[data-picture-action="actual"]').click();await page.locator('[data-picture-action="zoom-in"]').click();
 const box=await page.locator('.picture-viewport').boundingBox();await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2+40,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
 const before=await page.locator('.picture-canvas').boundingBox();await page.reload();await expect(action(page,'simple')).toHaveAttribute('aria-selected','true');await expect(page.locator('[data-picture-zoom]')).toHaveText('110%');const after=await page.locator('.picture-canvas').boundingBox();expect(after.x).toBeCloseTo(before.x,0);expect(after.y).toBeCloseTo(before.y,0);
 await clickAction(page, 'timeline');await expect(page.locator('.timeline-date-dock')).toHaveAttribute('data-scale', 'Week');expect(await draft(page)).toEqual(model);
});

for(const mode of ['simple', 'timeline'])test(`${mode} theme/density/motion preferences preserve exact exported vectors and authored data`,async({page},info)=>{
 const model=await mount(page);await clickAction(page, mode);const before=(await download(page,'svg')).bytes;
 await open(page);await select(page,'palette','ocean');await select(page,'typeface','book');await select(page,'canvasSurface','grid');await close(page);
 for(const appearance of ['dark','system','light']){
  await open(page);await select(page,'theme',appearance);if(appearance==='system'){await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');}await select(page,'density','compact');await pref(page,'reduceMotion').check();await close(page);const after=(await download(page,'svg')).bytes;if(!after.equals(before)){await info.attach('before.svg',{body:before,contentType:'image/svg+xml'});await info.attach('after.svg',{body:after,contentType:'image/svg+xml'});}expect(after.equals(before)).toBe(true);
 }
 await open(page);await select(page,'theme','dark');expect(await page.locator('.settings-sizes button[aria-pressed=true]').evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe(await page.locator('.settings-sizes button[aria-pressed=false]').first().evaluate(n=>getComputedStyle(n).backgroundColor));await page.screenshot({path:info.outputPath(`${mode}-dark-settings.png`),fullPage:true});await close(page);expect(await draft(page)).toEqual(model);
});

test('preferences import/export contains only view preferences and rejects invalid input atomically with same-file retry',async({page})=>{
 const model=await mount(page);await open(page);await select(page,'density','compact');
 const wait=page.waitForEvent('download');await page.locator('[data-settings-action="export"]').click();const d=await wait,json=JSON.parse(await readFile(await d.path(),'utf8'));expect(json.format).toBe('drag-preferences');expect(json).not.toHaveProperty('projects');expect(json.values.density).toBe('compact');expect(json.workspace.sidebar.mode).toBe('docked');
 const before=await values(page);for(let i=0;i<2;i++){await page.locator('#settings-import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...json,values:{...json.values,backupCount:999}}))});await expect(page.locator('#settings-error')).toContainText('匯入失敗');expect(await values(page)).toEqual(before);}
 json.values.theme='dark';json.values.startupMode='simple';json.workspace.sidebar.dockWidth=300;
 await page.locator('#settings-import').setInputFiles({name:'preferences.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});await expect(pref(page,'theme')).toHaveValue('dark');await close(page);expect((await page.locator('aside').boundingBox()).width).toBeCloseTo(300,0);expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
 await page.reload();await expect(action(page,'simple')).toHaveAttribute('aria-selected','true');expect(await draft(page)).toEqual(model);
});

test('browser versions are real persistent snapshots, rotate, preview/export/restore exact metadata and undo restoration',async({page})=>{
 const original=await mount(page,{autoBackup:false,backupCount:2});await open(page,'storage');await expect(pref(page,'rememberSaveDirectory')).toHaveCount(0);await expect(page.locator('[data-settings-action="open-data"]')).toHaveCount(0);
 await expect(page.locator('#browser-storage-note')).toContainText('清除網站資料、換裝置或改用不同網域');await expect(page.locator('#browser-storage-note')).toContainText('從「文件庫」逐份切換文件');
 await page.locator('[data-settings-action="backup"]').click();await expect(page.locator('.backup-row')).toHaveCount(1);await close(page);
 await selectFirstTask(page);
 const field=page.locator('[data-field="label"]');await field.fill('版本二修改');await field.press('Tab');await field.blur();const changed=await draft(page);
 await open(page,'storage');await page.locator('[data-settings-action="backup"]').click();await expect(page.locator('.backup-row')).toHaveCount(2);await page.locator('[data-backup-preview]').last().click();await expect(page.locator('#backup-preview')).toContainText(original.projects[0].name);
 const wait=page.waitForEvent('download');await page.locator('[data-backup-export]').last().click();expect(JSON.parse(await readFile(await(await wait).path(),'utf8'))).toEqual(original);
 page.once('dialog',d=>d.accept());await page.locator('[data-backup-restore]').last().click();await expect(dialog(page)).not.toBeVisible();expect(await draft(page)).toEqual(original);await globalClick(page,'undo');expect(await draft(page)).toEqual(changed);
 await page.reload();await open(page,'storage');await expect(page.locator('.backup-row')).toHaveCount(2);expect(await draft(page)).toEqual(changed);
});

test('automatic snapshot captures initial and latest edits, honors disabled setting, and reports write failures',async({page})=>{
 await page.clock.install();const original=await mount(page);await page.clock.runFor(1000);await open(page,'storage');await expect(page.locator('.backup-row')).toHaveCount(1);await close(page);
 await selectFirstTask(page);
 const f=page.locator('[data-field="label"]');await f.fill('自動版本');await f.press('Tab');await f.blur();const changed=await draft(page);await page.clock.runFor(5*60000+1000);await open(page,'storage');await expect(page.locator('.backup-row')).toHaveCount(2);await pref(page,'autoBackup').uncheck();await close(page);
 await globalClick(page,'undo');expect(await draft(page)).toEqual(original);await page.clock.runFor(10*60000);await open(page,'storage');await expect(page.locator('.backup-row')).toHaveCount(2);
 // Inject a real IndexedDB transaction failure at the storage boundary.
 await page.evaluate(()=>{IDBDatabase.prototype.transaction=function(){throw Error('模擬磁碟空間不足');};});await page.locator('[data-settings-action="backup"]').click();await expect(page.locator('#settings-error')).toContainText('模擬磁碟空間不足');expect(await draft(page)).toEqual(original);expect(changed.metadata).toEqual(original.metadata);
});

test('custom keyboard shortcuts reject conflicts, preserve text editing and execute only assigned actions',async({page})=>{
 const model=await mount(page);await open(page,'editing');const key=page.locator('[data-shortcut="save"]');await key.focus();await key.press(mod+'+o');await expect(page.locator('#settings-error')).toContainText('重複');expect((await values(page)).shortcuts.save).toBe('Mod+s');
 await key.focus();await key.press(mod+'+Shift+s');await expect(page.locator('[data-shortcut="save"]')).toHaveValue('Mod+Shift+s');await close(page);
 const wait=page.waitForEvent('download');await page.keyboard.press(mod+'+Shift+s');expect(JSON.parse(await readFile(await(await wait).path(),'utf8'))).toEqual(model);
 await selectFirstTask(page);
 const label=page.locator('[data-field="label"]');await label.fill('編輯中的文字');await label.press(mod+'+z');await expect(label).toHaveValue(model.projects[0].phases[0].label);expect(await draft(page)).toEqual(model);
 await open(page,'editing');await page.locator('[data-reset-shortcut="save"]').click();await expect(page.locator('[data-shortcut="save"]')).toHaveValue('Mod+s');await close(page);
});

for(const mode of ['simple'])test(`${mode} export preferences change actual PNG/SVG size, transparent canvas and filename without changing preview/model`,async({page},info)=>{
 const model=await mount(page);await clickAction(page, mode);const preview=await page.locator('.infographic-preview svg').getAttribute('viewBox');
 await open(page,'export');await select(page,'pictureSize','fullhd');await select(page,'background','transparent');await select(page,'filename','{title}-{mode}-{date}');await close(page);
 const image=await download(page,'png');expect([image.bytes.readUInt32BE(16),image.bytes.readUInt32BE(20)]).toEqual([1920,1080]);expect(image.file.suggestedFilename()).toMatch(new RegExp(`${mode}-\\d{4}-\\d{2}-\\d{2}\\.png$`));
 const alpha=await page.evaluate(async s=>{const i=new Image();i.src='data:image/png;base64,'+s;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,1,1).data[3];},image.bytes.toString('base64'));expect(alpha).toBe(0);
 const vector=await download(page,'svg');const attrs=await page.evaluate(xml=>{const n=new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;return{width:n.getAttribute('width'),height:n.getAttribute('height'),viewBox:n.getAttribute('viewBox')};},vector.bytes.toString());expect(attrs).toEqual({width:'1920',height:'1080',viewBox:preview});expect(await draft(page)).toEqual(model);
 await image.file.saveAs(info.outputPath(`${mode}-transparent-fullhd.png`));
 await open(page,'export');await select(page,'pictureSize','2k');await select(page,'background','white');await close(page);const larger=await download(page,'png');expect([larger.bytes.readUInt32BE(16),larger.bytes.readUInt32BE(20)]).toEqual([2560,1440]);
});

test('new-item defaults affect only newly created objects and respect existing presentation locks',async({page})=>{
 const original=await mount(page);await open(page,'editing');await pref(page,'newColor').evaluate(n=>{n.value='#123456';n.dispatchEvent(new Event('change',{bubbles:true}));});
 await pref(page,'newIcon').fill('🚀');await pref(page,'newIcon').press('Tab');await number(page,'newProjectFont',32);await number(page,'newTaskFont',20);await select(page,'newMilestoneShape','star');await close(page);expect(await draft(page)).toEqual(original);
 await clickAction(page, 'newproject');await clickAction(page, 'newphase');const model=await draft(page);expect(model.projects.slice(0,-1)).toEqual(original.projects);const p=model.projects.at(-1);expect(p.color).toBe('#123456');expect(p.icon).toBe('🚀');expect(p.fontSize).toBe(32);expect(p.phases[0].fontSize).toBe(20);expect(p.phases[0].milestoneShape).toBe('star');expect(model.presentation).toEqual(original.presentation);
 const mile=page.locator('[data-field="milestone"]');await mile.fill('新里程碑');await mile.press('Tab');await mile.blur();await clickAction(page, 'simple');await expect(page.locator(`[data-phase-id="${p.phases[0].id}"] [data-role="milestone-symbol"]`)).toHaveAttribute('data-shape','star');await openViewOptions(page);await page.locator('#report-shape').selectOption('circle');await expect(page.locator(`[data-phase-id="${p.phases[0].id}"] [data-role="milestone-symbol"]`)).toHaveAttribute('data-shape','circle');
});

test('settings remain usable at minimum window in all sizes and about shows actual version without desktop-only controls',async({page},info)=>{
 const model=await mount(page);await page.setViewportSize({width:1024,height:700});
 for(const size of ['small','medium','large']){
  await open(page);await page.locator(`button[data-ui-size="${size}"]`).click();const r=await dialog(page).boundingBox();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.y+r.height).toBeLessThanOrEqual(701);await expect(page.locator('[data-settings-action="close"]').last()).toBeInViewport();const font=await pref(page,'theme').evaluate(n=>parseFloat(getComputedStyle(n).fontSize));expect(font).toBeCloseTo(({small:11.9,medium:14,large:16.1})[size],1);
  const heights = [];
  for (const density of ['compact', 'normal', 'comfortable']) {
   await select(page, 'density', density);
   await expect(page.locator('html')).toHaveAttribute('data-ui-density', density);
   const outline = await page.locator('#tree .tree-item.phase').first().boundingBox();
   const setting = await page.locator('.settings-row').filter({has: pref(page, 'density')}).boundingBox();
   heights.push({outline: outline.height, setting: setting.height});
  }
  for (let i = 1; i < heights.length; i++) {
   expect(Math.round(heights[i].outline - heights[i - 1].outline)).toBeGreaterThanOrEqual(16);
   expect(Math.round(heights[i].setting - heights[i - 1].setting)).toBeGreaterThanOrEqual(16);
  }
  await page.locator('[data-settings-category="storage"]').click();await expect(page.locator('[data-settings-action="backup"]')).toBeVisible();await close(page);
 }
 await open(page,'about');await expect(page.locator('.settings-about')).toContainText(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);await expect(page.locator('[data-settings-action="open-data"]')).toHaveCount(0);await page.screenshot({path:info.outputPath('settings-about-minimum.png'),fullPage:true});expect(await draft(page)).toEqual(model);
});

test('editing settings validate ranges, apply calendar defaults and reset only their own category',async({page})=>{
 const model=await mount(page);await selectTimelineScale(page, 'Week');await open(page);await select(page,'density','comfortable');await page.locator('[data-settings-action="reset-category"]').click();await close(page);await expect(page.locator('.timeline-date-dock')).toHaveAttribute('data-scale', 'Week');
 await open(page,'editing');await pref(page,'autoPan').uncheck();await expect.poll(async()=>(await values(page)).autoPan).toBe(false);await pref(page,'autoPan').check();for(const key of ['leftMonths','rightMonths']){await number(page,key,0);await expect(page.locator('#settings-error')).toContainText('設定值無效');expect((await values(page))[key]).toBe(6);await number(page,key,key==='leftMonths'?9:12);}
 await select(page,'view','Quarter');await select(page,'snap','30d');await close(page);await expect(page.locator('.timeline-date-dock')).toHaveAttribute('data-scale', 'Quarter');await expect(page.locator('#snap')).toHaveValue('30d');expect(await draft(page)).toEqual(model);
 await open(page,'editing');await page.locator('[data-settings-action="reset-category"]').click();await close(page);await expect(page.locator('.timeline-date-dock')).toHaveAttribute('data-scale', 'Month');await expect(page.locator('#snap')).toHaveValue('auto');expect((await values(page)).leftMonths).toBe(6);await expect(action(page,'undo')).toBeDisabled();
});

for(const side of ['left','right'])test(`disabled edge auto-pan holds ${side} position during active drag and preserves Escape rollback`,async({page})=>{
 const model=await mount(page,{autoPan:false,view:'Day',snap:'1d'});const bar=page.locator('.bar-wrapper[data-id="settings-f0-0"] .bar').first();
 await bar.evaluate(n=>{const p=document.querySelector('.preview');p.scrollLeft+=n.getBoundingClientRect().x-p.getBoundingClientRect().x-p.clientWidth*.35;});
 const b=await bar.boundingBox(),v=await page.locator('.preview').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(side==='left'?v.x+5:v.x+v.width-5,b.y+b.height/2,{steps:4});
 const scroll=await page.locator('.preview').evaluate(n=>n.scrollLeft);await page.waitForTimeout(500);expect(await page.locator('.preview').evaluate(n=>n.scrollLeft)).toBe(scroll);expect(await draft(page)).toEqual(model);await page.keyboard.press('Escape');await page.mouse.up();expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
});

test('imported new-item defaults take effect and resetting them preserves inherited global milestone style',async({page})=>{
 const model=await mount(page,{autoBackup:false});await open(page);const json={format:'drag-preferences',version:1,values:{...(await values(page)),newMilestoneShape:'star'}};
 await page.locator('#settings-import').setInputFiles({name:'prefs.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});await close(page);await selectFirstTask(page);await clickAction(page, 'newphase');let changed=await draft(page);expect(changed.projects[0].phases.at(-1).milestoneShape).toBe('star');await globalClick(page,'undo');expect(await draft(page)).toEqual(model);
 await open(page,'editing');await page.locator('[data-reset-pref="newMilestoneShape"]').click();await expect(pref(page,'newMilestoneShape')).toHaveValue('inherit');await close(page);await selectFirstTask(page);await clickAction(page, 'newphase');changed=await draft(page);expect(changed.projects[0].phases.at(-1)).not.toHaveProperty('milestoneShape');expect(changed.presentation).toEqual(model.presentation);
});

test('timeline PNG multiplier changes actual output dimensions and export category reset restores defaults',async({page})=>{
 const model=await mount(page,{view:'Year'});const first=(await download(page,'png')).bytes;await open(page,'export');await select(page,'timelineScale','1');await select(page,'background','transparent');await close(page);const second=(await download(page,'png')).bytes;
 expect(second.readUInt32BE(16)).toBe(Math.round(first.readUInt32BE(16)/2));expect(second.readUInt32BE(20)).toBe(Math.round(first.readUInt32BE(20)/2));
 await open(page,'export');await page.locator('[data-settings-action="reset-category"]').click();await expect(pref(page,'timelineScale')).toHaveValue('2');await expect(pref(page,'background')).toHaveValue('white');await expect(pref(page,'pictureSize')).toHaveValue('4k');await close(page);expect(await draft(page)).toEqual(model);
});

test('every visible preference and shortcut reset restores only its own value, with real settings file chooser',async({page})=>{
 const {DEFAULTS,GROUPS}=await import('../src/preferences.js');const model=await mount(page,{uiSize:'large',density:'comfortable',theme:'dark',palette:'plum',typeface:'mono',canvasSurface:'grid',reduceMotion:true,sidebarVisible:false,startupMode:'last',rememberPictures:true,view:'Year',snap:'7d',leftMonths:9,rightMonths:12,autoPan:false,autoBackup:false,backupMinutes:10,backupCount:3,pictureSize:'2k',background:'transparent',filename:'{title}',timelineScale:1,newColor:'#123456',newIcon:'🚀',newProjectFont:32,newTaskFont:20,newMilestoneShape:'star'});
 for(const section of ['interface','workspace','editing','storage','export']){
  await open(page,section);for(const key of GROUPS[section].filter(k=>!['shortcuts','rememberSaveDirectory','toolbarLayout'].includes(k))){const before=await values(page);await page.locator(`[data-reset-pref="${key}"]`).click();await expect.poll(async()=>(await values(page))[key]).toEqual(DEFAULTS[key]);const after=await values(page);for(const other of Object.keys(before).filter(k=>k!==key))expect(after[other]).toEqual(before[other]);}await close(page);
 }
 await open(page,'editing');for(const key of Object.keys(DEFAULTS.shortcuts)){await page.locator(`[data-shortcut="${key}"]`).focus();await page.locator(`[data-shortcut="${key}"]`).press('Backspace');await expect.poll(async()=>(await values(page)).shortcuts[key]).toBe('');await page.locator(`[data-reset-shortcut="${key}"]`).click();await expect.poll(async()=>(await values(page)).shortcuts[key]).toBe(DEFAULTS.shortcuts[key]);}
 const json={format:'drag-preferences',version:1,values:{...(await values(page)),density:'compact'}};const wait=page.waitForEvent('filechooser');await page.locator('[data-settings-action="import"]').click();await(await wait).setFiles({name:'preferences.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});await expect.poll(async()=>(await values(page)).density).toBe('compact');await page.locator('[data-settings-category="storage"]').click();await number(page,'backupMinutes',2);await number(page,'backupCount',4);expect((await values(page)).backupMinutes).toBe(2);expect((await values(page)).backupCount).toBe(4);await page.locator('[data-settings-action="refresh-backups"]').click();await page.locator('[data-settings-action="close"]').first().click();await expect(dialog(page)).not.toBeVisible();expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
});


test('all default action shortcuts perform actual mode switches, history and JSON/SVG/PNG file operations',async({page})=>{
 const model=await mount(page,{view:'Year',autoBackup:false});for(const [key,mode]of [[mod+'+3','simple'],[mod+'+1','timeline']]){await page.locator('.brand').click();await page.keyboard.press(key);await expect(action(page,mode)).toHaveAttribute('aria-selected','true');}
 await selectFirstTask(page);await clickAction(page, 'newphase');const changed=await draft(page);await page.locator('.brand').click();await page.keyboard.press(mod+'+z');expect(await draft(page)).toEqual(model);await page.keyboard.press(mod+'+Shift+z');expect(await draft(page)).toEqual(changed);
 for(const [key,format]of [[mod+'+s','json'],[mod+'+Shift+e','svg'],[mod+'+Shift+p','png']]){const wait=page.waitForEvent('download');await page.keyboard.press(key);const bytes=await readFile(await(await wait).path());if(format==='json')expect(JSON.parse(bytes)).toEqual(changed);else if(format==='svg')expect(bytes.toString()).toContain('<svg');else expect(bytes.subarray(1,4).toString()).toBe('PNG');}
 const wait=page.waitForEvent('filechooser');await page.keyboard.press(mod+'+o');await(await wait).setFiles({name:'keyboard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(model))});await expect.poll(()=>draft(page)).toEqual(model);await page.locator('.brand').click();await page.keyboard.press(mod+'+,');await expect(dialog(page)).toBeVisible();await close(page);
});

test('shell palette, typeface and canvas surface persist independently of authored artwork', async ({page}) => {
 const model = await mount(page);
 await clickAction(page, 'simple');
 const art = page.locator('.roadmap-simple');
 await expect(art).toBeVisible();
 const original = await art.innerHTML();
 await open(page);
 await select(page, 'palette', 'ocean');
 await select(page, 'theme', 'dark');
 await select(page, 'typeface', 'book');
 await select(page, 'canvasSurface', 'grid');
 const header = page.locator('#app header');
 await expect(header).toHaveCSS('background-color', 'rgb(32, 44, 56)');
 await expect(header).toHaveCSS('font-family', /Georgia/);
 await expect(dialog(page)).toHaveCSS('font-family', /Georgia/);
 await expect(page.locator('.picture-viewport')).toHaveCSS('background-image', /linear-gradient/);
 expect(await art.innerHTML()).toEqual(original);
 expect(await draft(page)).toEqual(model);
 await page.reload();
 await expect(header).toHaveCSS('font-family', /Georgia/);
 await expect(page.locator('html')).toHaveAttribute('data-canvas-surface','grid');
 await open(page);
 await select(page, 'palette', 'plum');
 await expect(header).toHaveCSS('background-color', 'rgb(43, 35, 46)');
 await page.locator('[data-settings-action="reset-category"]').click();
 await expect(page.locator('html')).toHaveAttribute('data-palette', 'jade');
 await expect(page.locator('html')).toHaveAttribute('data-typeface', 'system');
 await expect(page.locator('html')).toHaveAttribute('data-canvas-surface', 'dots');
 expect(await draft(page)).toEqual(model);
});

test('small type retains distinct toolbar, properties and tracking row spacing', async ({page}, info) => {
 await mount(page,{uiSize:'small'});
 await selectFirstTask(page);
 const metrics=[];
 for (const density of ['compact','normal','comfortable']) {
  await open(page);await select(page,'density',density);await close(page);
  if(!await page.locator('.bottom').isVisible()) await selectFirstTask(page);
  const header=await page.locator('.workspace-header').boundingBox();
  const button=await page.locator('#editor [data-status-choice="0"]').boundingBox();
  await clickAction(page,'tracking');
  const row=await page.locator('#tracking-page .weekly-row').first().boundingBox();
  metrics.push({header:header.height,button:button.height,row:row.height});
  await clickAction(page,'timeline');
 }
 await info.attach('density-measurements',{body:JSON.stringify(metrics),contentType:'application/json'});
 for (let i=1;i<metrics.length;i++) {
  expect(Math.round(metrics[i].header-metrics[i-1].header)).toBeGreaterThanOrEqual(12);
  expect(Math.round(metrics[i].button-metrics[i-1].button)).toBeGreaterThanOrEqual(12);
  expect(Math.round(metrics[i].row-metrics[i-1].row)).toBeGreaterThanOrEqual(16);
 }
});
