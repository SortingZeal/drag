#!/usr/bin/env python3
"""Verify the Mac package and, optionally, upload/check a private draft Release.

Run only after native Mac validation from the clean release commit. This script
never creates a tag, publishes a Release, or replaces existing assets.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()

def windows_release_files(folder, tag, revision):
    stem = f'drag-{tag}-Windows-x64'
    exe, sidecar = (folder / (stem + suffix) for suffix in ('.exe', '.json'))
    if any(p.is_symlink() or not p.is_file() for p in (exe, sidecar)):
        raise ValueError('Missing Windows executable or manifest')
    manifest = json.loads(sidecar.read_text(encoding='utf-8'))
    expected = dict(version=tag[1:], platform='win32', arch='x64', filename=exe.name,
                    sourceRevision=revision, bytes=exe.stat().st_size)
    if manifest.get('sourceDirty') is not False or any(manifest.get(k) != v for k,v in expected.items()):
        raise ValueError('Windows package identity differs from the release snapshot')
    with exe.open('rb') as stream:
        if stream.read(2) != b'MZ':
            raise ValueError('Invalid Windows executable')
        checksum = hashlib.sha256(b'MZ')
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
        if checksum.hexdigest() != manifest.get('sha256'):
            raise ValueError('Windows executable checksum mismatch')
    return [exe, sidecar]


def load_package(folder, tag, suffix, platform, arch, executable, asar, extensions):
    stem = f'drag-{tag}-{suffix}'
    paths = [folder / f'{stem}.{extension}' for extension in extensions]
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing regular release file: {path}')
    manifest = json.loads((folder / f'{stem}.json').read_text(encoding='utf-8'))
    if (manifest.get('version'), manifest.get('platform'), manifest.get('arch')) != (tag[1:], platform, arch):
        raise ValueError(f'Package identity mismatch: {stem}')
    checksums = (folder / f'{stem}.sha256').read_text(encoding='utf-8').splitlines()
    expected_artifacts = {entry['filename']: entry for entry in manifest['artifacts']}
    if len(expected_artifacts) != len(manifest['artifacts']):
        raise ValueError(f'Duplicate artifact: {stem}')
    if set(expected_artifacts) != {f'{stem}.{ext}' for ext in extensions if ext not in ('json', 'sha256')}:
        raise ValueError(f'Unexpected artifact inventory: {stem}')
    if len(checksums) != len(expected_artifacts):
        raise ValueError(f'Checksum inventory mismatch: {stem}')
    seen = set()
    for line in checksums:
        checksum, filename = line.split(maxsplit=1)
        filename = filename.strip()
        if filename not in expected_artifacts or filename in seen or Path(filename).name != filename:
            raise ValueError(f'Unexpected checksum entry: {filename}')
        seen.add(filename)
        data = (folder / filename).read_bytes()
        if digest(data) != checksum or digest(data) != expected_artifacts[filename]['sha256']:
            raise ValueError(f'Artifact checksum mismatch: {filename}')
        if len(data) != expected_artifacts[filename]['bytes']:
            raise ValueError(f'Artifact size mismatch: {filename}')
    if seen != set(expected_artifacts):
        raise ValueError(f'Checksum entries do not cover every artifact: {stem}')
    with zipfile.ZipFile(folder / f'{stem}.zip') as archive:
        if archive.testzip() is not None:
            raise ValueError(f'ZIP CRC mismatch: {stem}')
        if digest(archive.read(executable)) != manifest['executableSha256']:
            raise ValueError(f'Executable checksum mismatch: {stem}')
        asar_bytes = archive.read(asar)
        if digest(asar_bytes) != manifest['asarSha256']:
            raise ValueError(f'ASAR checksum mismatch: {stem}')
    return manifest, asar_bytes, paths


def verify_dmg(path, manifest):
    """Verify the image and compare mounted executable/ASAR with the manifest."""
    subprocess.run(['/usr/bin/hdiutil', 'verify', str(path)], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    mountpoint = tempfile.mkdtemp(prefix='drag-verify-dmg-')
    attached = False
    try:
        subprocess.run(['/usr/bin/hdiutil', 'attach', '-readonly', '-nobrowse',
                        '-mountpoint', mountpoint, str(path)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        attached = True
        for relative, key in (
            ('drag.app/Contents/MacOS/drag', 'executableSha256'),
            ('drag.app/Contents/Resources/app.asar', 'asarSha256'),
        ):
            target = Path(mountpoint)
            for part in Path(relative).parts:
                target /= part
                if target.is_symlink():
                    raise ValueError(f'DMG contains a symlink in the application path: {relative}')
            if digest(target.read_bytes()) != manifest[key]:
                raise ValueError(f'DMG application content mismatch: {relative}')
    finally:
        # A failed attach can still leave a mounted image. Never remove its
        # mountpoint until detach has succeeded; retain it for manual recovery.
        if attached or os.path.ismount(mountpoint):
            try:
                subprocess.run(['/usr/bin/hdiutil', 'detach', mountpoint], check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except subprocess.CalledProcessError:
                try:
                    subprocess.run(['/usr/bin/hdiutil', 'detach', '-force', mountpoint], check=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                except subprocess.CalledProcessError as error:
                    raise RuntimeError(f'DMG remains mounted; mountpoint preserved: {mountpoint}') from error
        if os.path.ismount(mountpoint):
            raise RuntimeError(f'DMG remains mounted; mountpoint preserved: {mountpoint}')
        shutil.rmtree(mountpoint)


def api(repo, endpoint):
    return json.loads(run('gh', 'api', f'repos/{repo}' + (f'/{endpoint}' if endpoint else '')))


def remote_release(repo, tag):
    # The releases/tags endpoint can return 404 for an unpublished draft.
    # List releases with push access so an empty draft is discoverable before
    # upload as well as while waiting for its asset digests to appear.
    page = 1
    while True:
        releases = api(repo, f'releases?per_page=100&page={page}')
        matches = [release for release in releases if release.get('tag_name') == tag]
        if len(matches) > 1:
            raise ValueError(f'Multiple Releases use tag {tag}')
        if matches:
            return matches[0]
        if len(releases) < 100:
            raise ValueError(f'Release not found for tag {tag}')
        page += 1


def remote_tag_commit(repo, tag):
    reference = api(repo, f'git/ref/tags/{tag}')['object']
    for _ in range(5):
        if reference['type'] == 'commit':
            return reference['sha']
        if reference['type'] != 'tag':
            break
        reference = api(repo, f'git/tags/{reference["sha"]}')['object']
    raise ValueError('Remote release tag does not resolve to a commit')


def check_remote_snapshot(repo, tag, revision, repo_info):
    """Require one root commit on main and no other GitHub project records."""
    if repo_info.get('default_branch') != 'main':
        raise ValueError('Remote default branch must be main')
    commit = api(repo, f'commits/{revision}')
    if commit['parents']:
        raise ValueError('Release source is not a root commit')
    branches = api(repo, 'branches?per_page=100&page=1')
    if len(branches) != 1 or branches[0]['name'] != 'main' or branches[0]['commit']['sha'] != revision:
        raise ValueError('Remote must have only main at the packaged source commit')
    tags = api(repo, 'tags?per_page=100&page=1')
    if len(tags) != 1 or tags[0]['name'] != tag or tags[0]['commit']['sha'] != revision:
        raise ValueError('Remote must have only the packaged release tag')
    releases = api(repo, 'releases?per_page=100&page=1')
    if len(releases) != 1 or releases[0]['tag_name'] != tag:
        raise ValueError('Remote must have only the candidate Release')
    if api(repo, 'pulls?state=all&per_page=1') or api(repo, 'issues?state=all&per_page=1'):
        raise ValueError('Remote staging repository contains PRs or Issues')
    if api(repo, 'actions/permissions')['enabled'] is not False or api(repo, 'actions/runs?per_page=1')['total_count'] != 0:
        raise ValueError('Remote Actions must be disabled with no workflow runs')


def check_remote_assets(release, entries):
    actual = {asset['name']: asset for asset in release['assets']}
    if len(release['assets']) != len(entries) or set(actual) != {entry['name'] for entry in entries}:
        raise ValueError('Remote asset inventory does not match the local release files')
    for entry in entries:
        asset = actual[entry['name']]
        if asset['state'] != 'uploaded' or asset['size'] != entry['bytes'] or asset.get('digest') != 'sha256:' + entry['sha256']:
            raise ValueError(f'Remote asset mismatch: {entry["name"]}')


def check_evidence(folder, platform, arch, revision):
    evidence = json.loads((folder / 'result.json').read_text(encoding='utf-8'))
    if (evidence.get('platform'), evidence.get('arch'), evidence.get('sourceRevision')) != (platform, arch, revision):
        raise ValueError(f'Native evidence identity mismatch: {folder}')
    if evidence.get('sourceDirty') is not False or not all(evidence.get(key) is True for key in
        ('checksPassed', 'unitPassed', 'buildPassed', 'desktopPassed', 'releaseGateTestsPassed')
    ):
        raise ValueError(f'Native validation incomplete: {folder}')
    if set(evidence.get('browsersPassed', [])) != {'chromium', 'firefox', 'webkit'}:
        raise ValueError(f'Browser validation incomplete: {folder}')
    if not evidence.get('baselineTag') or not evidence.get('baselineRepo'):
        raise ValueError(f'Native upgrade baseline missing: {folder}')
    upgrade = evidence.get('upgradePassed') is True
    replacement = evidence.get('sameVersionReplacementPassed') is True
    if upgrade == replacement:
        raise ValueError(f'Expected exactly one tested release transition: {folder}')
    baseline = json.loads((folder / 'baseline.json').read_text(encoding='utf-8'))
    if baseline.get('verified') is not True or baseline.get('tag') != evidence['baselineTag']:
        raise ValueError(f'Baseline verification evidence incomplete: {folder}')
    if replacement:
        equivalence = json.loads((folder / 'repackage-equivalence.json').read_text(encoding='utf-8'))
        if (evidence.get('releaseTransition') != 'same-version-repackage'
                or equivalence.get('baselineTag') != evidence['baselineTag']
                or equivalence.get('asarByteEquivalent') is not True
                or equivalence.get('asarSha256') != evidence.get('rebuildAsarSha256')):
            raise ValueError(f'Same-version repackage evidence incomplete: {folder}')
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True, help='Candidate release tag (vMAJOR.MINOR.PATCH)')
    parser.add_argument('--mac-dir', required=True, type=Path)
    parser.add_argument('--windows-dir', type=Path, help='Include the Windows x64 executable and its build manifest')
    parser.add_argument('--repo', default='SortingZeal/drag')
    parser.add_argument('--mac-evidence', type=Path, help='Directory containing the successful Mac result.json')
    parser.add_argument('--baseline-repo', help='Repository holding the previous stable Release; required when publishing through a new staging repository')
    parser.add_argument('--upload-draft', action='store_true', help='Upload the verified files to an existing empty private draft')
    parser.add_argument('--verify-draft', action='store_true', help='Recheck the private draft, source, evidence and assets before publication')
    parser.add_argument('--verify-remote', action='store_true', help='Compare an existing Release to local files')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if not args.tag.startswith('v') or len(args.tag.split('.')) != 3 or not all(part.isdigit() for part in args.tag[1:].split('.')):
        parser.error('Tag must be vMAJOR.MINOR.PATCH')
    if sum((args.upload_draft, args.verify_draft, args.verify_remote)) > 1:
        parser.error('Choose one remote operation')
    if (args.upload_draft or args.verify_draft) and not args.mac_evidence:
        parser.error('Draft upload and verification require native Mac evidence')

    mac, mac_asar, mac_paths = load_package(args.mac_dir, args.tag, 'macOS-arm64', 'darwin', 'arm64',
                                            'drag.app/Contents/MacOS/drag', 'drag.app/Contents/Resources/app.asar',
                                            ('zip', 'dmg', 'json', 'sha256'))
    if not mac.get('sourceRevision'):
        raise ValueError('Mac package must name its source commit')
    if mac.get('sourceDirty') is not False:
        raise ValueError('Mac package must come from a clean source tree')
    verify_dmg(args.mac_dir / f'drag-{args.tag}-macOS-arm64.dmg', mac)
    paths = mac_paths + (windows_release_files(args.windows_dir, args.tag, mac['sourceRevision']) if args.windows_dir else [])
    entries = [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes())} for path in paths]
    if len({entry['name'] for entry in entries}) != len(paths):
        raise ValueError('Release asset names must be unique')
    report = {'tag': args.tag, 'sourceRevision': mac['sourceRevision'], 'asarSha256': digest(mac_asar),
              'platformScope': ['darwin-arm64', 'win32-x64'] if args.windows_dir else ['darwin-arm64'],
              'localAssetIntegrityVerified': True, 'nativeTestsVerifiedByThisScript': False,
              'dmgMountVerifiedByThisScript': True, 'assets': entries, 'remoteVerified': False}
    if args.mac_evidence:
        mac_evidence = check_evidence(args.mac_evidence, 'darwin', 'arm64', mac['sourceRevision'])
        report['nativeEvidenceVerified'] = True
        report['baselineTag'] = mac_evidence['baselineTag']
        report['baselineRepo'] = mac_evidence.get('baselineRepo')
        if mac_evidence.get('sameVersionReplacementPassed') is True:
            if mac_evidence['baselineTag'] != args.tag or mac_evidence['rebuildAsarSha256'] != digest(mac_asar):
                raise ValueError('Same-version repackage does not match this Release app.asar')
            report['sameVersionReplacementVerified'] = True
            report['crossVersionUpgradeRerun'] = False

    if args.upload_draft or args.verify_draft or args.verify_remote:
        if json.loads(Path('package.json').read_text(encoding='utf-8'))['version'] != args.tag[1:]:
            raise ValueError('Checkout package.json version differs from release tag')
        repo_info = api(args.repo, '')
        if (args.upload_draft or args.verify_draft) and not repo_info['private']:
            raise ValueError('Refusing draft operations on a public repository')
        release = remote_release(args.repo, args.tag)
        if remote_tag_commit(args.repo, args.tag) != mac['sourceRevision']:
            raise ValueError('Remote tag does not resolve to the packaged source commit')
        if run('git', 'rev-list', '-n', '1', args.tag) != mac['sourceRevision']:
            raise ValueError('Local tag does not resolve to the packaged source commit')
        check_remote_snapshot(args.repo, args.tag, mac['sourceRevision'], repo_info)
        if args.upload_draft:
            baseline_repo = args.baseline_repo or args.repo
            latest = api(baseline_repo, 'releases/latest')
            if latest.get('draft') is not False or latest.get('prerelease') is not False:
                raise ValueError('Upgrade baseline must be a published stable Release')
            if not report.get('baselineTag'):
                raise ValueError('Mac native evidence must include an upgrade baseline')
            if report.get('baselineRepo') != baseline_repo:
                raise ValueError('Mac native evidence used a different upgrade baseline repository')
            if report.get('baselineTag') != latest['tag_name']:
                raise ValueError('Native upgrade baseline differs from the current latest Release')
            if run('git', 'rev-parse', 'HEAD') != mac['sourceRevision'] or run('git', 'status', '--porcelain'):
                raise ValueError('Release upload requires a clean checkout at the packaged source commit')
            if not release['draft'] or release['prerelease'] or release['assets']:
                raise ValueError('Expected an empty private draft Release')
            subprocess.run(['gh', 'release', 'upload', args.tag, '--repo', args.repo, *map(str, paths)], check=True)
            for _ in range(10):
                release = remote_release(args.repo, args.tag)
                if len(release['assets']) == len(entries) and all(a.get('digest') for a in release['assets']):
                    break
                time.sleep(2)
            if not release['draft']:
                raise ValueError('Draft state changed during upload')
        elif args.verify_draft:
            if not report.get('baselineTag') or not report.get('baselineRepo'):
                raise ValueError('Draft verification requires an upgrade baseline record')
            if run('git', 'rev-parse', 'HEAD') != mac['sourceRevision'] or run('git', 'status', '--porcelain'):
                raise ValueError('Draft verification requires a clean checkout at the packaged source commit')
            if not release['draft'] or release['prerelease']:
                raise ValueError('Expected a private draft Release before publication')
        else:
            latest = api(args.repo, 'releases/latest')
            if release['draft'] or release['prerelease'] or latest['id'] != release['id']:
                raise ValueError('Remote Release is not the latest published stable version')
        check_remote_assets(release, entries)
        report['remoteVerified'] = True
        report['releaseUrl'] = release['html_url']
        report['draft'] = release['draft']
        report['prePublicationVerified'] = args.verify_draft
        report['latestPublishedStable'] = not release['draft'] and not release['prerelease'] and args.verify_remote

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError, FileNotFoundError, KeyError, zipfile.BadZipFile) as error:
        print(f'Verification failed: {error}', file=sys.stderr)
        sys.exit(1)
