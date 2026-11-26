import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { clickAction, documentItems, currentDocument } from './global-actions.js';

const seed = JSON.parse(readFileSync(new URL('../public/roadmap.json', import.meta.url), 'utf8'));
const marker = 'private-file-flow-sentinel';
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('drag.draft')));
const dismissTour = page => page.addInitScript(() => localStorage.setItem('drag.onboarding', JSON.stringify({ version: 1, status: 'completed' })));

test('a user imports, edits and downloads a local JSON file without uploading or sharing it', async ({ page, context, browser, baseURL }) => {
  const writes = [], urls = [], leakedBodies = [];
  const siteOrigin = new URL(baseURL).origin;
  const watch = request => {
    urls.push(request.url());
    if (['POST', 'PUT', 'PATCH'].includes(request.method())) {
      if ((request.postData() || '').includes(marker)) leakedBodies.push(request.url());
      // The hosted page may receive a Cloudflare challenge script. Its own
      // validation POST is outside the editor's project file flow.
      const url = new URL(request.url());
      if (!(url.origin === siteOrigin && url.pathname.startsWith('/cdn-cgi/challenge-platform/')))
        writes.push({ method: request.method(), url: request.url() });
    }
  };
  context.on('request', watch);
  await dismissTour(page);
  await page.goto('/');
  await expect(documentItems(page)).toHaveCount(1);

  const imported = structuredClone(seed);
  imported.title = `Private ${marker}`;
  imported.metadata = { localOnly: marker };
  imported.projects = imported.projects.slice(0, 1);
  imported.projects[0].name = `Project ${marker}`;
  imported.projects[0].phases = imported.projects[0].phases.slice(0, 1);
  imported.projects[0].phases[0].label = `Task ${marker}`;

  const chooser = page.waitForEvent('filechooser');
  await clickAction(page, 'import');
  await (await chooser).setFiles({ name: 'private-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(documentItems(page)).toHaveCount(2);
  await expect(currentDocument(page)).toHaveText('private-plan');
  await expect.poll(async () => (await draft(page)).metadata.localOnly).toBe(marker);

  await page.locator('[data-select-f="0:0"]').click();
  const editedLabel = `Edited ${marker}`;
  const field = page.locator('#editor [data-field="label"]');
  await field.fill(editedLabel);
  await field.press('Tab');
  await expect.poll(async () => (await draft(page)).projects[0].phases[0].label).toBe(editedLabel);
  const taskStatus = `Review ${marker}`;
  for (const [key, value] of [['status', taskStatus], ['progress', '35']]) {
    const input = page.locator(`#editor [data-field="${key}"]`);
    await input.fill(value);
    await input.press('Tab');
  }
  await expect.poll(async () => (await draft(page)).projects[0].phases[0].progress).toBe(35);
  await page.reload();
  await expect(currentDocument(page)).toHaveText('private-plan');
  await expect.poll(async () => (await draft(page)).projects[0].phases[0].label).toBe(editedLabel);

  const pendingDownload = page.waitForEvent('download');
  await clickAction(page, 'save');
  const downloaded = await pendingDownload;
  expect(downloaded.suggestedFilename()).toBe('private-plan.json');
  const exported = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  expect(exported).toEqual(await draft(page));
  expect(exported.title).toBe(imported.title);
  expect(exported.metadata).toEqual(imported.metadata);
  expect(exported.projects[0].name).toBe(imported.projects[0].name);
  expect(exported.projects[0].phases[0]).toMatchObject({ label: editedLabel, status: taskStatus, progress: 35 });

  const otherContext = await browser.newContext();
  otherContext.on('request', watch);
  try {
    const otherPage = await otherContext.newPage();
    await dismissTour(otherPage);
    await otherPage.goto(page.url());
    await expect(documentItems(otherPage)).toHaveCount(1);
    expect(JSON.stringify(await draft(otherPage))).not.toContain(marker);
  } finally {
    await otherContext.close();
  }

  expect(writes).toEqual([]);
  expect(urls.some(url => url.includes(marker))).toBe(false);
  expect(leakedBodies).toEqual([]);
});
