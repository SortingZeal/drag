import { test, expect } from './audit-fixture.js';

const trigger = page => page.locator('header [data-action="document-menu"]');
const menu = page => page.locator('#document-menu');

test('the document library identifies the active file and returns focus after switching', async ({page}) => {
  await page.goto('/?lang=en');
  const library = trigger(page);
  await expect(library).toHaveAccessibleName('Documents');
  const initial = await library.getAttribute('data-active-id');
  await library.press('ArrowDown');
  const first = menu(page).getByRole('menuitemradio', {checked:true});
  const firstName = await first.textContent();
  await expect(first).toBeFocused();
  await menu(page).getByRole('menuitem', {name:'New document',exact:true}).click();
  await page.locator('#document-name').fill('Release notes');
  await page.locator('#document-name').press('Enter');
  await expect(library).not.toHaveAttribute('data-active-id', initial);
  await expect(library).toBeFocused();
  await library.press('Enter');
  const current = menu(page).getByRole('menuitemradio', {name:'Release notes',exact:true});
  await expect(current).toBeChecked();
  await expect(current).toBeFocused();
  await current.press('ArrowUp');
  const original = menu(page).getByRole('menuitemradio', {name:firstName,exact:true});
  await expect(original).toBeFocused();
  await original.press('Enter');
  await expect(library).toHaveAttribute('data-active-id', initial);
  await expect(menu(page)).toBeHidden();
  await expect(library).toBeFocused();
  await library.press('Space');
  await expect(original).toBeChecked();
  await expect(current).not.toBeChecked();
  await original.press('End');
  await expect(menu(page).getByRole('menuitem',{name:'Delete document',exact:true})).toBeFocused();
  await page.keyboard.press('Home');
  await expect(original).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(library).toBeFocused();
  await expect(menu(page)).toBeHidden();
});

test('the document library fits narrow windows and dismisses on outside clicks and Tab', async ({page}) => {
  await page.goto('/');
  for (const width of [320, 401, 501, 700, 1024, 1440]) {
    await page.setViewportSize({width, height:460});
    const library = trigger(page);
    await expect(library).toHaveAccessibleName('文件庫');
    expect((await page.locator('header .workspace-title strong').boundingBox()).width).toBeGreaterThan(18);
    await library.click();
    const bounds = await menu(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(460);
    await expect(menu(page).getByRole('menuitemradio', {checked:true})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu(page)).toBeHidden();
    await expect(library).not.toBeFocused();
    await library.click();
    await page.mouse.click(width / 2, 385);
    await expect(menu(page)).toBeHidden();
    await expect(library).toHaveAttribute('aria-expanded','false');
  }
});

test('a long library scrolls to the current document and keeps every action reachable', async ({page}) => {
  await page.setViewportSize({width:840,height:340});
  await page.goto('/');
  const library = trigger(page), list = menu(page).locator('.document-list');
  const original = await library.getAttribute('data-active-id');
  let lastName;
  for (let index=1; index<=8; index++) {
    lastName = '版本 <' + index + '> ' + '工作區與產品發行規劃'.repeat(5);
    await library.click();
    await menu(page).getByRole('menuitem', {name:'新增文件'}).click();
    await page.locator('#document-name').fill(lastName);
    await page.locator('#document-name').press('Enter');
    await expect(page.locator('.workspace-title')).toHaveText(lastName);
  }
  await library.click();
  const checked = list.getByRole('menuitemradio',{checked:true});
  await expect(checked).toHaveAccessibleName(lastName);
  await expect(checked).toBeFocused();
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await checked.press('Home');
  const first = list.locator('[data-document-id]').first();
  await expect(first).toHaveAttribute('data-document-id',original);
  await expect(first).toBeInViewport();
  await first.press('End');
  await expect(menu(page).getByRole('menuitem', {name:'刪除文件'})).toBeInViewport();
  await page.keyboard.press('Home');
  await first.press('Enter');
  await expect(library).toHaveAttribute('data-active-id',original);
  await expect(library).toBeFocused();
});
