"""Create canonical ZIP metadata and compare the Mac signatures in installed bundles."""
import ctypes
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import struct
import zipfile

# Darwin does not provide os.listxattr in all supported Python distributions.
libc = ctypes.CDLL(None, use_errno=True)
libc.listxattr.restype = libc.getxattr.restype = ctypes.c_ssize_t
NOFOLLOW = 1


def read_attrs(path):
    filename = os.fsencode(path)
    def read(function, arguments):
        length = function(*arguments(None, 0))
        if length < 0:
            raise OSError(ctypes.get_errno(), str(path))
        data = ctypes.create_string_buffer(length)
        if length and function(*arguments(data, length)) != length:
            raise OSError(ctypes.get_errno(), str(path))
        return data.raw
    names = read(libc.listxattr, lambda data, size: (filename, data, size, NOFOLLOW)).split(b'\0')
    return {
        name: read(libc.getxattr, lambda data, size: (filename, name, data, size, 0, NOFOLLOW))
        for name in names if name.startswith(b'com.apple.cs.') or
        name in (b'com.apple.ResourceFork', b'com.apple.FinderInfo')
    }


def entries(app):
    yield app
    for directory, dirs, files in os.walk(app, followlinks=False):
        for name in sorted(dirs + files):
            yield Path(directory, name)


def signature_inventory(app):
    return {path.relative_to(app): attrs for path in entries(app) if (attrs := read_attrs(path))}


def verify_zip(archive):
    # bsdtar emits Info-ZIP's 0x7875 field in *both* headers. ditto's local-only
    # 0x5855 field is a different format and may contain the build Mac UID/GID.
    def owner(fields):
        found = False
        while fields:
            kind, size = struct.unpack_from('<HH', fields)
            data, fields = fields[4:4+size], fields[4+size:]
            if len(data) != size or kind not in (0x7875, 0x5455):
                raise ValueError('Unreviewed ZIP extra field')
            if kind == 0x7875:
                if data != bytes.fromhex('01 04 63000000 04 63000000'):
                    raise ValueError('Unexpected ZIP ownership')
                found = True
        if not found:
            raise ValueError('Missing canonical ZIP owner')
    with archive.open('rb') as stream, zipfile.ZipFile(archive) as packaged:
        for entry in packaged.infolist():
            owner(entry.extra)
            stream.seek(entry.header_offset + 26)
            name_len, extra_len = struct.unpack('<HH', stream.read(4))
            stream.seek(name_len, 1)
            owner(stream.read(extra_len))
            if entry.filename.startswith('__MACOSX/') and not entry.is_dir():
                if b'com.apple.provenance' in packaged.read(entry):
                    raise ValueError('ZIP contains host provenance')


def package(app, archive):
    with tempfile.TemporaryDirectory(dir=archive.parent) as temporary:
        stage = Path(temporary)
        helper = stage / 'package-xattrs'
        subprocess.run(['xcrun', 'clang', Path(__file__).with_name('package-xattrs.c'), '-o', helper], check=True)
        companions = stage / '__MACOSX'
        companions.mkdir()
        for path in entries(app):
            if not read_attrs(path):
                continue
            target = companions / path.relative_to(app.parent).with_name('._' + path.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([helper, path, target], check=True)
        subprocess.run(['/usr/bin/bsdtar', '--format', 'zip', '--uid', '99', '--gid', '99',
                        '--uname', '', '--gname', '', '--no-mac-metadata', '--no-xattrs',
                        '-cf', archive, '-C', app.parent, app.name, '-C', stage, companions.name], check=True)
        verify_zip(archive)


if __name__ == '__main__':
    command, source, destination = sys.argv[1:]
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if command == 'zip':
        package(source, destination)
    elif command in ('verify', 'verify-hfs'):
        source_signature = signature_inventory(source)
        actual = signature_inventory(destination)
        if command == 'verify-hfs':
            # hdiutil/HFS+ omits the zero-length ad-hoc CMS placeholder.
            # All other names must be present and their data must be byte identical.
            for key, attrs in source_signature.items():
                name = b'com.apple.cs.CodeSignature'
                if attrs.get(name) == b'' and key in actual and name not in actual[key]:
                    del attrs[name]
        if source_signature != actual:
            raise ValueError('Mac signing/resource attributes differ from the source bundle')
        print(f'Verified signing/resource metadata on {len(source_signature)} entries')
    else:
        raise SystemExit('Expected zip or verify')
