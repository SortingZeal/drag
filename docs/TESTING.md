# Testing

Run `npm run check`, `npm run test:unit`, `python3 -m unittest discover -s tests -p 'test_*.py'` and `npm run build` from the repository root. Use `npm run test:browser` for Playwright. Set `DRAG_BROWSER` to chromium, firefox or webkit.

The release suite also tests the packaged Mac app, isolated upgrades, ZIP and DMG contents, and remote release integrity. The native run records the exact source revision and pass counts in `audit/local-validation/<revision>/mac/`. See [local build](LOCAL-BUILD.md).
