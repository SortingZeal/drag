import { test, expect } from './audit-fixture.js';
import { globalClick } from './global-actions.js';

const model = {
  title: 'Delivery', presentation: {milestoneShape:'circle', locks:{milestoneShape:true}},
  projects: [{id:'p',name:'Product',color:'#447788',locks:{},phases:[
    {id:'a',label:'First',start:'2026-01-01',end:'2026-01-10',locks:{},
      milestone:{label:'Review',date:'2026-01-05',source:{keep:true}}},
    {id:'b',label:'Second',start:'2026-01-05',end:'2026-01-20',locks:{},progress:'42.5'},
  ]}],
};
const task = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')).projects[0].phases[0]);
async function open(page) {
  await page.clock.setFixedTime(new Date('2026-01-21T12:00:00Z'));
  await page.addInitScript(data => {
    if (!localStorage.getItem('drag.draft')) localStorage.setItem('drag.draft',JSON.stringify(data));
  },model);
  await page.goto('/');
  await page.locator('[data-select-f="0:0"] .tree-label').click();
}

test('a continuous progress drag after choosing Blocked can be undone to unreported', async ({page}) => {
  await open(page);
  await page.locator('[data-status-choice="2"]').click();
  await expect(page.locator('[data-status-choice="2"]')).toBeFocused();
  expect(await task(page)).toMatchObject({status:'受阻'});
  expect((await task(page)).progress).toBeUndefined();
  const slider = page.locator('[data-progress-slider]');
  await slider.scrollIntoViewIfNeeded();
  const bounds = await slider.boundingBox();
  await page.mouse.move(bounds.x + 9,bounds.y+bounds.height/2);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.65,bounds.y+bounds.height/2,{steps:8});
  await page.mouse.up();
  const reported=await task(page);
  expect(reported.progress).toBeGreaterThan(55);
  expect(reported.progress).toBeLessThan(76);
  await globalClick(page,'undo');
  expect((await task(page)).progress).toBeUndefined();
  expect((await task(page)).status).toBe('受阻');
  await slider.focus(); await slider.press('Home');
  expect((await task(page)).progress).toBe(0);
  await expect(slider).toBeFocused();
  await page.locator('[data-clear-progress]').click();
  expect((await task(page)).progress).toBe('');
});

test('milestone date shortcuts and custom shape preserve nested metadata and history', async ({page}) => {
  await open(page);
  const date = page.locator('[data-field="milestoneDate"]');
  const label = page.locator('[data-field="milestone"]');
  await expect(label).toHaveValue('Review');
  await expect(date).toHaveValue('2026-01-05');
  await page.locator('[data-milestone-anchor="end"]').click();
  await expect(page.locator('[data-milestone-anchor="end"]')).toBeFocused();
  let updated=await task(page);
  expect(updated.milestone).toEqual({...model.projects[0].phases[0].milestone,date:'2026-01-10'});
  expect(updated).not.toHaveProperty('milestoneDate');
  await label.fill('Sign-off'); await label.press('Tab');
  await page.locator('[data-milestone-shape="star"]').click();
  expect(await task(page)).toMatchObject({milestone:{label:'Sign-off',date:'2026-01-10',source:{keep:true}},milestoneShape:'star',locks:{milestoneShape:true}});
  await page.locator('[data-milestone-anchor="clear"]').click();
  expect((await task(page)).milestone).toEqual({label:'Sign-off',date:'',source:{keep:true}});
  await globalClick(page,'undo');
  await expect(date).toHaveValue('2026-01-10');
  await page.locator('[data-milestone-shape=""]').click();
  expect(await task(page)).not.toHaveProperty('milestoneShape');
  await page.reload();
  await page.locator('[data-select-f="0:0"] .tree-label').click();
  await expect(label).toHaveValue('Sign-off');
});

test('quick status taps and slider changes keep one draft until Save and next', async ({page}) => {
  await open(page);
  await page.locator('[data-action="tracking"]').click();
  await page.locator('[data-weekly-project="0"][data-weekly-phase="0"]').click();
  await page.locator('#weekly-report-form [data-status-choice="1"]').click();
  const slider = page.locator('#weekly-report-form [data-progress-slider]');
  await slider.press('End');
  await expect(page.locator('#weekly-report-progress')).toHaveValue('100');
  await expect(page.locator('#weekly-report-status')).toHaveValue('已完成');
  await slider.press('ArrowLeft');
  await expect(page.locator('#weekly-report-status')).toHaveValue('進行中');
  await slider.press('End');
  expect(await task(page)).toEqual(model.projects[0].phases[0]);
  await page.locator('[data-weekly-discard]').click();
  await expect(slider).toHaveAttribute('aria-valuetext','未回報');
  await expect(page.locator('#weekly-report-form [data-status-choice="1"]')).toHaveAttribute('aria-pressed','false');
  await page.locator('#weekly-report-form [data-status-choice="3"]').click();
  await slider.press('End');
  await page.locator('[data-weekly-save]').click();
  expect(await task(page)).toMatchObject({progress:100,status:'已完成'});
  await globalClick(page,'undo');
  expect(await task(page)).toEqual(model.projects[0].phases[0]);
});

test('status presets set, clear and reapply progress as one reversible edit', async ({page}) => {
  await open(page);
  const slider = page.locator('#editor [data-progress-slider]');
  const exact = page.locator('#editor [data-task-progress]');
  async function preset(index, progress, status) {
    await page.locator(`#editor [data-status-choice="${index}"]`).click();
    await expect(exact).toHaveValue(progress === undefined ? '' : String(progress));
    await expect(slider).toHaveAttribute('aria-valuetext', progress === undefined ? '未回報' : progress + '%');
    const saved = await task(page);
    expect(saved.status).toBe(status);
    expect(saved.progress).toBe(progress);
  }
  await preset(3, 100, '已完成');
  await preset(0, 0, '未開始');
  await preset(1, undefined, '進行中');
  await exact.fill('42.5'); await exact.press('Enter');
  await preset(1, undefined, '進行中');
  await globalClick(page, 'undo');
  expect(await task(page)).toMatchObject({status:'進行中',progress:42.5});
  await preset(2, undefined, '受阻');
  await globalClick(page, 'undo');
  expect(await task(page)).toMatchObject({status:'進行中',progress:42.5});
});

test('English tracking presets update only the draft until saved', async ({page}) => {
  await open(page);
  await page.locator('#workspace-language').selectOption('en');
  await page.locator('[data-action="tracking"]').click();
  await page.locator('[data-weekly-project="0"][data-weekly-phase="0"]').click();
  const form = page.locator('#weekly-report-form');
  const progress = form.locator('[data-task-progress]');
  for (const [index,value] of [[3,'100'],[1,''],[0,'0'],[2,'']]) {
    await form.locator(`[data-status-choice="${index}"]`).click();
    await expect(progress).toHaveValue(value);
    expect(await task(page)).toEqual(model.projects[0].phases[0]);
  }
  await form.locator('[data-weekly-discard]').click();
  await expect(form.locator('[data-task-status]')).toHaveValue('');
  await form.locator('[data-status-choice="3"]').click();
  await form.locator('[data-weekly-save]').click();
  expect(await task(page)).toMatchObject({status:'Completed',progress:100});
  await globalClick(page,'undo');
  expect(await task(page)).toEqual(model.projects[0].phases[0]);
});
