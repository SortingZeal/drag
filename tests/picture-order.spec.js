import { readFile } from 'node:fs/promises';
import { test, expect } from './audit-fixture.js';
import { clickAction } from './global-actions.js';

const task = (id, start, end) => ({id, label:id, start, end, metadata:{owner:id}, locks:{label:true}});
const model = {
  title:'Canvas order', presentation:{start:'2028-01-01',end:'2028-03-31'},
  projects:[
    {id:'plan',name:'Planning',phases:[task('brief','2028-01-04','2028-01-19'),task('review','2028-02-02','2028-02-22')]},
    {id:'build',name:'Building',phases:[task('build-one','2028-01-10','2028-01-25'),task('build-two','2028-03-01','2028-03-22')]},
    {id:'empty',name:'Archive',phases:[]}
  ]
};
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const stage = (page,id) => page.locator(`.picture-canvas [data-phase-id="${id}"]`);
const label = (page,id) => page.locator(`.picture-canvas [data-project-id="${id}"] [data-role="project-label"]`);
const order = data => data.projects.map(project => [project.id, project.phases.map(task=>task.id)]);
async function mount(page, initial=model) {
  await page.addInitScript(model => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft',JSON.stringify(model));
  }, initial);
  await page.goto('/');
  await clickAction(page,'simple');
  await expect(stage(page,'brief')).toBeVisible();
}
async function point(locator, fraction=.5) {
  const r = await locator.boundingBox();
  return {x:r.x+r.width*.5,y:r.y+r.height*fraction};
}
async function drag(page,from,to,{cancel=false}={}) {
  await page.mouse.move(from.x,from.y);
  await page.mouse.down();
  // Establish the vertical axis before targeting a task with different dates.
  await page.mouse.move(from.x,from.y+Math.sign(to.y-from.y)*6);
  await page.mouse.move(to.x,to.y,{steps:4});
  await expect(page.locator('.picture-order-guide')).toBeVisible();
  if(cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.picture-order-guide')).toBeHidden();
}
async function download(page,action) {
  const pending=page.waitForEvent('download');
  await clickAction(page,action);
  return readFile(await (await pending).path(),'utf8');
}

test('vertically reordering compact tasks creates visible lanes only in their project, with undo and matching SVG and JSON',async({page})=>{
  await mount(page);
  const initial=await saved(page);
  const brief=stage(page,'brief'),review=stage(page,'review');
  await expect(brief).toHaveAttribute('data-lane','0');
  await expect(review).toHaveAttribute('data-lane','0');
  const from=await point(brief.locator('[data-role="phase-bar"]'));
  const target=await point(review.locator('[data-role="phase-bar"]'),.85);
  await drag(page,from,target);
  await expect(brief).toHaveAttribute('data-lane','1');
  await expect(review).toHaveAttribute('data-lane','0');
  expect((await point(brief)).y).toBeGreaterThan((await point(review)).y);
  await expect(stage(page,'build-two')).toHaveAttribute('data-lane','0');
  const after=await saved(page);
  expect(after.projects[0].pictureTaskLayout).toBe('ordered');
  expect(after.projects[1]).toEqual(initial.projects[1]);
  expect(after.projects[0].phases.map(task=>task.id)).toEqual(['review','brief']);
  expect(after.projects[0].phases[1]).toMatchObject(initial.projects[0].phases[0]);
  expect(JSON.parse(await download(page,'save'))).toEqual(after);
  const svg=await download(page,'svg');
  const lanes=await page.evaluate(markup=>[...new DOMParser().parseFromString(markup,'image/svg+xml').querySelectorAll('[data-project-id="plan"] [data-phase-id]')].map(stage=>[stage.dataset.phaseId,stage.dataset.lane]),svg);
  expect(lanes).toEqual([['review','0'],['brief','1']]);
  expect(svg).not.toMatch(/aria-keyshortcuts|picture-order-|role="button"|tabindex=/);
  await clickAction(page,'undo');
  expect(await saved(page)).toEqual(initial);
  await expect(brief).toHaveAttribute('data-lane','0');
  await clickAction(page,'redo');
  expect(await saved(page)).toEqual(after);
  await page.reload();
  await clickAction(page,'simple');
  await expect(brief).toHaveAttribute('data-lane','1');
});

test('a project label moves its entire group and a task can be dropped in an empty project without editing dates',async({page})=>{
  await mount(page);
  const initial=await saved(page);
  await drag(page,await point(label(page,'plan')),await point(label(page,'build'),.8),{cancel:true});
  expect(await saved(page)).toEqual(initial);
  await drag(page,await point(label(page,'plan')),await point(label(page,'build'),.8));
  expect(order(await saved(page))).toEqual([['build',['build-one','build-two']],['plan',['brief','review']],['empty',[]]]);
  await clickAction(page,'timeline');
  expect(await page.locator('#tree [data-select-p] .tree-label').allTextContents()).toEqual(['Building','Planning','Archive']);
  await clickAction(page,'simple');
  const sourceBody=stage(page,'brief').locator('[data-role="phase-bar"]');
  await drag(page,await point(sourceBody),await point(label(page,'empty')));
  let data=await saved(page);
  expect(data.projects[2].phases[0]).toMatchObject(initial.projects[0].phases[0]);
  expect(data.projects[2].phases[0].locks.parent).toBe(true);
  expect(data.projects[2].pictureTaskLayout).toBeUndefined();
  await clickAction(page,'undo');
  await clickAction(page,'undo');
  expect(await saved(page)).toEqual(initial);
});


test('a straight vertical pull separates an initially shared lane, and a drop on another task inserts it at the guide',async({page})=>{
  await mount(page);
  const initial = await saved(page);
  const brief = stage(page,'brief');
  const bar = brief.locator('[data-role="phase-bar"]');
  const start = await point(bar);
  await drag(page,start,{x:start.x,y:start.y+8});
  await expect(brief).toHaveAttribute('data-lane','1');
  const destination = stage(page,'build-two').locator('[data-role="phase-bar"]');
  await drag(page,await point(bar),await point(destination,.15));
  const moved = await saved(page);
  expect(moved.projects[0].phases.map(task=>task.id)).toEqual(['review']);
  expect(moved.projects[1].phases.map(task=>task.id)).toEqual(['build-one','brief','build-two']);
  expect(moved.projects[1].pictureTaskLayout).toBe('ordered');
  await expect(brief).toHaveAttribute('data-lane','1');
  await expect(stage(page,'build-two')).toHaveAttribute('data-lane','2');
  await clickAction(page,'undo');
  await clickAction(page,'undo');
  expect(await saved(page)).toEqual(initial);
});

test('keyboard users can reorder projects and tasks, switch project, keep focus and open the selected item',async({page})=>{
  await mount(page);
  const project=label(page,'plan'),brief=stage(page,'brief');
  await project.focus();
  await expect(project).toHaveAccessibleName('Planning');
  await expect(project).toHaveAccessibleDescription(/Alt/);
  await project.press('Alt+ArrowDown');
  await expect(project).toBeFocused();
  expect((await saved(page)).projects.map(p=>p.id)).toEqual(['build','plan','empty']);
  await project.press('ArrowDown');
  await expect(brief).toBeFocused();
  await brief.press('Alt+ArrowDown');
  await expect(brief).toBeFocused();
  await expect(brief).toHaveAttribute('data-lane','1');
  await brief.press('Alt+ArrowDown');
  await expect(brief).toBeFocused();
  expect((await saved(page)).projects[2].phases[0].id).toBe('brief');
  await brief.press('Enter');
  await expect(page.locator('#editor [data-field="label"]')).toHaveValue('brief');
});

test('dragging the grip across a shared lane reorders without changing dates and leaves the grip out of exports',async({page})=>{
  await mount(page);
  const initial=await saved(page);
  const bar=stage(page,'brief').locator('[data-role="phase-bar"]');
  const target=stage(page,'review').locator('[data-role="phase-bar"]');
  await bar.hover();
  const grip=page.getByRole('button',{name:/拖曳排序.*brief/});
  const from=await point(grip),to=await point(target,.8);
  await page.mouse.move(from.x,from.y);
  await page.mouse.down();
  await page.mouse.move(to.x,to.y,{steps:9});
  await expect(page.locator('.picture-order-guide')).toContainText('review');
  await expect(page.locator('.picture-date-preview')).toBeHidden();
  await page.mouse.up();
  const after=await saved(page);
  expect(after.projects[0].phases.map(f=>f.id)).toEqual(['review','brief']);
  expect(after.projects[0].phases[1]).toMatchObject(initial.projects[0].phases[0]);
  expect(await download(page,'svg')).not.toContain('picture-order-grip');
  await clickAction(page,'undo');
  expect(await saved(page)).toEqual(initial);
});

test('picture progress at 100 sets the status and undo restores both fields',async({page})=>{
  await mount(page);
  const bar=stage(page,'brief').locator('[data-role="phase-bar"]');
  await bar.click();
  const initial=await saved(page);
  await page.locator('#editor [data-progress-slider]').press('End');
  await expect(page.locator('#editor [data-task-status]')).toHaveValue('已完成');
  const after=await saved(page);
  expect(after.projects[0].phases[0]).toMatchObject({progress:100,status:'已完成',locks:{progress:true,status:true}});
  await expect(stage(page,'brief')).toContainText('已完成');
  await clickAction(page,'undo');
  expect(await saved(page)).toEqual(initial);
});

test('a task can be dropped in the blank part of a destination lane or released outside the chart to cancel',async({page})=>{
  const initial=structuredClone(model);
  initial.projects[1].pictureTaskLayout='ordered';
  await mount(page,initial);
  const original=await saved(page);
  const from=stage(page,'brief').locator('[data-role="phase-bar"]');
  const destination=stage(page,'build-one').locator('[data-role="phase-bar"]');
  const row=page.locator('.picture-canvas [data-project-id="build"] [data-role="project-row"]');
  const rowBox=await row.boundingBox();
  const lane=await point(destination,.25);
  const x=rowBox.x+rowBox.width-10;
  for (const cancel of [true,false]) {
    await from.hover();
    const grip=page.getByRole('button',{name:/拖曳排序.*brief/});
    const handle=await point(grip);
    await page.mouse.move(handle.x,handle.y);
    await page.mouse.down();
    await page.mouse.move(x,lane.y,{steps:8});
    const guide=page.locator('.picture-order-guide');
    await expect(guide).toContainText('Building');
    await expect(guide).toContainText('build-one');
    await expect(guide).toHaveAttribute('data-edge','before');
    if (cancel) await page.mouse.move(x,5);
    await page.mouse.up();
    if (cancel) expect(await saved(page)).toEqual(original);
  }
  const moved=await saved(page);
  expect(moved.projects[1].phases.map(task=>task.id)).toEqual(['brief','build-one','build-two']);
  expect(moved.projects[1].phases[0]).toMatchObject(original.projects[0].phases[0]);
});
