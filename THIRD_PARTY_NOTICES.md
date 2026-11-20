# Third-party notices

drag uses [Frappe Gantt](https://github.com/frappe/gantt), installed as `frappe-gantt@1.2.2` from the official npm registry.

Frappe Gantt is licensed under the MIT License:

> Copyright (c) 2024 Frappe Technologies Pvt. Ltd.

The complete license is retained in [`LICENSES/frappe-gantt-MIT.txt`](LICENSES/frappe-gantt-MIT.txt). Keep this notice and the complete license with redistributions that include the library, including compiled application bundles.

The application integrates the npm package and subclasses it through an adapter. This distribution does not claim to be an upstream fork. Dependency provenance, the published source commit, package integrity and version-specific API notes are in [`docs/UPSTREAM.md`](docs/UPSTREAM.md).

The macOS application bundles the official `electron@45.0.0` runtime, licensed under MIT. Its complete license is retained in `LICENSES/electron-MIT.txt`. Electron includes Chromium, Node.js and other components; their notices are retained in `LICENSES/electron-chromium.html`. The app also includes the unmodified runtime notices under `Contents/Resources/licenses/`. These notices must accompany redistribution. The desktop wrapper uses `@electron/packager@20.3.0` at build time; this development tool is not bundled into the application.

Vite and Playwright are development and test tools. Their package metadata and license files, and those of their transitive dependencies, are supplied by the respective npm packages when dependencies are installed. `package-lock.json` records the exact dependency graph. If redistributing `node_modules` or these tools themselves, retain their included licenses and notices as well.
