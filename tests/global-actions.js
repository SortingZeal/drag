const PROJECT = new Set(['save', 'import', 'settings']);
const IMAGE = new Set(['svg', 'png', 'gif']);

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
  const menu = PROJECT.has(command) ? 'global-menu' : IMAGE.has(command) ? 'export-menu'
    : command === 'newdocument' ? 'document-menu' : null;
  if (menu && !await button.isVisible()) await page.locator(`[data-action="${menu}"]`).click();
  await button.click();
}

export const globalClick = clickAction;

export const documentItems = page => page.locator('#document-menu [role="menuitemradio"][data-document-id]');
export const currentDocument = page => page.locator('#document-menu [data-document-id][aria-checked="true"]');

export async function chooseDocument(page, id) {
  const trigger = page.locator('[data-action="document-menu"]');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.locator(`#document-menu [data-document-id="${id}"]`).click();
}

export async function selectSnap(page,value) {
  const options = await openViewOptions(page);
  await page.locator('#snap').selectOption(value);
  if (await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
}

export async function selectTimelineScale(page, scale) {
  const ruler = page.locator('.timeline-date-dock');
  await ruler.click({position:{x:24,y:18}});
  await page.locator(`#timeline-scale-menu [data-scale="${scale}"]`).click();
}
