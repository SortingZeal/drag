import { globalClick, clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const seed=JSON.parse(readFileSync(new URL('../public/roadmap.json',import.meta.url),'utf8'));
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
const action=(page,name)=>page.locator(`[data-action="${name}"]`);
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function mount(page,size=null){
 const model=structuredClone(seed);model.metadata={source:'ui-size',retain:[{unknown:true}]};model.locks={title:true};
 model.projects.forEach((project,pi)=>{project.id=`ui-project-${pi}`;project.locks={color:true};project.phases.forEach((phase,fi)=>{phase.id=`ui-phase-${pi}-${fi}`;phase.locks={label:true};});});
 model.projects[0].fontSize=28;model.projects[0].phases[0].fontSize=18;model.projects[0].phases[0].locks={label:true,start:true};
 await page.addInitScript(({model,size})=>{if(!localStorage.getItem('drag.draft'))localStorage.setItem('drag.draft',JSON.stringify(model));if(size&&!localStorage.getItem('drag.uiSize'))localStorage.setItem('drag.uiSize',size);},{model,size});
 await page.goto('/');await expect(action(page,'global-menu')).toBeVisible();return model;
}
async function choose(page,size){
 await globalClick(page,'settings');
 await page.locator(`button[data-ui-size="${size}"]`).click();await page.keyboard.press('Escape');
 await expect(page.locator('#app')).toHaveAttribute('data-ui-size',size);await settle(page);
}
async function geometry(page){await page.locator('[data-action="global-menu"]').click();const result=await page.evaluate(()=>{
 const r=n=>{const{x,y,width,height}=n.getBoundingClientRect();return{x,y,width,height}};
 return{button:r(document.querySelector('[data-action="save"]')),row:r(document.querySelector('.tree-item.phase')),main:r(document.querySelector('main')),font:parseFloat(getComputedStyle(document.querySelector('[data-action="save"]')).fontSize),rowFont:parseFloat(getComputedStyle(document.querySelector('.tree-item.phase')).fontSize)};
});await page.mouse.click(2,2);return result;}
async function vector(page){const pending=page.waitForEvent('download');await globalClick(page,'svg');return readFile(await(await pending).path(),'utf8');}
test.beforeEach(async({page},info)=>{info.uiErrors=[];page.on('pageerror',e=>info.uiErrors.push(e.message));});
test.afterEach(async({},info)=>expect(info.uiErrors).toEqual([]));

test('Settings changes all control and tree text sizes, and Small frees workspace without changing data or history',async({page},info)=>{
 const model=await mount(page);const medium=await geometry(page);
 await choose(page,'small');const small=await geometry(page);
 expect(small.font).toBeLessThan(medium.font);expect(small.rowFont).toBeLessThan(medium.rowFont);
 expect(small.button.height).toBeLessThan(medium.button.height);expect(small.row.height).toBeLessThanOrEqual(medium.row.height);
 expect(small.main.height).toBeGreaterThan(medium.main.height);
 await choose(page,'large');const large=await geometry(page);
 expect(large.font).toBeGreaterThan(medium.font);expect(large.rowFont).toBeGreaterThan(medium.rowFont);expect(large.button.height).toBeGreaterThan(medium.button.height);
 await choose(page,'medium');expect((await geometry(page)).font).toBeCloseTo(medium.font,1);
 expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();await expect(action(page,'redo')).toBeDisabled();
 await choose(page,'small');await page.screenshot({path:info.outputPath('small-interface.png'),fullPage:true});
 await expect(page.locator('.hint,.save-state,.action-status,button[title]:not([aria-label])')).toHaveCount(0);
});

test('UI size persists across modes, edits, undo and reload without resetting panel preferences',async({page})=>{
 const model=await mount(page);await choose(page,'small');
 const handle=page.locator('.sidebar-resizer');await handle.focus();await handle.press('ArrowRight');
 const sidebar=await page.evaluate(()=>localStorage.getItem('drag.sidebar'));
 for(const mode of ['simple', 'timeline']){await clickAction(page, mode);await expect(page.locator('#app')).toHaveAttribute('data-ui-size','small');}
 await page.locator('[data-select-f="0:0"]').click();
  const field=page.locator('#editor [data-field="label"]');await field.fill('明確修改');await field.press('Tab');await field.blur();await globalClick(page,'undo');expect(await draft(page)).toEqual(model);
 await page.reload();await expect(page.locator('#app')).toHaveAttribute('data-ui-size','small');
 expect(await page.evaluate(()=>localStorage.getItem('drag.sidebar'))).toBe(sidebar);expect(await draft(page)).toEqual(model);
});

test('UI size does not change manual chart fonts, SVG geometry or full picture exports',async({page})=>{
 const model=await mount(page);
 for(const mode of ['simple']){
  await clickAction(page, mode);await choose(page,'medium');const before=await vector(page);
  await choose(page,'small');expect(await vector(page)).toBe(before);
  await choose(page,'large');expect(await vector(page)).toBe(before);
  expect(await draft(page)).toEqual(model);
 }
 await clickAction(page, 'timeline');const font=await page.locator('.bar-wrapper .bar-label').first().evaluate(n=>getComputedStyle(n).fontSize);
 await choose(page,'small');expect(await page.locator('.bar-wrapper .bar-label').first().evaluate(n=>getComputedStyle(n).fontSize)).toBe(font);
});

test('all interface sizes remain contained and usable in all modes at the minimum window and 25 percent pane',async({page},info)=>{
 await page.setViewportSize({width:1024,height:700});await page.addInitScript(()=>localStorage.setItem('drag.paneHeight','25'));const model=await mount(page);
 for(const size of ['small','medium','large'])for(const mode of ['timeline', 'simple']){
  await clickAction(page, mode);await choose(page,size);
  const result=await page.evaluate(()=>{const main=document.querySelector('main').getBoundingClientRect(),side=document.querySelector('aside').getBoundingClientRect();return{width:innerWidth,overflow:document.documentElement.scrollWidth,bottom:main.bottom,height:innerHeight,side:side.width,previewBottom:document.querySelector('.preview').getBoundingClientRect().bottom};});
  expect(result.overflow).toBeLessThanOrEqual(result.width+1);expect(result.bottom).toBeLessThanOrEqual(result.height+1);expect(result.side).toBeCloseTo(224,0);
  await expect(action(page,'newproject')).toBeVisible();
  if(mode!=='timeline'){
   const tools=await page.locator('.picture-tools').boundingBox();expect(tools.y+tools.height).toBeLessThanOrEqual(result.previewBottom+1);
   await page.locator('[data-picture-action="center"]').click();
  }
 }
 expect(await draft(page)).toEqual(model);await page.screenshot({path:info.outputPath('large-minimum-window.png'),fullPage:true});
});

test('invalid saved UI size falls back to Medium and Settings closes on Escape or outside click',async({page})=>{
 await mount(page,'unknown');await expect(page.locator('#app')).toHaveAttribute('data-ui-size','medium');
 const menu=page.locator('#settings-dialog');await globalClick(page,'settings');await page.keyboard.press('Escape');await expect(menu).not.toBeVisible();
 await globalClick(page,'settings');await page.mouse.click(2,2);await expect(menu).not.toBeVisible();
});

test('floating panel controls stay reachable at every interface size in the minimum window',async({page})=>{
 await page.setViewportSize({width:1024,height:700});
 await page.addInitScript(()=>localStorage.setItem('drag.sidebar',JSON.stringify({mode:'floating',dockWidth:224,float:{x:60,y:40,width:330,height:360}})));
 const model=await mount(page);
 for(const size of ['small','large','medium']){
  await choose(page,size);
  await expect(page.locator('aside')).toHaveClass(/is-floating/);
  const bounds=await page.evaluate(()=>{const panel=document.querySelector('aside').getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return{panel:{x:panel.x,y:panel.y,right:panel.right,bottom:panel.bottom},main:{x:main.x,y:main.y,right:main.right,bottom:main.bottom},hits:[...document.querySelectorAll('[data-sidebar-action],.sidebar-corner-resizer')].map(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===node;})};});
  expect(bounds.panel.x).toBeGreaterThanOrEqual(bounds.main.x);expect(bounds.panel.y).toBeGreaterThanOrEqual(bounds.main.y);
  expect(bounds.panel.right).toBeLessThanOrEqual(bounds.main.right);expect(bounds.panel.bottom).toBeLessThanOrEqual(bounds.main.bottom);
  expect(bounds.hits).toEqual([true,true]);
 }
 await page.locator('[data-sidebar-action="dock"]').click();await expect(page.locator('aside')).not.toHaveClass(/is-floating/);
 expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
});
