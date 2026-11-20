"""Release-gate tests with local files and mocked GitHub calls."""
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'verify-release.py'
SPEC = importlib.util.spec_from_file_location('verify_release', SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ReleaseGateTests(unittest.TestCase):
    tag = 'v' + json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text(encoding='utf-8'))['version']
    baseline_tag = 'v1.0.0'
    revision = 'a' * 40
    stem = f'drag-{tag}-macOS-arm64'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.zip_path = self.folder / f'{self.stem}.zip'
        self.dmg_path = self.folder / f'{self.stem}.dmg'
        exe = b'mac-executable'
        asar = b'packed-application'
        with zipfile.ZipFile(self.zip_path, 'w') as archive:
            archive.writestr('drag.app/Contents/MacOS/drag', exe)
            archive.writestr('drag.app/Contents/Resources/app.asar', asar)
        self.dmg_path.write_bytes(b'mac-disk-image')
        artifacts = [
            {'filename': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
            for path in (self.zip_path, self.dmg_path)
        ]
        manifest = {
            'version': self.tag[1:], 'platform': 'darwin', 'arch': 'arm64',
            'sourceRevision': self.revision, 'sourceDirty': False,
            'executableSha256': sha(exe), 'asarSha256': sha(asar),
            'artifacts': artifacts,
        }
        (self.folder / f'{self.stem}.json').write_text(json.dumps(manifest), encoding='utf-8')
        (self.folder / f'{self.stem}.sha256').write_text(
            ''.join(f'{item["sha256"]}  {item["filename"]}\n' for item in artifacts), encoding='utf-8'
        )

    def package(self):
        return release.load_package(
            self.folder, self.tag, 'macOS-arm64', 'darwin', 'arm64',
            'drag.app/Contents/MacOS/drag', 'drag.app/Contents/Resources/app.asar',
            ('zip', 'dmg', 'json', 'sha256'),
        )

    def entries(self):
        return [
            {'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha(path.read_bytes())}
            for path in self.package()[2]
        ]

    @staticmethod
    def remote_assets(entries):
        return [
            {'name': item['name'], 'size': item['bytes'], 'digest': 'sha256:' + item['sha256'], 'state': 'uploaded'}
            for item in entries
        ]

    def snapshot_api(self, endpoint):
        responses = {
            '': {'private': True, 'default_branch': 'main'},
            f'commits/{self.revision}': {'parents': []},
            'branches?per_page=100&page=1': [{'name': 'main', 'commit': {'sha': self.revision}}],
            'tags?per_page=100&page=1': [{'name': self.tag, 'commit': {'sha': self.revision}}],
            'releases?per_page=100&page=1': [{'tag_name': self.tag}],
            'pulls?state=all&per_page=1': [],
            'issues?state=all&per_page=1': [],
            'actions/permissions': {'enabled': False},
            'actions/runs?per_page=1': {'total_count': 0},
        }
        return responses[endpoint]

    def test_mac_package_has_four_valid_assets_and_rejects_damage(self):
        manifest, asar, paths = self.package()
        self.assertEqual(manifest['sourceRevision'], self.revision)
        self.assertEqual(asar, b'packed-application')
        self.assertEqual([path.suffix for path in paths], ['.zip', '.dmg', '.json', '.sha256'])

        self.dmg_path.write_bytes(b'changed-disk-image')
        with self.assertRaisesRegex(ValueError, 'Artifact checksum mismatch'):
            self.package()

    def test_dmg_mount_matches_manifest_and_detaches_even_after_mismatch(self):
        manifest = self.package()[0]

        def exercise(asar_bytes):
            calls = []

            def hdiutil(argv, **kwargs):
                self.assertEqual(argv[0], '/usr/bin/hdiutil')
                self.assertTrue(kwargs['check'])
                calls.append(argv[1])
                if argv[1] == 'attach':
                    mount = Path(argv[argv.index('-mountpoint') + 1])
                    exe = mount / 'drag.app/Contents/MacOS/drag'
                    asar = mount / 'drag.app/Contents/Resources/app.asar'
                    exe.parent.mkdir(parents=True)
                    asar.parent.mkdir(parents=True)
                    exe.write_bytes(b'mac-executable')
                    asar.write_bytes(asar_bytes)

            with mock.patch.object(release.subprocess, 'run', side_effect=hdiutil):
                if asar_bytes == b'packed-application':
                    release.verify_dmg(self.dmg_path, manifest)
                else:
                    with self.assertRaisesRegex(ValueError, 'DMG application content mismatch'):
                        release.verify_dmg(self.dmg_path, manifest)
            self.assertEqual(calls, ['verify', 'attach', 'detach'])

        exercise(b'packed-application')
        exercise(b'wrong-application')

    def test_dmg_detach_failure_retries_then_preserves_unreleased_mountpoint(self):
        manifest = self.package()[0]
        for force_succeeds in (True, False):
            with self.subTest(force_succeeds=force_succeeds):
                calls = []
                mounts = []

                def hdiutil(argv, **kwargs):
                    self.assertTrue(kwargs['check'])
                    calls.append(argv[1:3])
                    if argv[1] == 'attach':
                        mount = Path(argv[argv.index('-mountpoint') + 1])
                        mounts.append(mount)
                        exe = mount / 'drag.app/Contents/MacOS/drag'
                        asar = mount / 'drag.app/Contents/Resources/app.asar'
                        exe.parent.mkdir(parents=True)
                        asar.parent.mkdir(parents=True)
                        exe.write_bytes(b'mac-executable')
                        asar.write_bytes(b'packed-application')
                    if argv[1] == 'detach' and ('-force' not in argv or not force_succeeds):
                        raise release.subprocess.CalledProcessError(1, argv)

                with mock.patch.object(release.subprocess, 'run', side_effect=hdiutil):
                    if force_succeeds:
                        release.verify_dmg(self.dmg_path, manifest)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'mountpoint preserved'):
                            release.verify_dmg(self.dmg_path, manifest)
                self.assertEqual([item[0] for item in calls], ['verify', 'attach', 'detach', 'detach'])
                self.assertEqual(calls[-1][1], '-force')
                self.assertEqual(mounts[0].exists(), not force_succeeds)
                if not force_succeeds:
                    shutil.rmtree(mounts[0])

    def test_remote_inventory_requires_exactly_four_unique_matching_assets(self):
        entries = self.entries()
        assets = self.remote_assets(entries)
        release.check_remote_assets({'assets': assets}, entries)
        for altered in (
            assets[:-1],
            assets + [{'name': 'unexpected.txt'}],
            assets + [assets[0].copy()],
            [{**assets[0], 'digest': 'sha256:' + '0' * 64}, *assets[1:]],
        ):
            with self.subTest(assets=altered), self.assertRaises(ValueError):
                release.check_remote_assets({'assets': altered}, entries)

    def test_remote_snapshot_rejects_extra_history_refs_and_actions(self):
        repo = 'example/staging'
        cases = (
            (f'commits/{self.revision}', {'parents': [{'sha': 'older'}]}),
            ('branches?per_page=100&page=1', [
                {'name': 'main', 'commit': {'sha': self.revision}},
                {'name': 'old', 'commit': {'sha': 'older'}},
            ]),
            ('tags?per_page=100&page=1', [
                {'name': self.tag, 'commit': {'sha': self.revision}},
                {'name': self.baseline_tag, 'commit': {'sha': 'older'}},
            ]),
            ('actions/runs?per_page=1', {'total_count': 1}),
        )
        for changed_endpoint, changed_response in cases:
            def fake_api(target_repo, endpoint):
                self.assertEqual(target_repo, repo)
                return changed_response if endpoint == changed_endpoint else self.snapshot_api(endpoint)

            with self.subTest(endpoint=changed_endpoint), \
                 mock.patch.object(release, 'api', side_effect=fake_api), \
                 self.assertRaises(ValueError):
                release.check_remote_snapshot(repo, self.tag, self.revision,
                                              {'default_branch': 'main'})

    def test_mac_evidence_must_match_source_and_complete_native_gate(self):
        evidence = {
            'platform': 'darwin', 'arch': 'arm64', 'sourceRevision': self.revision,
            'sourceDirty': False, 'baselineTag': self.baseline_tag, 'baselineRepo': 'example/old',
            'checksPassed': True, 'unitPassed': True, 'buildPassed': True,
            'releaseGateTestsPassed': True,
            'desktopPassed': True, 'upgradePassed': True,
            'browsersPassed': ['chromium', 'firefox', 'webkit'],
        }
        evidence_path = self.folder / 'result.json'
        evidence_path.write_text(json.dumps(evidence), encoding='utf-8')
        baseline_path = self.folder / 'baseline.json'
        baseline_path.write_text(json.dumps({'tag': self.baseline_tag, 'verified': True}), encoding='utf-8')
        self.assertEqual(release.check_evidence(self.folder, 'darwin', 'arm64', self.revision), evidence)
        with self.assertRaisesRegex(ValueError, 'identity mismatch'):
            release.check_evidence(self.folder, 'darwin', 'arm64', 'b' * 40)
        evidence['browsersPassed'] = ['chromium', 'firefox']
        evidence_path.write_text(json.dumps(evidence), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Browser validation incomplete'):
            release.check_evidence(self.folder, 'darwin', 'arm64', self.revision)
        evidence['browsersPassed'] = ['chromium', 'firefox', 'webkit']
        evidence_path.write_text(json.dumps(evidence), encoding='utf-8')
        for baseline in ({'tag': self.baseline_tag, 'verified': False},
                         {'tag': 'v0.9.0', 'verified': True}):
            with self.subTest(baseline=baseline), self.assertRaisesRegex(ValueError, 'Baseline verification evidence incomplete'):
                baseline_path.write_text(json.dumps(baseline), encoding='utf-8')
                release.check_evidence(self.folder, 'darwin', 'arm64', self.revision)

    def test_same_version_repackage_evidence_is_distinct_from_upgrade(self):
        asar_sha = sha(b'packed-application')
        evidence = {
            'platform': 'darwin', 'arch': 'arm64', 'sourceRevision': self.revision,
            'sourceDirty': False, 'baselineTag': self.tag, 'baselineRepo': 'example/old',
            'checksPassed': True, 'unitPassed': True, 'buildPassed': True,
            'releaseGateTestsPassed': True, 'desktopPassed': True,
            'upgradePassed': False, 'sameVersionReplacementPassed': True,
            'releaseTransition': 'same-version-repackage', 'rebuildAsarSha256': asar_sha,
            'browsersPassed': ['chromium', 'firefox', 'webkit'],
        }
        (self.folder / 'result.json').write_text(json.dumps(evidence), encoding='utf-8')
        (self.folder / 'baseline.json').write_text(json.dumps({'tag': self.tag, 'verified': True}), encoding='utf-8')
        equivalence = {'baselineTag': self.tag, 'asarByteEquivalent': True, 'asarSha256': asar_sha}
        (self.folder / 'repackage-equivalence.json').write_text(json.dumps(equivalence), encoding='utf-8')
        self.assertEqual(release.check_evidence(self.folder, 'darwin', 'arm64', self.revision), evidence)

        argv = [str(SCRIPT), '--tag', self.tag, '--mac-dir', str(self.folder),
                '--mac-evidence', str(self.folder)]
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(release, 'verify_dmg'), \
             redirect_stdout(io.StringIO()) as output:
            release.main()
        report = json.loads(output.getvalue())
        self.assertTrue(report['sameVersionReplacementVerified'])
        self.assertFalse(report['crossVersionUpgradeRerun'])

        equivalence['asarSha256'] = '0' * 64
        (self.folder / 'repackage-equivalence.json').write_text(json.dumps(equivalence), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'repackage evidence incomplete'):
            release.check_evidence(self.folder, 'darwin', 'arm64', self.revision)

    def test_draft_upload_accepts_verified_public_latest_baseline(self):
        manifest, asar, paths = self.package()
        entries = self.entries()
        staged = {'tag_name': self.tag, 'draft': True, 'prerelease': False,
                  'assets': [], 'html_url': f'https://github.com/example/staging/releases/tag/{self.tag}'}
        uploaded = {**staged, 'assets': self.remote_assets(entries)}
        stage_repo = 'example/staging'
        old_repo = 'example/public'
        latest = {'tag_name': self.baseline_tag, 'draft': False, 'prerelease': False}
        calls = []

        def fake_api(repo, endpoint):
            calls.append((repo, endpoint))
            if repo == stage_repo:
                return self.snapshot_api(endpoint)
            if (repo, endpoint) == (old_repo, 'releases/latest'):
                return latest
            raise AssertionError(f'Unexpected GitHub API call: {repo} {endpoint}')

        def fake_run(*args):
            if args[:2] == ('git', 'status'):
                return ''
            if args[0] == 'git':
                return self.revision
            raise AssertionError(f'Unexpected command: {args}')

        argv = [str(SCRIPT), '--tag', self.tag, '--mac-dir', str(self.folder),
                '--mac-evidence', str(self.folder), '--repo', stage_repo,
                '--baseline-repo', old_repo, '--upload-draft']
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(release, 'api', side_effect=fake_api), \
             mock.patch.object(release, 'run', side_effect=fake_run), \
             mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
             mock.patch.object(release, 'verify_dmg'), \
             mock.patch.object(release, 'check_evidence', return_value={'baselineTag': self.baseline_tag, 'baselineRepo': old_repo}), \
             mock.patch.object(release, 'remote_release', side_effect=[staged, uploaded]), \
             mock.patch.object(release, 'remote_tag_commit', return_value=self.revision), \
             mock.patch.object(release.subprocess, 'run') as upload, \
             redirect_stdout(io.StringIO()) as output:
            release.main()

        self.assertIn((old_repo, 'releases/latest'), calls)
        self.assertNotIn((old_repo, ''), calls)
        self.assertNotIn((stage_repo, 'releases/latest'), calls)
        upload.assert_called_once_with(
            ['gh', 'release', 'upload', self.tag, '--repo', stage_repo, *map(str, paths)], check=True,
        )
        report = json.loads(output.getvalue())
        self.assertEqual(report['baselineRepo'], old_repo)
        self.assertEqual(report['platformScope'], ['darwin-arm64'])
        self.assertEqual(len(report['assets']), 4)

        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(release, 'api', side_effect=fake_api), \
             mock.patch.object(release, 'run', side_effect=fake_run), \
             mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
             mock.patch.object(release, 'verify_dmg'), \
             mock.patch.object(release, 'check_evidence', return_value={'baselineTag': self.baseline_tag, 'baselineRepo': 'example/wrong'}), \
             mock.patch.object(release, 'remote_release', return_value=staged), \
             mock.patch.object(release, 'remote_tag_commit', return_value=self.revision), \
             mock.patch.object(release.subprocess, 'run') as refused_upload:
            with self.assertRaisesRegex(ValueError, 'different upgrade baseline repository'):
                release.main()
        refused_upload.assert_not_called()

        for unstable in ({'tag_name': self.baseline_tag, 'draft': True, 'prerelease': False},
                         {'tag_name': self.baseline_tag, 'draft': False, 'prerelease': True}):
            latest = unstable
            with self.subTest(latest=latest), \
                 mock.patch.object(sys, 'argv', argv), \
                 mock.patch.object(release, 'api', side_effect=fake_api), \
                 mock.patch.object(release, 'run', side_effect=fake_run), \
                 mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
                 mock.patch.object(release, 'verify_dmg'), \
                 mock.patch.object(release, 'check_evidence', return_value={'baselineTag': self.baseline_tag, 'baselineRepo': old_repo}), \
                 mock.patch.object(release, 'remote_release', return_value=staged), \
                 mock.patch.object(release, 'remote_tag_commit', return_value=self.revision), \
                 mock.patch.object(release.subprocess, 'run') as refused_upload:
                with self.assertRaisesRegex(ValueError, 'published stable Release'):
                    release.main()
                refused_upload.assert_not_called()

    def test_draft_can_be_fully_rechecked_before_publication(self):
        manifest, asar, paths = self.package()
        repo = 'example/renamed'
        draft = {'tag_name': self.tag, 'draft': True, 'prerelease': False,
                 'assets': self.remote_assets(self.entries()),
                 'html_url': f'https://github.com/example/renamed/releases/tag/{self.tag}'}

        def fake_api(target_repo, endpoint):
            self.assertEqual(target_repo, repo)
            return self.snapshot_api(endpoint)

        def fake_run(*args):
            if args[:2] == ('git', 'status'):
                return ''
            return self.revision

        argv = [str(SCRIPT), '--tag', self.tag, '--mac-dir', str(self.folder),
                '--mac-evidence', str(self.folder), '--repo', repo, '--verify-draft']
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(release, 'api', side_effect=fake_api), \
             mock.patch.object(release, 'run', side_effect=fake_run), \
             mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
             mock.patch.object(release, 'verify_dmg'), \
             mock.patch.object(release, 'check_evidence', return_value={'baselineTag': self.baseline_tag, 'baselineRepo': 'example/old'}), \
             mock.patch.object(release, 'remote_release', return_value=draft), \
             mock.patch.object(release, 'remote_tag_commit', return_value=self.revision), \
             redirect_stdout(io.StringIO()) as output:
            release.main()
        report = json.loads(output.getvalue())
        self.assertTrue(report['prePublicationVerified'])
        self.assertTrue(report['remoteVerified'])
        self.assertTrue(report['draft'])
        self.assertTrue(report['dmgMountVerifiedByThisScript'])

        published = {**draft, 'draft': False}
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(release, 'api', side_effect=fake_api), \
             mock.patch.object(release, 'run', side_effect=fake_run), \
             mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
             mock.patch.object(release, 'verify_dmg'), \
             mock.patch.object(release, 'check_evidence', return_value={'baselineTag': self.baseline_tag, 'baselineRepo': 'example/old'}), \
             mock.patch.object(release, 'remote_release', return_value=published), \
             mock.patch.object(release, 'remote_tag_commit', return_value=self.revision):
            with self.assertRaisesRegex(ValueError, 'Expected a private draft Release'):
                release.main()

    def test_published_public_release_can_be_verified_but_not_uploaded_to(self):
        manifest, asar, paths = self.package()
        repo = 'example/public'
        published = {'id': 8, 'tag_name': self.tag, 'draft': False, 'prerelease': False,
                     'assets': self.remote_assets(self.entries()),
                     'html_url': f'https://github.com/example/public/releases/tag/{self.tag}'}

        def fake_api(target_repo, endpoint):
            self.assertEqual(target_repo, repo)
            if endpoint == '':
                return {'private': False, 'default_branch': 'main'}
            if endpoint == 'releases/latest':
                return published
            return self.snapshot_api(endpoint)

        def fake_run(*args):
            return self.revision

        argv = [str(SCRIPT), '--tag', self.tag, '--mac-dir', str(self.folder),
                '--repo', repo, '--verify-remote']
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(release, 'api', side_effect=fake_api), \
             mock.patch.object(release, 'run', side_effect=fake_run), \
             mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
             mock.patch.object(release, 'verify_dmg'), \
             mock.patch.object(release, 'remote_release', return_value=published), \
             mock.patch.object(release, 'remote_tag_commit', return_value=self.revision), \
             redirect_stdout(io.StringIO()) as output:
            release.main()
        self.assertTrue(json.loads(output.getvalue())['latestPublishedStable'])

        argv[-1] = '--upload-draft'
        argv.extend(['--mac-evidence', str(self.folder)])
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(release, 'api', side_effect=fake_api), \
             mock.patch.object(release, 'load_package', return_value=(manifest, asar, paths)), \
             mock.patch.object(release, 'verify_dmg'), \
             mock.patch.object(release, 'check_evidence', return_value={'baselineTag': self.tag, 'baselineRepo': repo}):
            with self.assertRaisesRegex(ValueError, 'Refusing draft operations on a public repository'):
                release.main()

    def test_local_release_gate_rejects_dirty_or_unknown_source_state(self):
        manifest_path = self.folder / f'{self.stem}.json'
        argv = [str(SCRIPT), '--tag', self.tag, '--mac-dir', str(self.folder)]
        for dirty in (True, None):
            with self.subTest(sourceDirty=dirty):
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
                if dirty is None:
                    manifest.pop('sourceDirty')
                else:
                    manifest['sourceDirty'] = dirty
                manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
                with mock.patch.object(sys, 'argv', argv), self.assertRaisesRegex(ValueError, 'clean source tree'):
                    release.main()


if __name__ == '__main__':
    unittest.main()
