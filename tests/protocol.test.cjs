const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveAsset, allowedNavigation } = require('../desktop/protocol.cjs');

test('desktop scheme serves assets and denies traversal, symlink escape, foreign origins and writes', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'drag-protocol-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'dist');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'index.html'), '<main>drag</main>');
  await fs.writeFile(path.join(root, '含 空白.json'), '{}');
  await fs.writeFile(path.join(base, 'private.json'), '{"private":true}');
  await fs.symlink(path.join(base, 'private.json'), path.join(root, 'leak.json'));
  for (const method of ['GET', 'HEAD']) {
    assert.equal((await resolveAsset(root, 'app://bundle/', method)).status, 200);
    assert.equal((await resolveAsset(root, 'app://bundle/index.html', method)).type, 'text/html; charset=utf-8');
    assert.equal((await resolveAsset(root, 'app://bundle/%E5%90%AB%20%E7%A9%BA%E7%99%BD.json', method)).status, 200);
  }
  for (const url of ['app://other/index.html', 'app://user@bundle/index.html', 'app://bundle:99/index.html', 'file:///etc/passwd', 'https://example.com/', 'app://bundle/%2e%2e%2fprivate.json', 'app://bundle/leak.json']) {
    assert.equal((await resolveAsset(root, url)).status, 403, url);
  }
  for (const url of ['app://bundle/%00', 'app://bundle/%zz', 'app://bundle/%5c..%5cprivate.json']) assert.equal((await resolveAsset(root, url)).status, 400);
  assert.equal((await resolveAsset(root, 'app://bundle/missing.json')).status, 404);
  assert.equal((await resolveAsset(root, 'app://bundle/index.html', 'POST')).status, 405);
});

test('desktop navigation only permits its own document', () => {
  for (const url of ['app://bundle/', 'app://bundle/index.html', 'app://bundle/index.html#chart']) assert.equal(allowedNavigation(url), true, url);
  for (const url of ['https://example.com', 'file:///etc/passwd', 'app://other/index.html', 'app://bundle/roadmap.json', 'app://bundle/index.html?redirect=1', 'app://user@bundle/index.html']) assert.equal(allowedNavigation(url), false, url);
});
