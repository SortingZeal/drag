import { test, expect } from './audit-fixture.js';
import { selectTimelineScale, openViewOptions } from './global-actions.js';

test('global language dropdown remembers the explicit choice and keeps the project intact', async ({ page }) => {
  await page.goto('/');
  const language = page.locator('header').getByRole('combobox', {name:/Language/});
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
  await expect(language).toBeVisible();
  const initial = await draft();
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(language).toBeFocused();
  for (const name of ['Undo', 'Redo', 'Export image']) {
    await expect(page.locator('header').getByRole('button', {name, exact:true})).toBeVisible();
  }
  expect(await draft()).toEqual(initial);
  await page.reload();
  await expect(language).toHaveValue('en');
  await language.selectOption('zh-TW');
  await expect(page.locator('html')).toHaveAttribute('lang','zh-Hant');
  expect(await draft()).toEqual(initial);
});

test('one header row exposes the timeline and image controls at 320px and on desktop', async ({ page }, info) => {
  await page.goto('/');
  for (const width of [320, 1440]) {
    await page.setViewportSize({width,height:820});
    const timeline=page.locator('header [data-action=timeline]');
    await timeline.click();
    const bounds=await page.locator('header').boundingBox();
    for (const selector of ['.workspace-heading','[data-action="undo"]','[data-action="redo"]','.tabs','.view-settings > summary','[data-action="export-menu"]','.toolbar-language','.global-actions']) {
      const box=await page.locator('header '+selector).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(width+1);
      expect(box.y).toBeGreaterThanOrEqual(bounds.y);
      expect(box.y+box.height).toBeLessThanOrEqual(bounds.y+bounds.height+1);
    }
    const options=await openViewOptions(page);
    await expect(page.locator('[data-action="toggle-inspector"]')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'符合內容'})).toBeInViewport();
    await expect(page.locator('.timeline-date-dock')).toBeInViewport();
    await expect(page.locator('#snap')).toBeInViewport();
    await options.locator(':scope > summary').press('Escape');
    await expect(options).not.toHaveAttribute('open','');
    await page.locator('header [data-action=simple]').click();
    await openViewOptions(page);
    await expect(page.locator('[data-action="toggle-inspector"]')).toHaveCount(0);
    await expect(options.getByRole('button',{name:'符合內容'})).toHaveCount(0);
    await expect(page.locator('header #report-start')).toBeInViewport();
    await page.locator('header [data-action=global-menu]').hover();
    await expect(page.locator('#global-action-menu')).toBeHidden();
    await page.locator('.align-start > summary').click();
    await expect(page.locator('#align-start-apply')).toBeInViewport();
    await page.locator('#align-start-apply').press('Escape');
    await expect(page.locator('#align-start-apply')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(options.locator(':scope > summary')).toBeFocused();
    await page.screenshot({path:info.outputPath('header-'+width+'.png')});
  }
});

for (const width of [1024, 1440]) test(`desktop view switching at ${width}px preserves header positions and disables timeline controls in image view`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  await page.goto('/');
  const header = page.locator('header');
  const action = name => header.locator(`[data-action="${name}"]`);
  const geometry = () => header.evaluate(node => {
    const boxes = {};
    const actions = ['document-menu','undo','redo','timeline','simple','tracking','export-menu','global-menu'];
    const selectors = ['#workspace-language','.view-settings > summary',...actions.map(name => `[data-action="${name}"]`)];
    for (const selector of selectors) {
      const element = node.querySelector(selector);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      boxes[selector] = [rect.x, rect.y, rect.width, rect.height];
    }
    return boxes;
  });
  for (const language of ['zh-TW', 'en']) {
    await header.locator('#workspace-language').selectOption(language);
    await action('timeline').click();
    await selectTimelineScale(page,'Week');
    const positions = await geometry();
    await action('simple').click();
    await expect(page.locator('.picture-viewport')).toBeVisible();
    expect(await geometry()).toEqual(positions);
    const model = await page.evaluate(() => localStorage.getItem('drag.draft'));
    const zoom = await page.locator('.picture-viewport').getAttribute('data-zoom');
    for (const name of ['prev','today','next','fit-content']) {
      await expect(action(name)).toBeHidden();
    }
    await expect(page.locator('.timeline-date-dock')).toHaveCount(0);
    await expect(page.locator('.picture-viewport')).toHaveAttribute('data-zoom', zoom);
    expect(await page.evaluate(() => localStorage.getItem('drag.draft'))).toBe(model);
    await action('timeline').click();
    await expect(page.locator('.timeline-date-dock')).toHaveAttribute('data-scale','Week');
    expect(await geometry()).toEqual(positions);
  }
});

test('page tabs and toolbar have separate focus paths and share the active page panel', async ({page}) => {
  await page.goto('/');
  await page.locator('#workspace-language').selectOption('en');
  const tabs = page.getByRole('tablist');
  const tools = page.locator('[data-toolbar-layout]');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tools.getByRole('tab')).toHaveCount(0);
  await expect(tools.getByRole('button',{name:'Documents'})).toBeVisible();
  for (const [key,name] of [['ArrowRight','Image'],['End','Tracking'],['Home','Timeline']]) {
    await tabs.getByRole('tab',{selected:true}).focus();
    await page.keyboard.press(key);
    const active = tabs.getByRole('tab',{name,selected:true});
    await expect(active).toBeFocused();
    await expect(page.getByRole('tabpanel',{name})).toBeVisible();
    await expect(tabs.locator('[tabindex="0"]')).toHaveCount(1);
  }
});

test('long workspace titles stay compact and editable without moving the view tools', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  const heading = page.locator('.workspace-title');
  const editor = page.locator('.workspace-title-input');
  const longTitle = '跨團隊產品規劃與上線驗收'.repeat(6);
  const toolPositions = () => page.locator('header').evaluate(header => ['[data-action=timeline]','[data-action=simple]'].map(selector => header.querySelector(selector).getBoundingClientRect().x));
  for (const width of [1440, 1024]) {
    await page.setViewportSize({width,height:900});
    const original = await heading.boundingBox();
    expect(original.height).toBeGreaterThanOrEqual(30);
    expect(original.width).toBeLessThanOrEqual(135.01);
    if (width === 1440) expect(original.width).toBeGreaterThanOrEqual(115);
    const positions = await toolPositions();
    await heading.click();
    expect(await editor.boundingBox()).toEqual(original);
    await editor.fill(longTitle);
    await editor.press('End');
    expect(await editor.inputValue()).toBe(longTitle);
    expect(await toolPositions()).toEqual(positions);
    await editor.press('Enter');
    await expect(heading).toContainText(longTitle);
    await expect(heading).toHaveAttribute('title',new RegExp(longTitle));
    expect(await heading.locator('strong').evaluate(el=>({
      truncated:el.scrollWidth>el.clientWidth,ellipsis:getComputedStyle(el).textOverflow,font:parseFloat(getComputedStyle(el).fontSize)
    }))).toEqual({truncated:true,ellipsis:'ellipsis',font:11.25});
    expect(await toolPositions()).toEqual(positions);
  }
});
