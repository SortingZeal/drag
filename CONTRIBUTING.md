# Developing drag

Use a separate Mac checkout and a `mac/*` branch. The public repository holds the current release snapshot on `main`. Use the [seven-region map](docs/WORKSPACE-REGIONS.md) when discussing layout.

Install Node.js 22.12 or later and run `npm ci` followed by `npm run dev`. To serve a production build locally, run `npm run build` and `./start.command`.

Run JavaScript syntax checks, the unit tests and Playwright when changing the editor. Keep the browser interface and native Mac menus available in Traditional Chinese and English. Use the bundled examples for testing. Keep personal roadmaps, preferences, profiles, screenshots and backups outside the source tree.

Build and verify releases on Apple Silicon using [the release procedure](docs/RELEASE-PROCESS.md). Record the source, test results, upgrade baseline and artifact hashes. Inventory repository data and obtain the owner's approval before deleting refs, releases or repositories. GitHub-hosted Actions are disabled.
