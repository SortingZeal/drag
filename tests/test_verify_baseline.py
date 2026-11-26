"""Mac-only prior Release verification without network access."""
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'verify-baseline.py'
SPEC = importlib.util.spec_from_file_location('verify_baseline', SCRIPT)
baseline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(baseline)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class MacBaselineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.tag = 'v1.0.0'
        self.stem = f'drag-{self.tag}-macOS-arm64'
        self.zip_path = self.folder / f'{self.stem}.zip'
        executable = b'prior-mac-executable'
        asar = b'prior-app-asar'
        with zipfile.ZipFile(self.zip_path, 'w') as archive:
            archive.writestr('drag.app/Contents/MacOS/drag', executable)
            archive.writestr('drag.app/Contents/Resources/app.asar', asar)
        zip_bytes = self.zip_path.read_bytes()
        manifest = {
            'version': self.tag[1:], 'platform': 'darwin', 'arch': 'arm64',
            'executableSha256': sha(executable), 'asarSha256': sha(asar),
            'artifacts': [{'filename': self.zip_path.name, 'bytes': len(zip_bytes), 'sha256': sha(zip_bytes)}],
        }
        (self.folder / f'{self.stem}.json').write_text(json.dumps(manifest), encoding='utf-8')
        (self.folder / f'{self.stem}.sha256').write_text(f'{sha(zip_bytes)}  {self.zip_path.name}\n', encoding='utf-8')
        self.assets = [
            {'name': path.name, 'size': path.stat().st_size, 'digest': 'sha256:' + sha(path.read_bytes())}
            for path in (self.zip_path, self.folder / f'{self.stem}.json', self.folder / f'{self.stem}.sha256')
        ]

    def run_baseline(self, latest_tag=None, assets=None):
        latest_tag = latest_tag or self.tag
        assets = assets or self.assets

        def fake_check_output(argv):
            endpoint = argv[2]
            if endpoint.endswith(f'/releases/tags/{self.tag}'):
                payload = {'tag_name': self.tag, 'draft': False, 'prerelease': False, 'assets': assets}
            elif endpoint.endswith('/releases/latest'):
                payload = {'tag_name': latest_tag}
            else:
                raise AssertionError(f'Unexpected API call: {endpoint}')
            return json.dumps(payload).encode()

        argv = [str(SCRIPT), '--tag', self.tag, '--repo', 'example/old', '--dir', str(self.folder)]
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(baseline.subprocess, 'check_output', side_effect=fake_check_output), \
             redirect_stdout(io.StringIO()) as output:
            baseline.main()
        return json.loads(output.getvalue())

    def test_mac_baseline_matches_latest_release_and_internal_zip(self):
        result = self.run_baseline()
        self.assertTrue(result['verified'])
        self.assertEqual(result['platform'], 'mac')
        self.assertEqual(result['zipSha256'], sha(self.zip_path.read_bytes()))

    def test_rejects_wrong_latest_or_remote_digest(self):
        with self.assertRaisesRegex(ValueError, 'current latest Release'):
            self.run_baseline(latest_tag='v0.9.0')
        bad_assets = [{**asset, 'digest': 'sha256:' + '0' * 64} if asset['name'].endswith('.zip') else asset
                      for asset in self.assets]
        with self.assertRaisesRegex(ValueError, 'Remote digest mismatch'):
            self.run_baseline(assets=bad_assets)

    def test_windows_platform_option_is_not_accepted(self):
        argv = [str(SCRIPT), '--tag', self.tag, '--dir', str(self.folder), '--platform', 'windows']
        with mock.patch.object(sys, 'argv', argv), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            baseline.main()


if __name__ == '__main__':
    unittest.main()
