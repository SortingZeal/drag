import { test, expect } from './audit-fixture.js';
import { normalizeModel } from '../src/model.js';

test('tracking intersects project and reason counts and keeps the review separate from the chart', async ({page}) => {
  await page.clock.setFixedTime(new Date('2028-01-05T10:00:00+08:00'));
  const task = (id,label,end,extra) => ({id,label,start:'2027-11-01',end,...extra});
  const model={title:'Tracking',projects:[
    {id:'p1',name:'Design',phases:[task('a','Launch <v2>','2028-01-04',{status:'Blocked',progress:40}),task('b','Design review','2028-01-08',{progress:70})]},
    {id:'p2',name:'Delivery',phases:[task('c','Trial','2028-01-07',{progress:20})]},
  ]};
  await page.addInitScript(seed=>{
    if(!localStorage.getItem('drag.draft'))localStorage.setItem('drag.draft',JSON.stringify(seed));
    localStorage.setItem('drag.preferences',JSON.stringify({version:1,values:{language:'en',startupMode:'last'}}));
  },normalizeModel(model));
  await page.goto('/');
  const before=await page.evaluate(()=>localStorage.getItem('drag.draft'));
  await page.locator('.bar-wrapper .bar').first().click({position:{x:24,y:3}});
  await expect(page.locator('.bottom')).toBeVisible();
  await page.locator('[data-action=tracking]').click();
  const review=page.locator('#tracking-page');
  await expect(review.getByRole('heading',{name:'Weekly review'})).toBeVisible();
  await expect(review.locator('.review-header p')).toContainText('2028');
  await expect(page.locator('.project-sidebar')).toBeHidden();
  await expect(page.locator('[data-action=export-menu]')).toBeDisabled();
  const filter=key=>review.locator(`[data-weekly-filter="${key}"]`);
  await expect(filter('all').locator('b')).toHaveText('3');
  await expect(filter('due').locator('b')).toHaveText('2');
  await review.locator('#tracking-project-filter').selectOption('p2');
  await expect(filter('blocked').locator('b')).toHaveText('0');
  await filter('blocked').click();await expect(review.locator('.weekly-row')).toHaveCount(0);
  await review.getByRole('button',{name:'Clear filters'}).click();
  await filter('overdue').click();
  await expect(review.locator('.weekly-row')).toHaveCount(1);
  await review.getByRole('button',{name:/Launch <v2>/}).press('Enter');
  await expect(review.locator('#weekly-report-status')).toBeFocused();
  await review.locator('#weekly-report-note').fill('Draft only');
  await page.locator('[data-action=simple]').click();
  await expect(page.locator('#tracking-page')).toHaveCount(0);
  await expect(page.locator('.picture-canvas svg')).toBeVisible();
  await expect(page.locator('.bottom')).toBeHidden();
  await page.locator('[data-action=tracking]').click();
  await expect(review.locator('#weekly-report-note')).toHaveValue('Draft only');
  expect(await page.evaluate(()=>localStorage.getItem('drag.draft'))).toBe(before);
  await review.locator('#weekly-report-note').press('Escape');
  await expect(review.getByRole('button',{name:/Launch <v2>/})).toBeFocused();
});
