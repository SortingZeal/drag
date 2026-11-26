import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = metadata.version;
const electronVersion = metadata.devDependencies.electron;
const checksums = JSON.parse(await readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'));
const zipName = `electron-v${electronVersion}-win32-x64.zip`;
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(checksums[zipName] || '')) {
  throw new Error('A numeric app version and the pinned Electron Windows checksum are required.');
}
const release = path.resolve(process.env.DRAG_RELEASE_DIR || path.join(root, 'release'));
const stem = `drag-v${version}-Windows-x64`;
const filename = stem + '.exe';
const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
const sourceRevision = git('rev-parse', 'HEAD');
const sourceDirty = Boolean(git('status', '--porcelain', '--untracked-files=normal'));

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function stageTree(source, target) {
  const entry = await lstat(source);
  if (entry.isFile()) return cp(source, target);
  if (!entry.isDirectory()) throw new Error(`Cannot package a link or special file: ${source}`);
  await mkdir(target);
  for (const name of await readdir(source)) {
    if (name.startsWith('.') || ['node_modules', 'tests', 'test-results', 'docs'].includes(name)) continue;
    await stageTree(path.join(source, name), path.join(target, name));
  }
}

async function verifyExecutable(file, machine) {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(64), pe = Buffer.alloc(6);
    await handle.read(header, 0, header.length, 0);
    await handle.read(pe, 0, pe.length, header.readUInt32LE(60));
    if (header.toString('ascii', 0, 2) !== 'MZ' || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== machine) {
      throw new Error(`Unexpected Windows executable architecture: ${path.basename(file)}`);
    }
  } finally { await handle.close(); }
}

const work = await mkdtemp(path.join(tmpdir(), 'drag-windows-'));
const stage = path.join(work, 'app-source');
const licenses = path.join(work, 'licenses');
try {
  await mkdir(stage);
  await stageTree(path.join(root,'dist'), path.join(stage,'dist'));
  await mkdir(path.join(stage,'desktop'));
  for (const file of ['i18n.cjs', 'main.cjs', 'preload.cjs', 'protocol.cjs', 'storage.cjs']) {
    await stageTree(path.join(root, 'desktop', file), path.join(stage, 'desktop', file));
  }
  await writeFile(path.join(stage,'package.json'), JSON.stringify({
    name: metadata.name, productName: 'drag', version, type: metadata.type, main: 'desktop/main.cjs'
  }, null, 2) + '\n');
  await mkdir(licenses);
  for (const file of ['electron-MIT.txt','electron-chromium.html','frappe-gantt-MIT.txt']) {
    await stageTree(path.join(root,'LICENSES',file), path.join(licenses,file));
  }
  await stageTree(path.join(root,'THIRD_PARTY_NOTICES.md'),path.join(licenses,'THIRD_PARTY_NOTICES.md'));
  const electronZipDir = process.env.DRAG_ELECTRON_ZIP_DIR ? path.resolve(process.env.DRAG_ELECTRON_ZIP_DIR) : undefined;
  if (electronZipDir && await sha256(path.join(electronZipDir,zipName)) !== checksums[zipName]) {
    throw new Error('Electron archive SHA-256 does not match the checksum supplied by the pinned Electron package.');
  }
  const icon = path.join(root,'desktop','icon.ico');
  const [bundle] = await packager({
    dir: stage, out: path.join(work, 'packaged'), name: 'drag', executableName: 'drag',
    platform:'win32', arch:'x64', electronVersion, appVersion:version, buildVersion:version, icon,
    win32metadata:{CompanyName:'drag', FileDescription:'drag Roadmap Editor'},
    appCopyright:'See bundled third-party notices', asar:true, prune:false, extraResource:[licenses],
    electronZipDir, download:{checksums}, tmpdir:path.join(work, 'packager-tmp')
  });
  await verifyExecutable(path.join(bundle,'drag.exe'), 0x8664);
  const asarSha256 = await sha256(path.join(bundle,'resources','app.asar'));
  const artifact = path.join(work,filename);
  const makensis = process.env.MAKENSIS || 'makensis';
  const option = process.platform === 'win32' ? '/' : '-';
  execFileSync(makensis, [option+'V2', option+'DARTIFACT='+artifact, option+'DPAYLOAD='+bundle,
    option+'DAPP_ICON='+icon, option+'DAPP_VERSION='+version, path.join(root,'scripts','windows-portable.nsi')],
    {stdio:'inherit'});
  // The portable launcher is a 32-bit NSIS stub containing the verified x64 app.
  await verifyExecutable(artifact, 0x014c);
  const manifest = {
    version, platform:'win32', arch:'x64', sourceRevision, sourceDirty, filename,
    bytes:(await stat(artifact)).size, sha256:await sha256(artifact), asarSha256,
    electronVersion, electronArchiveSha256:checksums[zipName], signing:'unsigned'
  };
  if (process.env.DRAG_WINDOWS_VERIFY_DIR) {
    await cp(bundle,path.resolve(process.env.DRAG_WINDOWS_VERIFY_DIR),{recursive:true,force:false,errorOnExist:true});
  }
  await mkdir(release,{recursive:true});
  const pending = await mkdtemp(path.join(release,'.windows-'));
  try {
    await cp(artifact,path.join(pending,filename));
    await writeFile(path.join(pending,stem+'.json'), JSON.stringify(manifest,null,2)+'\n');
    await rename(path.join(pending,filename),path.join(release,filename));
    await rename(path.join(pending,stem+'.json'),path.join(release,stem+'.json'));
  } finally { await rm(pending,{recursive:true,force:true}); }
  console.log(path.join(release,filename));
} finally { await rm(work,{recursive:true,force:true}); }
