import { test, expect } from './audit-fixture.js';
import { globalClick, openViewOptions } from './global-actions.js';
import { readFile } from 'node:fs/promises';
const model=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
const rect=p=>p.boundingBox();
test('compact header and icon tools retain accessible names and hover titles',async({page})=>{
 await page.setViewportSize({width:1280,height:800});await page.goto('/');await expect(page.locator('#gantt svg.gantt')).toBeVisible();
 const sizes=await page.locator('header').evaluate(header=>({
  height:header.getBoundingClientRect().height,
  brand:parseFloat(getComputedStyle(header.querySelector('.brand b')).fontSize),
  workspace:parseFloat(getComputedStyle(header.querySelector('.workspace-heading strong')).fontSize)
 }));
 expect(sizes.height).toBeLessThanOrEqual(56);expect(sizes.brand).toBeLessThan(22);expect(sizes.workspace).toBeLessThan(14);
 await page.locator('[data-select-f="0:0"] .tree-label').click();
 for(const [selector,name] of [
  ['[data-action=global-menu]','專案操作'],
  ['[data-action=fit-content]','符合內容'],
  ['[data-action=document-menu]','文件庫'],
  ['[data-action=newproject]','新增專案'],
  ['[data-action=newphase]','新增任務']
 ]){
  if(selector==='[data-action=fit-content]') await openViewOptions(page);
  const button=page.locator(selector);await expect(button).toHaveAttribute('aria-label',name);await expect(button).toHaveAttribute('title',name);
  await expect(button.locator('svg[aria-hidden=true]')).toBeVisible();
  if(selector==='[data-action=fit-content]') await page.keyboard.press('Escape');
 }
 const close=page.getByRole('button',{name:'關閉屬性'});
 await expect(close).toHaveAttribute('title','關閉屬性');
 await close.click();
 await page.locator('[data-action=simple]').click();
 for(const [action,name] of [['actual','原尺寸'],['reset','適合視窗'],['center','置中']]){
  const button=page.locator(`[data-picture-action=${action}]`);await expect(button).toHaveAttribute('aria-label',name);await expect(button).toHaveAttribute('title',name);
  await expect(button.locator('svg[aria-hidden=true]')).toBeVisible();
 }
});
test('brand, workspace name, and action menu stay on one line at desktop and 390px',async({page})=>{
 await page.setViewportSize({width:1280,height:800});await page.goto('/');await expect(page.locator('.workspace-heading strong')).toBeVisible();
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:800});
  const title=page.locator('.workspace-heading strong');await expect(title).toBeVisible();
  await title.evaluate(node=>{node.textContent='很長的工作區名稱'.repeat(40);});
  const geometry=await page.locator('header').evaluate(header=>{
   const rect=selector=>header.querySelector(selector).getBoundingClientRect();
   const brand=rect('.brand'),name=rect('.workspace-heading strong'),menu=rect('[data-action=global-menu]');
   const title=header.querySelector('.workspace-heading strong');
   return{height:header.getBoundingClientRect().height,scrollWidth:header.scrollWidth,clientWidth:header.clientWidth,
    brandRight:brand.right,nameLeft:name.left,nameRight:name.right,menuLeft:menu.left,menuRight:menu.right,
    centerDifference:Math.abs((brand.top+brand.bottom-name.top-name.bottom)/2),
    truncated:title.scrollWidth>title.clientWidth,
    eyebrowHidden:header.querySelector('.workspace-eyebrow').classList.contains('visually-hidden')};
  });
  await test.info().attach(`header-${width}.json`,{body:Buffer.from(JSON.stringify(geometry,null,2)),contentType:'application/json'});
  expect(geometry.height).toBeLessThanOrEqual(56);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.brandRight).toBeLessThan(geometry.nameLeft);
  expect(geometry.nameRight).toBeLessThanOrEqual(geometry.menuLeft);
  expect(geometry.menuRight).toBeLessThanOrEqual(width);
  expect(geometry.centerDifference).toBeLessThanOrEqual(4);
  expect(geometry.truncated).toBe(true);
  expect(geometry.eyebrowHidden).toBe(true);
  await page.locator('[data-action=global-menu]').click();
  await expect(page.locator('#global-action-menu')).toBeVisible();
  await page.locator('[data-action=global-menu]').click();
 }
});
test('inspector sits beside the outline, resizes and reopens with its saved width',async({page})=>{
 await page.goto('/');await expect(page.locator('#gantt svg.gantt')).toBeVisible();const before=await model(page);
 await expect(page.locator('.bottom')).toBeHidden();
 await page.locator('[data-select-f="0:0"]').click();
 const canvas=await rect(page.locator('.preview')),panel=await rect(page.locator('.bottom'));
 expect(panel.x).toBeCloseTo(canvas.x+4,0);
 const splitter=page.locator('#split');await splitter.focus();await splitter.press('ArrowRight');
 expect((await rect(page.locator('.bottom'))).width).toBeCloseTo(panel.width+16,0);
 const edge=await rect(splitter);await page.mouse.move(edge.x+2,edge.y+80);await page.mouse.down();await page.mouse.move(edge.x+32,edge.y+80);await page.mouse.up();
 const width=(await rect(page.locator('.bottom'))).width;expect(width).toBeCloseTo(panel.width+46,0);
 await page.reload();await expect(page.locator('.bottom')).toBeHidden();await page.locator('[data-select-f="0:0"]').click();
 expect((await rect(page.locator('.bottom'))).width).toBeCloseTo(width,0);
 await page.locator('[data-outline-close]').click();await expect(page.locator('.bottom')).toBeHidden();expect((await rect(page.locator('.preview'))).width).toBeCloseTo(canvas.width,0);
 await page.locator('[data-select-f="0:0"]').click();await page.setViewportSize({width:1000,height:850});await expect(splitter).toHaveAttribute('aria-orientation','vertical');
 expect((await rect(page.locator('.bottom'))).x).toBeCloseTo((await rect(page.locator('.preview'))).x+4,0);
 expect(await model(page)).toEqual(before);
});
test('advanced range controls stay discoverable and close with Escape or an outside pointer',async({page})=>{
 await page.goto('/');await expect.poll(()=>model(page)).not.toBeNull();const before=await model(page);const options=page.locator('.range-options');
 await expect(page.locator('#snap')).toBeHidden();await options.locator('summary').click();await expect(page.locator('#snap')).toBeVisible();
 await page.locator('#snap').selectOption('7d');await page.keyboard.press('Escape');await expect(page.locator('#snap')).toBeHidden();await expect(options.locator('summary')).toBeFocused();
 await options.locator('summary').click();await page.locator('.brand').click();await expect(page.locator('#snap')).toBeHidden();expect(await model(page)).toEqual(before);
});
test('dark timeline is dark throughout while vector export stays identical to light mode',async({page})=>{
 await page.goto('/');await expect(page.locator('#gantt svg.gantt')).toBeVisible();
 const save=async()=>{const wait=page.waitForEvent('download');await globalClick(page,'svg');return readFile(await(await wait).path());};
 const before=await save();await globalClick(page,'settings');await page.locator('[data-pref=theme]').selectOption('dark');await page.keyboard.press('Escape');
 expect(await page.locator('#gantt').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(22, 26, 24)');
 const after=await save();expect(after.equals(before)).toBe(true);await expect(page.locator('.timeline-shell')).not.toHaveClass(/export-capture/);
});
test('task labels use readable contrast without changing the authored colour',async({page})=>{
 await page.goto('/');await expect(page.locator('#gantt svg.gantt')).toBeVisible();const before=await model(page);
 const labels=await page.locator('.bar-wrapper:not(.drag-anchor) .bar-label:not(.big)').evaluateAll(es=>es.map(e=>({fill:e.style.fill,text:e.textContent})));
 expect(labels.some(e=>e.fill==='rgb(255, 255, 255)')).toBe(true);expect(await model(page)).toEqual(before);
});
