#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = process.env.DRAG_RELEASE_DIR ? path.resolve(process.env.DRAG_RELEASE_DIR) : path.join(root, 'release');
const electronVersion = '45.0.0';
const packagerVersion = '20.3.0';
const bundleId = 'app.drag.roadmap';
const desktopRuntimeFiles = ['i18n.cjs', 'main.cjs', 'preload.cjs', 'protocol.cjs', 'storage.cjs'];
const legalSourceFiles = ['electron-MIT.txt', 'electron-chromium.html', 'frappe-gantt-MIT.txt'];
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim());
const subprocessEnvironment = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: subprocessEnvironment, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${signal || code}).`));
    });
  });
}

async function requireFile(filename) {
  if (!(await stat(filename)).isFile()) throw new Error(`Required file is missing: ${filename}`);
}

// Copy only regular files. In particular, a symlink cannot pull a local draft or
// an arbitrary directory into an otherwise minimal application bundle.
async function copyTree(source, target) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Packaging does not accept source symlinks: ${source}`);
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) {
      if (entry.startsWith('.') || ['node_modules', 'tests', 'test-results', 'docs'].includes(entry)) continue;
      await copyTree(path.join(source, entry), path.join(target, entry));
    }
  } else if (info.isFile()) {
    await cp(source, target);
  }
}

async function copyRegularFile(source, target) {
  if (!(await lstat(source)).isFile()) throw new Error(`Packaging requires a regular file: ${source}`);
  await cp(source, target);
}

async function digest(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS is required to create and verify this macOS application.');
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) throw new Error('Node.js 22.12 or newer is required for Electron Packager 20.3.');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const installedPackager = JSON.parse(await readFile(path.join(root, 'node_modules/@electron/packager/package.json'), 'utf8'));
  if (installedPackager.version !== packagerVersion) throw new Error(`Install @electron/packager@${packagerVersion} using the project lockfile.`);
  if ((metadata.devDependencies?.electron || metadata.dependencies?.electron) !== electronVersion) {
    throw new Error(`package.json must pin electron to ${electronVersion}.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error('The app version must have three numeric components.');
  await requireFile(path.join(root, 'dist/index.html'));
  await requireFile(path.join(root, 'dist/roadmap.json'));
  await requireFile(path.join(root, 'desktop/main.cjs'));
  await requireFile(path.join(root, 'LICENSES/frappe-gantt-MIT.txt'));

  const work = await mkdtemp('/private/tmp/drag-desktop-build-');
  let attached = false;
  const stage = path.join(work, 'app-source');
  const legal = path.join(work, 'licenses');
  const icon = path.join(root, 'desktop/icon.icns');
  const artifactStem = `drag-v${metadata.version}-macOS-arm64`;
  try {
    // The checked-in ICNS avoids requiring Xcode on normal packaging runs.
    // Regenerate explicitly with create-icon.swift after changing the icon art.
    try { await requireFile(icon); }
    catch {
      const moduleCache = path.join(work, 'swift-module-cache');
      await mkdir(moduleCache, { recursive: true });
      await run('/usr/bin/xcrun', ['swift', '-module-cache-path', moduleCache, path.join(root, 'scripts/create-icon.swift'), icon]);
    }
    await copyTree(path.join(root, 'dist'), path.join(stage, 'dist'));
    await mkdir(path.join(stage, 'desktop'));
    for (const filename of desktopRuntimeFiles) {
      await copyRegularFile(path.join(root, 'desktop', filename), path.join(stage, 'desktop', filename));
    }
    await mkdir(legal);
    for (const filename of legalSourceFiles) {
      await copyRegularFile(path.join(root, 'LICENSES', filename), path.join(legal, filename));
    }
    await copyRegularFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(legal, 'THIRD_PARTY_NOTICES.md'));
    await writeFile(path.join(stage, 'package.json'), `${JSON.stringify({
      name: metadata.name,
      productName: 'drag',
      version: metadata.version,
      type: metadata.type || 'module',
      main: 'desktop/main.cjs',
    }, null, 2)}\n`);

    const { packager } = await import('@electron/packager');
    const bundles = await packager({
      dir: stage,
      out: path.join(work, 'packaged'),
      name: 'drag',
      executableName: 'drag',
      platform: 'darwin',
      arch: 'arm64',
      electronVersion,
      appVersion: metadata.version,
      buildVersion: metadata.version,
      appBundleId: bundleId,
      helperBundleId: `${bundleId}.helper`,
      appCategoryType: 'public.app-category.productivity',
      icon,
      asar: true,
      prune: false,
      overwrite: true,
      tmpdir: path.join(work, 'packager-tmp'),
      download: { cacheRoot: process.env.ELECTRON_CACHE || '/private/tmp/drag-electron-cache' },
      extendInfo: { CFBundleDisplayName: 'drag', CFBundleDevelopmentRegion: 'zh_TW' },
      // Preserve the runtime's notices from the downloaded Electron archive,
      // rather than copying the development node_modules tree into the app.
      afterExtract: [async ({ buildPath }) => {
        for (const filename of ['LICENSE', 'LICENSES.chromium.html']) {
          await requireFile(path.join(buildPath, filename));
          await cp(path.join(buildPath, filename), path.join(legal, filename === 'LICENSE' ? 'Electron-LICENSE.txt' : filename));
        }
      }],
      extraResource: [legal],
      osxSign: {
        identity: '-',
        identityValidation: false,
        preAutoEntitlements: false,
        preEmbedProvisioningProfile: false,
        continueOnError: false,
        optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
      },
    });
    if (bundles.length !== 1) throw new Error('Expected one macOS arm64 application.');
    const app = path.join(bundles[0], 'drag.app');
    await requireFile(path.join(app, 'Contents/MacOS/drag'));
    await requireFile(path.join(app, 'Contents/Resources/licenses/LICENSES.chromium.html'));
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);

    const zip = path.join(work, `${artifactStem}.zip`);
    const macMetadata = path.join(root, 'scripts/package-mac-metadata.py');
    await run('python3', [macMetadata, 'zip', app, zip]);
    await run('/usr/bin/unzip', ['-tq', zip]);

    const dmgContents = path.join(work, 'dmg');
    await mkdir(dmgContents);
    await run('/usr/bin/ditto', ['-x', '-k', zip, dmgContents]);
    const extracted = path.join(dmgContents, 'drag.app');
    await run('python3', [macMetadata, 'verify', app, extracted]);
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', extracted]);
    await symlink('/Applications', path.join(dmgContents, 'Applications'));
    // HFS+ carries its own ownership and extended attributes, independently of ZIP.
    const writableDmg = path.join(work, `${artifactStem}.writable.dmg`);
    await run('/usr/bin/hdiutil', ['create', '-volname', 'drag', '-srcfolder', dmgContents, '-format', 'UDRW', '-fs', 'HFS+', '-anyowners', '-ov', writableDmg]);
    await run('python3', [path.join(root, 'scripts/normalize-dmg-ownership.py'), writableDmg]);
    const dmg = path.join(work, `${artifactStem}.dmg`);
    await run('/usr/bin/hdiutil', ['convert', writableDmg, '-format', 'UDZO', '-o', dmg]);
    await run('/usr/bin/hdiutil', ['verify', dmg]);
    const mounted = path.join(work, 'mounted-dmg');
    await mkdir(mounted);
    try {
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mounted, dmg]);
      attached = true;
      await run('/usr/sbin/diskutil', ['verifyVolume', mounted]);
      const mountedApp = path.join(mounted, 'drag.app');
      await run('python3', [macMetadata, 'verify-hfs', app, mountedApp]);
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', mountedApp]);
      for (const relative of ['Contents/MacOS/drag', 'Contents/Resources/app.asar']) {
        if (await digest(path.join(mounted, 'drag.app', relative)) !== await digest(path.join(app, relative))) {
          throw new Error(`DMG application differs from ZIP source: ${relative}`);
        }
      }
    } finally {
      if (attached) {
        for (let attempt = 0; ; attempt++) {
          try {
            await run('/usr/bin/hdiutil', ['detach', mounted]);
            attached = false;
            break;
          } catch (error) {
            if (attempt === 3) throw error;
            await delay(1000 * 2 ** attempt);
          }
        }
      }
    }

    const manifest = {
      version: metadata.version,
      sourceRevision,
      sourceDirty,
      platform: 'darwin',
      arch: 'arm64',
      electronVersion,
      packagerVersion,
      bundleId,
      signing: 'ad-hoc',
      notarized: false,
      app: 'drag.app',
      executableSha256: await digest(path.join(app, 'Contents/MacOS/drag')),
      asarSha256: await digest(path.join(app, 'Contents/Resources/app.asar')),
      artifacts: await Promise.all([zip, dmg].map(async filename => ({
        filename: path.basename(filename),
        bytes: (await stat(filename)).size,
        sha256: await digest(filename),
      }))),
    };
    await mkdir(release, { recursive: true });
    // Only replace this script's generated outputs after all checks succeed.
    for (const source of [app, zip, dmg]) {
      const destination = path.join(release, path.basename(source));
      await rm(destination, { recursive: true, force: true });
      await rename(source, destination);
    }
    await writeFile(path.join(release, `${artifactStem}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(release, `${artifactStem}.sha256`), `${manifest.artifacts.map(artifact => `${artifact.sha256}  ${artifact.filename}`).join('\n')}\n`);
    console.log(JSON.stringify({ release, ...manifest }, null, 2));
  } finally {
    if (!attached) await rm(work, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
