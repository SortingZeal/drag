#!/bin/bash
# Native macOS arm64 validation. Set DRAG_PREVIOUS_TAG for a release candidate.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Requires native macOS arm64' >&2; exit 1; }
[[ -z "${DRAG_TEST_URL:-}" && -z "${DRAG_CHROME_PATH:-}" ]] || { echo 'Unset DRAG_TEST_URL and DRAG_CHROME_PATH for release validation' >&2; exit 1; }
if [[ "${DRAG_SAME_VERSION_REPLACEMENT:-}" == 1 ]]; then
  [[ -n "${DRAG_PREVIOUS_TAG:-}" ]] || { echo 'Same-version replacement requires DRAG_PREVIOUS_TAG' >&2; exit 1; }
  [[ "${DRAG_PREVIOUS_TAG#v}" == "$(node -p "require('./package.json').version")" ]] || { echo 'Same-version replacement requires the released version to match package.json' >&2; exit 1; }
fi
revision="$(git rev-parse HEAD)"
evidence="${DRAG_EVIDENCE_DIR:-$PWD/audit/local-validation/$revision/mac}"
mkdir -p "$evidence"
printf 'sourceRevision=%s\nstartedAt=%s\n' "$revision" "$(date -u +%FT%TZ)" > "$evidence/run.txt"

npm ci | tee "$evidence/npm-ci.log"
npm run check | tee "$evidence/check.log"
python3 -m unittest discover -s tests -p 'test_*.py' -v 2>&1 | tee "$evidence/release-gate-tests.log"
npm run test:unit | tee "$evidence/unit.log"
npm run build | tee "$evidence/build.log"
for browser in chromium firefox; do
  npx playwright install "$browser"
  DRAG_BROWSER="$browser" DRAG_TEST_DIST=1 CI=1 \
    DRAG_TEST_OUTPUT="$evidence/$browser-results" \
    DRAG_TEST_JSON="$evidence/$browser-results.json" \
    DRAG_TEST_REPORT="$evidence/$browser-report" npm run test:browser
done
npx playwright install webkit
for shard in {1..8}; do
  DRAG_BROWSER=webkit DRAG_TEST_DIST=1 CI=1 \
    DRAG_TEST_OUTPUT="$evidence/webkit-shard-$shard-results" \
    DRAG_TEST_JSON="$evidence/webkit-shard-$shard-results.json" \
    DRAG_TEST_REPORT="$evidence/webkit-shard-$shard-report" \
    npm run test:browser -- --shard="$shard/8"
done
DRAG_EVIDENCE_DIR="$evidence" python3 - <<'PY'
import json, os
from pathlib import Path

root = Path(os.environ['DRAG_EVIDENCE_DIR'])

def checked_report(path):
    report = json.loads(path.read_text(encoding='utf-8'))
    stats = report['stats']
    if report.get('errors') or any(stats.get(key, 0) for key in ('skipped', 'flaky', 'unexpected')):
        raise ValueError(f'{path.name}: browser failures or skipped/flaky tests: {stats}')
    ids = []
    def visit(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    if test['status'] != 'expected' or not test['results'] or any(result['status'] != 'passed' for result in test['results']):
                        raise ValueError(f'{path.name}: test did not pass: {spec["title"]}')
                    ids.append((spec['id'], test.get('projectId', '')))
            visit(suite.get('suites', []))
    visit(report['suites'])
    if stats['expected'] != len(ids) or len(ids) != len(set(ids)):
        raise ValueError(f'{path.name}: expected count or unique test IDs mismatch')
    return stats, set(ids)

baseline = {}
for browser in ('chromium', 'firefox'):
    baseline[browser] = checked_report(root / f'{browser}-results.json')
if baseline['chromium'][1] != baseline['firefox'][1]:
    raise ValueError('Chromium and Firefox test inventories differ')

shards, webkit_ids = [], set()
for index in range(1, 9):
    filename = f'webkit-shard-{index}-results.json'
    stats, ids = checked_report(root / filename)
    if not ids:
        raise ValueError(f'{filename}: shard contains no tests')
    if webkit_ids & ids:
        raise ValueError(f'{filename}: duplicate tests across WebKit shards')
    webkit_ids.update(ids)
    shards.append({'index': index, 'json': filename, 'expected': stats['expected'], 'skipped': 0, 'flaky': 0, 'unexpected': 0})
if webkit_ids != baseline['chromium'][1]:
    raise ValueError(f'WebKit shard inventory differs from Chromium/Firefox: {len(webkit_ids)} vs {len(baseline["chromium"][1])}')

summary = {
    'browser': 'webkit', 'shardCount': len(shards),
    'expected': len(webkit_ids), 'skipped': 0, 'flaky': 0, 'unexpected': 0,
    'baselineExpected': {browser: stats['expected'] for browser, (stats, _) in baseline.items()},
    'shards': shards,
}
(root / 'webkit-shards-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary))
PY
package_dir="$evidence/release"
DRAG_RELEASE_DIR="$package_dir" npm run package:desktop | tee "$evidence/package.log"
DRAG_DESKTOP_EXECUTABLE="$package_dir/drag.app/Contents/MacOS/drag" \
  DRAG_DESKTOP_EVIDENCE="$evidence/desktop" \
  node --test --test-reporter=tap --test-force-exit tests/desktop.test.js | tee "$evidence/desktop.tap"

if [[ -n "${DRAG_PREVIOUS_TAG:-}" ]]; then
  command -v gh >/dev/null || { echo 'gh CLI is required for upgrade verification' >&2; exit 1; }
  previous_repo="${DRAG_PREVIOUS_REPO:-SortingZeal/drag}"
  previous="$evidence/previous"
  mkdir -p "$previous"
  gh release download "$DRAG_PREVIOUS_TAG" --repo "$previous_repo" \
    --pattern "drag-$DRAG_PREVIOUS_TAG-macOS-arm64.zip" \
    --pattern "drag-$DRAG_PREVIOUS_TAG-macOS-arm64.json" \
    --pattern "drag-$DRAG_PREVIOUS_TAG-macOS-arm64.sha256" --dir "$previous" --clobber
  python3 scripts/verify-baseline.py --tag "$DRAG_PREVIOUS_TAG" --repo "$previous_repo" --dir "$previous" | tee "$evidence/baseline.json"
  if [[ "${DRAG_SAME_VERSION_REPLACEMENT:-}" == 1 ]]; then
    DRAG_PREVIOUS_PACKAGE="$previous/drag-$DRAG_PREVIOUS_TAG-macOS-arm64.zip" \
      DRAG_CURRENT_PACKAGE="$package_dir/drag-$DRAG_PREVIOUS_TAG-macOS-arm64.zip" \
      DRAG_EQUIVALENCE_REPORT="$evidence/repackage-equivalence.json" python3 - <<'PY'
import hashlib, json, os, zipfile
from pathlib import Path
entry = 'drag.app/Contents/Resources/app.asar'
with zipfile.ZipFile(os.environ['DRAG_PREVIOUS_PACKAGE']) as old_zip, zipfile.ZipFile(os.environ['DRAG_CURRENT_PACKAGE']) as new_zip:
    old_asar, new_asar = old_zip.read(entry), new_zip.read(entry)
if old_asar != new_asar:
    raise ValueError('Same-version repackage changed app.asar')
sha = hashlib.sha256(new_asar).hexdigest()
manifest = json.loads(Path(os.environ['DRAG_CURRENT_PACKAGE']).with_suffix('.json').read_text(encoding='utf-8'))
if manifest['asarSha256'] != sha:
    raise ValueError('Repackage manifest app.asar mismatch')
report = {'asarByteEquivalent': True, 'asarSha256': sha, 'baselineTag': os.environ['DRAG_PREVIOUS_TAG']}
Path(os.environ['DRAG_EQUIVALENCE_REPORT']).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
PY
  fi
  mkdir -p "$previous/expanded"
  ditto -x -k "$previous/drag-$DRAG_PREVIOUS_TAG-macOS-arm64.zip" "$previous/expanded"
  transition_report=upgrade.tap
  if [[ "${DRAG_SAME_VERSION_REPLACEMENT:-}" == 1 ]]; then
    transition_report=replacement.tap
  fi
  DRAG_PREVIOUS_EXECUTABLE="$previous/expanded/drag.app/Contents/MacOS/drag" \
    DRAG_DESKTOP_EXECUTABLE="$package_dir/drag.app/Contents/MacOS/drag" \
    DRAG_PREVIOUS_VERSION="${DRAG_PREVIOUS_TAG#v}" \
    DRAG_SAME_VERSION_REPLACEMENT="${DRAG_SAME_VERSION_REPLACEMENT:-}" \
    node --test --test-reporter=tap --test-force-exit tests/upgrade.test.js | tee "$evidence/$transition_report"
else
  echo 'Upgrade test skipped: set DRAG_PREVIOUS_TAG to the current stable tag.' | tee "$evidence/upgrade-status.txt"
fi
printf 'finishedAt=%s\n' "$(date -u +%FT%TZ)" >> "$evidence/run.txt"
DRAG_SOURCE_REVISION="$revision" DRAG_EVIDENCE_DIR="$evidence" python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
root = Path(os.environ['DRAG_EVIDENCE_DIR'])
result = {
    'sourceRevision': os.environ['DRAG_SOURCE_REVISION'],
    'sourceDirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], text=True).strip()),
    'platform': 'darwin', 'arch': 'arm64',
    'baselineTag': os.environ.get('DRAG_PREVIOUS_TAG') or None,
    'baselineRepo': (os.environ.get('DRAG_PREVIOUS_REPO') or 'SortingZeal/drag') if os.environ.get('DRAG_PREVIOUS_TAG') else None,
    'checksPassed': True, 'unitPassed': True, 'buildPassed': True,
    'releaseGateTestsPassed': True,
    'browsersPassed': ['chromium', 'firefox', 'webkit'],
    'desktopPassed': True, 'upgradePassed': bool(os.environ.get('DRAG_PREVIOUS_TAG')),
    'sameVersionReplacementPassed': os.environ.get('DRAG_SAME_VERSION_REPLACEMENT') == '1',
}
if result['sameVersionReplacementPassed']:
    equivalence = json.loads((root / 'repackage-equivalence.json').read_text(encoding='utf-8'))
    if not equivalence.get('asarByteEquivalent'):
        raise ValueError('Same-version app.asar equivalence missing')
    result['upgradePassed'] = False
    result['rebuildAsarSha256'] = equivalence['asarSha256']
    result['releaseTransition'] = 'same-version-repackage'
(root / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
PY
echo "Mac validation evidence: $evidence"
