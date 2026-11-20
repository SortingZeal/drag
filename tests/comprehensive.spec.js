import { globalClick, clickAction } from './global-actions.js';
import { test, expect } from './audit-fixture.js';
import { readFile } from 'node:fs/promises';
const action=(page,name)=>page.locator(`[data-action="${name}"]`);
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
function fixture(){return {title:'完整驗收 QA',metadata:{unknown:['保留',{v:5121}]},locks:{title:true},projects:Array.from({length:3},(_,pi)=>({id:`qa-p${pi}`,name:`專案${pi}`,color:['#123456','#a54320','#246a51'][pi],icon:'★',locks:{color:true},metadata:{pi},phases:Array.from({length:4},(_,fi)=>({id:`qa-${pi}-${fi}`,label:`階段${pi}-${fi}`,start:'2028-02-05',end:'2028-02-25',milestone:'驗收',milestoneDate:'2028-02-20',locks:{label:true},metadata:{pi,fi,unknown:[true,null]}}))}))};}
async function mount(page,model=fixture()){
 await page.addInitScript(value=>{if(!localStorage.getItem('qa.seeded')){localStorage.setItem('drag.draft',JSON.stringify(value));localStorage.setItem('drag.paneHeight','48');localStorage.setItem('qa.seeded','1');}},model);
 await page.goto('/');await expect(action(page,'global-menu')).toBeVisible();return model;
}
async function change(page,field,value){const n=page.locator(`[data-field="${field}"]`);if(field==='color'){await n.evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));},value);}else{await n.fill(value);await n.press('Tab');await n.blur();}}
async function exported(page,type,info,name){const pending=page.waitForEvent('download');await globalClick(page,type);const d=await pending;await d.saveAs(info.outputPath(name));return readFile(await d.path());}
test.beforeEach(async({page},info)=>{info.qaPageErrors=[];page.on('pageerror',e=>info.qaPageErrors.push(e.message));});
test.afterEach(async({},info)=>expect(info.qaPageErrors).toEqual([]));

async function dragOutlineRow(source, target, edge){
 const bounds=await target.boundingBox();
 const y=edge==='before'?3:Math.floor(bounds.height)-3;
 await source.locator('.drag-handle').dragTo(target,{targetPosition:{x:40,y}});
}

test('project sorting in both directions preserves complete records, history and reload',async({page})=>{
 const original=await mount(page);
 await dragOutlineRow(page.locator('[data-select-p="0"]'),page.locator('[data-select-p="2"]'),'after');
 const expected=structuredClone(original);expected.projects.push(expected.projects.shift());
 await expect.poll(()=>draft(page)).toEqual(expected);
 await expect(page.locator('[data-select-p="2"]')).toHaveClass(/selected/);
 await globalClick(page,'undo');expect(await draft(page)).toEqual(original);
 await globalClick(page,'redo');expect(await draft(page)).toEqual(expected);
 await dragOutlineRow(page.locator('[data-select-p="2"]'),page.locator('[data-select-p="0"]'),'before');
 await expect.poll(()=>draft(page)).toEqual(original);
 await page.reload();expect(await draft(page)).toEqual(original);
});

test('same-project task reorder forward/backward retains ids, metadata, dates and locks',async({page})=>{
 const original=await mount(page);
 await dragOutlineRow(page.locator('[data-select-f="0:0"]'),page.locator('[data-select-f="0:3"]'),'after');
 const expected=structuredClone(original);const moved=expected.projects[0].phases.shift();moved.locks.parent=true;expected.projects[0].phases.push(moved);
 await expect.poll(()=>draft(page)).toEqual(expected);
 await globalClick(page,'undo');expect(await draft(page)).toEqual(original);
 await globalClick(page,'redo');expect(await draft(page)).toEqual(expected);
 await dragOutlineRow(page.locator('[data-select-f="0:3"]'),page.locator('[data-select-f="0:0"]'),'before');
 const back=structuredClone(original);back.projects[0].phases[0].locks.parent=true;
 await expect.poll(()=>draft(page)).toEqual(back);await page.reload();expect(await draft(page)).toEqual(back);
});

for(const kind of ['project','task'])test(`all 17 ${kind} icon buttons change actual tree and both vectors without altering other fields`,async({page})=>{
 await mount(page);
 if(kind==='project'){await page.locator('[data-select-p="0"]').click();}else{await page.locator('[data-select-f="0:0"]').click();}
 await page.locator('.icon-picker summary').click();
 const values=await page.locator('[data-icon]').evaluateAll(nodes=>nodes.map(n=>n.dataset.icon));expect(values).toHaveLength(17);
 for(const value of values){
  const before=await draft(page);
  await page.locator('[data-icon]').nth(values.indexOf(value)).click();
  const expected=structuredClone(before),target=kind==='project'?expected.projects[0]:expected.projects[0].phases[0];target.icon=value;target.locks.icon=true;
  expect(await draft(page)).toEqual(expected);
  await expect(page.locator(kind==='project'?'[data-select-p="0"] .tree-icon':'[data-select-f="0:0"] .phase-icon')).toHaveText(value||(kind==='project'?'':'↳'));
  for(const mode of ['simple']){
   await clickAction(page, mode);
   const scope=page.locator(kind==='project'?'svg [data-project-id="qa-p0"]':'svg [data-phase-id="qa-0-0"]');
   const rendered=await scope.textContent();if(value)expect(rendered).toContain(value);
   if(kind==='project')await expect(scope.locator('[data-role="project-icon"]')).toHaveCount(value?1:0);
   expect(await draft(page)).toEqual(expected);
  }
  await clickAction(page, 'timeline');
  if(kind==='task'&&value)await expect(page.locator('.bar-wrapper[data-id="qa-0-0"] .bar-label')).toContainText(value);
 }
 await change(page,'icon','👩🏽‍💻🧑‍🚀');expect((kind==='project'?(await draft(page)).projects[0]:(await draft(page)).projects[0].phases[0]).icon).toBe('👩🏽‍💻🧑‍🚀');
});

test('every task property commits only its own field/lock and survives undo redo reload',async({page})=>{
 test.setTimeout(60000); // Eighteen edits, undo/redo, reload and audit teardown on native Windows runners.
 await mount(page);await page.locator('[data-select-f="0:0"]').click();
 for(const [key,value,stored]of [['label','完整任務名稱','完整任務名稱'],['start','2028-02-01','2028-02-01'],['end','2028-02-29','2028-02-29'],['milestone','里程碑內容','里程碑內容'],['milestoneDate','2028-02-29','2028-02-29'],['milestoneDate','',''],['status','進行中','進行中'],['progress','0',0],['progress','100',100],['progress','37',37],['progress','',''],['fontSize','8',8],['fontSize','160',160],['fontSize','','DELETE']]){
  const before=await draft(page);await change(page,key,value);const expected=structuredClone(before),t=expected.projects[0].phases[0];if(stored==='DELETE')delete t[key];else t[key]=stored;t.locks[key]=true;
  expect(await draft(page)).toEqual(expected);await globalClick(page,'undo');expect(await draft(page)).toEqual(before);await globalClick(page,'redo');expect(await draft(page)).toEqual(expected);
 }
 for(const key of ['open_end','light'])for(const checked of [true,false]){
  const before=await draft(page);await page.locator(`[data-check="${key}"]`).setChecked(checked);const expected=structuredClone(before);expected.projects[0].phases[0][key]=checked;expected.projects[0].phases[0].locks[key]=true;expect(await draft(page)).toEqual(expected);
 }
 const final=await draft(page);await page.reload();expect(await draft(page)).toEqual(final);
});

test('invalid and empty task dates, progress and font boundaries reject without creating history',async({page})=>{
 const model=await mount(page);await page.locator('[data-select-f="0:0"]').click();const errors=[];page.on('dialog',async d=>{errors.push(d.message());await d.accept();});
 for(const[key,value]of [['start','2028-03-01'],['end','2028-02-01'],['start',''],['end',''],['progress','-1'],['progress','101'],['fontSize','7'],['fontSize','161']]){
  const count=errors.length;await change(page,key,value);expect(errors.length).toBe(count+1);expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
 }
});

test('project name/color/font properties render exactly and preserve all other records',async({page})=>{
 await mount(page);await page.locator('[data-select-p="0"]').click();
 for(const[key,value,stored]of [['name','專案 — 完整名稱','專案 — 完整名稱'],['color','#ed8040','#ed8040'],['fontSize','8',8],['fontSize','160',160],['fontSize','','DELETE']]){
  const before=await draft(page);await change(page,key,value);const expected=structuredClone(before);if(stored==='DELETE')delete expected.projects[0][key];else expected.projects[0][key]=stored;expected.projects[0].locks[key]=true;expect(await draft(page)).toEqual(expected);
  for(const mode of ['simple']){await clickAction(page, mode);const group=page.locator('svg [data-project-id="qa-p0"]');await expect(group.locator('[data-role="project-name"]')).toHaveText(expected.projects[0].name);if(key==='fontSize'&&value)await expect(group.locator('[data-role="project-name"]')).toHaveAttribute('font-size',value);}
  await clickAction(page, 'timeline');await globalClick(page,'undo');expect(await draft(page)).toEqual(before);await globalClick(page,'redo');expect(await draft(page)).toEqual(expected);
 }
});

for(const mode of ['simple'])test(`${mode} independent leap-day vector positions, standalone refs and 4K raster match`,async({page},info)=>{
 const model=fixture();model.projects=model.projects.slice(0,1);model.presentation={start:'2028-02-01',end:'2028-02-29',milestoneShape:'star'};
 model.projects[0].phases=model.projects[0].phases.slice(0,3);model.projects[0].phases.forEach((f,i)=>{f.start=['2028-02-01','2028-02-15','2028-02-29'][i];f.end=f.start;f.milestoneDate=f.start;f.progress=50;});
 await mount(page,model);await clickAction(page, mode);
 const xml=(await exported(page,'svg',info,`${mode}-leap.svg`)).toString();
 const result=await page.evaluate(xml=>{
  const doc=new DOMParser().parseFromString(xml,'image/svg+xml'),svg=doc.documentElement;
  const ids=[...svg.querySelectorAll('[id]')].map(n=>n.id),refs=[...xml.matchAll(/url\(#([^)]*)\)/g)].map(m=>m[1]);
  return{errors:doc.querySelectorAll('parsererror').length,ids,refs,unsafe:svg.querySelectorAll('script,foreignObject,image[href^="http"]').length,bad:/NaN|Infinity|undefined/.test(xml),bars:[...svg.querySelectorAll('[data-role="phase-bar"]')].map(n=>({x:+n.getAttribute('x'),width:+n.getAttribute('width')})),markers:[...svg.querySelectorAll('[data-role="milestone-symbol"]')].map(n=>{const pts=[...n.points];return pts.reduce((s,p)=>s+p.x,0)/pts.length;})};
 },xml);
 expect(result.errors).toBe(0);expect(result.unsafe).toBe(0);expect(result.bad).toBe(false);expect(new Set(result.ids).size).toBe(result.ids.length);for(const ref of result.refs)expect(result.ids).toContain(ref);
 const left=mode==='simple'?420:450,right=mode==='simple'?1908:1860;
 for(let i=0;i<3;i++){
  const day=[1,15,29][i],raw=left+(day-1)/29*(right-left);
  // 圖檔 deliberately leaves a 3px border inside the chart; this is visual
  // padding, never a change to the saved civil date. SVGPoint uses float32.
  const x=mode==='simple'?Math.max(left+3,Math.min(right-6,raw)):raw;
  const end=mode==='simple'?Math.max(x+3,Math.min(right-3,left+day/29*(right-left))):left+day/29*(right-left);
  expect(result.bars[i].x).toBeCloseTo(x,3);expect(result.bars[i].width).toBeCloseTo(end-x,3);
  expect(result.markers[i]).toBeCloseTo(Math.max(left+(mode==='simple'?12:8),Math.min(right-(mode==='simple'?12:8),raw)),3);
 }
 const png=await exported(page,'png',info,`${mode}-leap.png`);expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([3840,2160]);
 const pixels=await page.evaluate(async({xml,png})=>{async function raster(src){const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=3840;c.height=2160;const ctx=c.getContext('2d');ctx.drawImage(im,0,0,3840,2160);return ctx.getImageData(0,0,3840,2160).data;}const a=await raster('data:image/svg+xml;base64,'+xml),b=await raster('data:image/png;base64,'+png);let diff=0,max=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);if(delta>1)diff++;max=Math.max(max,delta);}return{diff,max};},{xml:Buffer.from(xml).toString('base64'),png:png.toString('base64')});
 expect(pixels.diff).toBe(0);
 const baseline=xml;await page.locator('[data-picture-action="zoom-in"]').click();const b=await page.locator('.picture-viewport').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+100,b.y+b.height/2+60,{steps:5});await page.mouse.up();
 expect((await exported(page,'svg',info,`${mode}-after-view.svg`)).toString()).toBe(baseline);expect(await draft(page)).toEqual(model);
});

for(const mode of ['simple'])test(`${mode} maximum manual fonts, long text and right-edge one-day tasks remain inside vector bounds`,async({page},info)=>{
 const model=fixture();model.title='長標題驗收'.repeat(12);model.projects=model.projects.slice(0,1);model.presentation={start:'2028-02-01',end:'2028-02-29',milestoneShape:'star'};
 model.projects[0].name='專案名稱完整顯示'.repeat(5);model.projects[0].fontSize=160;
 model.projects[0].phases=[{...model.projects[0].phases[0],label:'長任務名稱'.repeat(6),start:'2028-02-29',end:'2028-02-29',fontSize:160,milestoneDate:'2028-02-29',milestone:'最後一天里程碑完整內容'.repeat(5),icon:'🚀'}];
 await mount(page,model);await clickAction(page, mode);
 const overflow=await page.locator('.infographic-preview svg').evaluate(svg=>{
  const bounds=svg.viewBox.baseVal,inv=svg.getCTM().inverse();
  return [...svg.querySelectorAll('text')].filter(n=>n.textContent.trim()).map(n=>{
   const box=n.getBBox(),matrix=inv.multiply(n.getCTM()),pts=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
   return{role:n.dataset.role,text:n.textContent,minX:Math.min(...pts.map(p=>p.x)),maxX:Math.max(...pts.map(p=>p.x)),minY:Math.min(...pts.map(p=>p.y)),maxY:Math.max(...pts.map(p=>p.y)),width:bounds.width,height:bounds.height};
  }).filter(b=>b.minX<-.5||b.minY<-.5||b.maxX>b.width+.5||b.maxY>b.height+.5);
 });
 await info.attach('vector-overflow',{body:JSON.stringify(overflow,null,2),contentType:'application/json'});
 expect(overflow).toEqual([]);expect(await draft(page)).toEqual(model);
 await exported(page,'svg',info,`${mode}-extreme.svg`);await page.screenshot({path:info.outputPath(`${mode}-extreme.png`),fullPage:true});
});

test('all modes and densities at minimum desktop size keep controls contained and editable',async({page},info)=>{
 const model=await mount(page);await page.setViewportSize({width:1024,height:700});
 for(const mode of ['timeline', 'simple'])for(const size of ['small','medium','large']){
  await clickAction(page, mode);await globalClick(page,'settings');await page.locator(`button[data-ui-size="${size}"]`).click();await page.keyboard.press('Escape');
  const result=await page.evaluate(()=>{const doc=document.documentElement,main=document.querySelector('main').getBoundingClientRect(),controls=[...document.querySelectorAll('header button,.toolbar button,[data-action="settings"],.picture-tools button')].filter(n=>n.checkVisibility());return{pageOverflow:doc.scrollWidth>doc.clientWidth+1,bottom:main.bottom,height:innerHeight,blocked:controls.filter(n=>{const r=n.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1||!n.contains(target);}).map(n=>({text:n.textContent,action:n.dataset.action}))};});
  expect(result.pageOverflow).toBe(false);expect(result.bottom).toBeLessThanOrEqual(result.height+1);expect(result.blocked).toEqual([]);
  await page.locator('[data-select-f="0:0"]').click();const field=page.locator('[data-field="label"]');await expect(field).toHaveValue(model.projects[0].phases[0].label);
  await page.screenshot({path:info.outputPath(`${mode}-${size}-1024.png`),fullPage:true});
 }
 expect(await draft(page)).toEqual(model);await expect(action(page,'undo')).toBeDisabled();
});

test('300 tasks retain complete content and model when switching, sorting, exporting and reloading',async({page},info)=>{
 test.setTimeout(90000);const model=fixture();model.projects=Array.from({length:15},(_,pi)=>({...structuredClone(model.projects[pi%3]),id:`large-p${pi}`,name:`大量專案${pi}`,phases:Array.from({length:20},(_,fi)=>({...structuredClone(model.projects[0].phases[0]),id:`large-${pi}-${fi}`,label:`任務 ${pi}-${fi}`,milestone:'',milestoneDate:''}))}));
 await mount(page,model);await expect(page.locator('.bar-wrapper .bar')).toHaveCount(300);
 for(const mode of ['simple']){await clickAction(page, mode);await expect(page.locator('svg [data-phase-id]')).toHaveCount(300);const xml=(await exported(page,'svg',info,`${mode}-300-tasks.svg`)).toString();expect((xml.match(/data-phase-id=/g)||[]).length).toBe(300);expect(await draft(page)).toEqual(model);}
 await page.reload();expect(await draft(page)).toEqual(model);await expect(page.locator('.bar-wrapper .bar')).toHaveCount(300,{timeout:30000});
});

test('repeated left/right padding rebuilds preserve the visible calendar anchor without cumulative pixel drift',async({page})=>{
 test.setTimeout(90000);
 const model=await mount(page);await page.locator('#view').selectOption('Day');
 await page.locator('.bar-wrapper[data-id="qa-0-0"] .bar').evaluate(n=>{const p=document.querySelector('.preview');p.scrollLeft+=n.getBoundingClientRect().left-p.getBoundingClientRect().left-300;});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const before=await page.locator('.bar-wrapper[data-id="qa-0-0"] .bar').boundingBox();
 for(let i=0;i<8;i++)for(const name of ['expand-left','expand-right','shrink-left','shrink-right']){
  await clickAction(page, name);const box=await page.locator('.bar-wrapper[data-id="qa-0-0"] .bar').boundingBox();expect(Math.abs(box.x-before.x)).toBeLessThanOrEqual(2);
 }
 expect(await draft(page)).toEqual(model);
});
