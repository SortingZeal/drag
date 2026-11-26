import {test,expect} from './audit-fixture.js';
const sizes=[
 {width:1024,height:700,dpr:1},
 {width:1536,height:864,dpr:1.25},
 {width:1280,height:720,dpr:1.5},
 {width:2560,height:1440,dpr:1.5},
 {width:3840,height:2160,dpr:1},
];
for(const size of sizes)test(`studio controls and panels stay reachable at ${size.width}x${size.height}, DPR ${size.dpr}`,async({browser,baseURL})=>{
 const context=await browser.newContext({viewport:{width:size.width,height:size.height},deviceScaleFactor:size.dpr});
 try{
  const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('drag.onboarding',JSON.stringify({version:1,status:'completed'})));
  await page.goto(baseURL);await expect(page.locator('#gantt svg.gantt')).toBeVisible();
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')));
  for(const mode of ['timeline','simple']){
   await page.locator(`[data-action="${mode}"]`).click();
   const item=mode==='timeline' ? page.locator('[data-select-f="0:0"]') : page.locator('.picture-canvas [data-phase-index="0"]').first();
   const open=()=>mode==='timeline'?item.click():item.press('Enter');
   await expect(page.locator('.project-sidebar')).toHaveCount(mode==='timeline'?1:0);
   await open();
   await expect(page.locator('.bottom')).toBeVisible();
   const geometry=await page.evaluate(()=>{
    const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    return{overflow:document.documentElement.scrollWidth>innerWidth+1,main:box('main'),preview:box('.preview'),panel:box('.bottom'),height:innerHeight,width:innerWidth};
   });
   expect(geometry.overflow).toBe(false);expect(geometry.main.bottom).toBeLessThanOrEqual(geometry.height+1);
   expect(geometry.preview.width).toBeGreaterThan(300);expect(geometry.preview.height).toBeGreaterThan(150);
   expect(geometry.panel.right).toBeLessThanOrEqual(geometry.width+1);
   if(mode==='timeline') expect(geometry.panel.x).toBeCloseTo(geometry.preview.x+4,0);
   else {
    expect(geometry.panel.x).toBeGreaterThanOrEqual(geometry.preview.x);
    expect(geometry.panel.y).toBeGreaterThanOrEqual(geometry.preview.y);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.preview.bottom+1);
   }
   const close=page.locator('[data-outline-close]');
   await expect(close).toBeInViewport();
   await close.click();await expect(page.locator('.bottom')).toBeHidden();
   await open();await expect(page.locator('.bottom')).toBeVisible();
   expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('drag.draft')))).toEqual(before);
  }
 }finally{await context.close();}
});
