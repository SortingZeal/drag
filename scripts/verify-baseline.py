#!/usr/bin/env python3
"""Verify a downloaded stable package before an isolated transition test."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--repo', default='SortingZeal/drag')
    parser.add_argument('--dir', required=True, type=Path)
    args = parser.parse_args()
    stem = f'drag-{args.tag}-macOS-arm64'
    release = json.loads(subprocess.check_output(['gh', 'api', f'repos/{args.repo}/releases/tags/{args.tag}']))
    latest = json.loads(subprocess.check_output(['gh', 'api', f'repos/{args.repo}/releases/latest']))
    if release['tag_name'] != args.tag or release['draft'] or release['prerelease']:
        raise ValueError('Expected a published stable Release')
    if latest['tag_name'] != args.tag:
        raise ValueError(f'Upgrade baseline must be the current latest Release: {latest["tag_name"]}')
    remote = {asset['name']: asset for asset in release['assets']}
    for extension in ('zip', 'json', 'sha256'):
        name = f'{stem}.{extension}'
        data = (args.dir / name).read_bytes()
        if len(data) != remote[name]['size'] or 'sha256:' + sha(data) != remote[name].get('digest'):
            raise ValueError(f'Remote digest mismatch: {name}')
    manifest = json.loads((args.dir / f'{stem}.json').read_text(encoding='utf-8'))
    if (manifest['version'], manifest['platform'], manifest['arch']) != (args.tag[1:], 'darwin', 'arm64'):
        raise ValueError('Baseline manifest identity mismatch')
    zip_bytes = (args.dir / f'{stem}.zip').read_bytes()
    entry = next(item for item in manifest['artifacts'] if item['filename'] == f'{stem}.zip')
    if sha(zip_bytes) != entry['sha256'] or len(zip_bytes) != entry['bytes']:
        raise ValueError('Baseline ZIP manifest mismatch')
    checksums = (args.dir / f'{stem}.sha256').read_text(encoding='utf-8').splitlines()
    if f'{entry["sha256"]}  {stem}.zip' not in checksums:
        raise ValueError('Baseline checksum file mismatch')
    exe = 'drag.app/Contents/MacOS/drag'
    asar = 'drag.app/Contents/Resources/app.asar'
    with zipfile.ZipFile(args.dir / f'{stem}.zip') as archive:
        if archive.testzip() is not None:
            raise ValueError('Baseline ZIP CRC failure')
        if sha(archive.read(exe)) != manifest['executableSha256'] or sha(archive.read(asar)) != manifest['asarSha256']:
            raise ValueError('Baseline ZIP internal digest mismatch')
    print(json.dumps({'tag': args.tag, 'platform': 'mac', 'zipSha256': sha(zip_bytes), 'verified': True}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, FileNotFoundError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        print(f'Baseline verification failed: {error}', file=sys.stderr)
        sys.exit(1)
