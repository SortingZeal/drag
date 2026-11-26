import { test, expect } from './audit-fixture.js';
import { clickAction, openViewOptions } from './global-actions.js';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const seed=JSON.parse(readFileSync(new URL('../public/roadmap.json',import.meta.url),'utf8'));
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
const chart=page=>page.locator('.infographic-preview svg[data-simple="true"]');
async function mount(page){
  const model=structuredClone(seed);
  model.metadata={preserve:['simple',5]};
  model.projects.forEach((p,pi)=>{p.id??='simple-project-'+pi;p.locks={...p.locks,color:true};p.phases.forEach((f,fi)=>{f.id??='simple-phase-'+pi+'-'+fi;f.locks={...f.locks,label:true};});});
  await page.addInitScript(value=>{if(!localStorage.getItem('simple.seeded')){localStorage.setItem('drag.draft',JSON.stringify(value));localStorage.setItem('simple.seeded','true');}},model);
  await page.goto('/');await page.locator('[data-action="simple"]').click();
  await expect(chart(page)).toBeVisible();return model;
}
async function download(page,action){const event=page.waitForEvent('download');await clickAction(page,action);return event;}
test.beforeEach(async({page},info)=>{info.simplePageErrors=[];page.on('pageerror',e=>info.simplePageErrors.push(e.message));});
test.afterEach(async({},info)=>{expect(info.simplePageErrors).toEqual([]);});

test('simple SVG and 4K PNG exports contain all source projects and leave locks, dates and metadata intact',async({page},info)=>{
  const model=await mount(page);
  const vector=await download(page,'svg');
  expect(vector.suggestedFilename()).toBe('drag-simple.svg');
  await vector.saveAs(info.outputPath('simple.svg'));
  const xml=await readFile(await vector.path(),'utf8');
  const parsed=await page.evaluate(value=>{
    const svg=new DOMParser().parseFromString(value,'image/svg+xml');
    return {errors:svg.querySelectorAll('parsererror').length,unsafe:svg.querySelectorAll('script,foreignObject,image[href^="http"]').length,projects:svg.querySelectorAll('g[data-project-id]').length,phases:svg.querySelectorAll('g[data-phase-id]').length,width:svg.documentElement.getAttribute('width'),height:svg.documentElement.getAttribute('height'),dates:[...svg.querySelectorAll('g[data-phase-id]')].map(n=>({start:n.dataset.start,end:n.dataset.end}))};
  },xml);
  expect(parsed).toEqual({errors:0,unsafe:0,projects:7,phases:15,width:'3840',height:'2160',dates:model.projects.flatMap(p=>p.phases.map(f=>({start:f.start,end:f.end})))});
  const bitmap=await download(page,'png');
  expect(bitmap.suggestedFilename()).toBe('drag-simple.png');
  await bitmap.saveAs(info.outputPath('simple.png'));
  const png=await readFile(await bitmap.path());
  expect(png.readUInt32BE(16)).toBe(3840);expect(png.readUInt32BE(20)).toBe(2160);
  const colored=await page.evaluate(async body=>{const img=new Image();img.src='data:image/png;base64,'+body;await img.decode();const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const c=canvas.getContext('2d');c.drawImage(img,0,0,960,540);const a=c.getImageData(0,0,960,540).data;let count=0;for(let i=0;i<a.length;i+=4)if(a[i+3]>250&&Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])>45)count++;return count;},png.toString('base64'));
  expect(colored).toBeGreaterThan(1000);
  const header=await download(page,'svg');expect(header.suggestedFilename()).toBe('drag-simple.svg');
  expect(await draft(page)).toEqual(model);
  await page.screenshot({path:info.outputPath('simple-preview.png'),fullPage:true});
});

test('simple and presentation modes share explicit portable settings without rewriting phase data',async({page})=>{
  const model=await mount(page);
  await openViewOptions(page);
  for(const [selector,value] of [['#report-title','簡易時程：主管閱讀版'],['#report-start','2026-10-01'],['#report-end','2028-02-29']]){await page.locator(selector).fill(value);await page.locator(selector).press('Tab');await page.locator(selector).blur();}
  await page.locator('#report-shape').selectOption('star');
  const updated=await draft(page);
  expect(updated.projects).toEqual(model.projects);
  expect(updated.title).toBe(model.title);expect(updated.locks).toEqual(model.locks);
  expect(updated.presentation).toEqual({title:'簡易時程：主管閱讀版',start:'2026-10-01',end:'2028-02-29',milestoneShape:'star',locks:{title:true,start:true,end:true,milestoneShape:true}});
  await page.locator('[data-action="timeline"]').click();await expect(page.locator('.bar-wrapper .bar')).toHaveCount(15);
  await page.locator('[data-action="simple"]').click();await expect(page.locator('#report-title')).toHaveValue(updated.presentation.title);expect(await draft(page)).toEqual(updated);
  const file=await download(page,'save');expect(JSON.parse(await readFile(await file.path(),'utf8'))).toEqual(updated);
  await page.reload();await page.locator('[data-action="simple"]').click();
  await expect(chart(page)).toHaveAttribute('data-end','2028-02-29');expect(await draft(page)).toEqual(updated);
});
