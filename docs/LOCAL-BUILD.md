# Local Mac build

Use a clean checkout on Apple Silicon with Node.js 22.12 or later, Python 3 and the GitHub CLI. For development, run `npm ci`, `npm run check`, `npm run test:unit` and `npm run build`. Run `npm run desktop` to open the local editor.

Run the browser suite headlessly with isolated test profiles. Run packaged macOS UI and upgrade tests in a dedicated macOS guest or on a separate test machine. A disposable Electron profile by itself still opens windows on the current desktop.

For release validation, set `DRAG_PREVIOUS_REPO` and `DRAG_PREVIOUS_TAG` to the repository and tag of the currently published stable Mac release. Run `bash scripts/verify-mac-local.sh`. Keep the resulting logs and artifacts under the ignored `audit/` directory. See [release checks](RELEASE-PROCESS.md).
