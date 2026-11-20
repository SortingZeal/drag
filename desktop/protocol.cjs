const path = require('node:path');
const fs = require('node:fs/promises');

const ORIGIN = 'app://bundle';
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function resolveAsset(root, input, method = 'GET') {
  if (!['GET', 'HEAD'].includes(method)) return { status: 405 };
  let url, pathname;
  try {
    url = new URL(input);
    if (url.protocol !== 'app:' || url.hostname !== 'bundle' || url.port || url.username || url.password) return { status: 403 };
    pathname = decodeURIComponent(url.pathname);
  } catch { return { status: 400 }; }
  if (pathname.includes('\0') || pathname.includes('\\')) return { status: 400 };
  const candidate = path.resolve(root, pathname.replace(/^\/+/, '') || 'index.html');
  if (!within(root, candidate)) return { status: 403 };
  try {
    const realRoot = await fs.realpath(root);
    const file = await fs.realpath(candidate);
    if (!within(realRoot, file)) return { status: 403 };
    if (!(await fs.stat(file)).isFile()) return { status: 404 };
    return { status: 200, file, type: MIME[path.extname(file)] || 'application/octet-stream' };
  } catch { return { status: 404 }; }
}

function allowedNavigation(input) {
  try {
    const url = new URL(input);
    return url.origin === 'null' && url.protocol === 'app:' && url.hostname === 'bundle' && !url.username && !url.password && !url.port && ['/', '/index.html'].includes(url.pathname) && !url.search;
  } catch { return false; }
}

module.exports = { ORIGIN, CSP, resolveAsset, allowedNavigation };
