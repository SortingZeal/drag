const GLOBAL = new Set(['save', 'import', 'undo', 'redo', 'svg', 'png', 'gif', 'settings']);

export async function openViewOptions(page) {
  const options = page.locator('.view-settings');
  if (!await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
  return options;
}

export async function openViewSection(page, selector) {
  const parent = await openViewOptions(page);
  const section = parent.locator(selector);
  if (!await section.evaluate(node => node.open)) await section.locator(':scope > summary').click();
}

export async function clickAction(page, command) {
  const button = page.locator(`[data-action="${command}"]`);
  const inViewOptions = ['expand-left','expand-right','shrink-left','shrink-right','fit-content','prev','next','today'].includes(command);
  if (inViewOptions && !await button.isVisible()) await openViewOptions(page);
  if (GLOBAL.has(command)) await page.locator('[data-action="global-menu"]').click();
  await button.click();
}

export const globalClick = clickAction;

export async function selectSnap(page,value) {
  const options = await openViewOptions(page);
  await page.locator('#snap').selectOption(value);
  if (await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
}
