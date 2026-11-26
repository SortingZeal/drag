# Windows portable build

The Windows download is a single x64 executable. Run it to open drag. It extracts the bundled Electron runtime to a temporary folder for that session. Closing the application removes the temporary runtime. The application keeps preferences and backups in the Windows user's application data between sessions.

## Build

Use the Node.js version in `package.json`, the pinned packages in `package-lock.json`, and NSIS 3.13. Add `makensis` to PATH, or set `MAKENSIS` to its executable path. A macOS build host can compile the Windows launcher with Homebrew's `makensis` formula.

```sh
npm ci
npm run package:windows
```

The build checks the Electron runtime against the SHA-256 from the pinned Electron package. For an offline build, set `DRAG_ELECTRON_ZIP_DIR` to a folder containing that exact upstream Windows x64 archive. The output directory defaults to `release`; set `DRAG_RELEASE_DIR` to choose a different location.

The versioned EXE has a JSON manifest alongside it containing its size and SHA-256, the application archive digest, source revision and working-tree state. The executable is unsigned. Windows can show a publisher warning on first launch.

## Test a release

Set `DRAG_WINDOWS_VERIFY_DIR` to a new, empty directory to retain the unpacked application during a build. Compare its `resources/app.asar` to the matching Mac archive. Run the portable EXE on Windows using a new test profile. Pass an existing directory as `--user-data-dir="path to test profile"` to keep test preferences and files together. Check that the window opens, JSON import/export and image downloads work, and that the same test profile reopens correctly.
