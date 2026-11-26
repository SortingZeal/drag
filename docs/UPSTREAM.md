# Frappe Gantt integration

## Provenance

- Project: [Frappe Gantt](https://github.com/frappe/gantt)
- Package: `frappe-gantt@1.2.2`
- npm release: [version 1.2.2](https://www.npmjs.com/package/frappe-gantt/v/1.2.2)
- Published source commit (`gitHead`): [`4c82fccce9bf4237ded41680869529cea4385a90`](https://github.com/frappe/gantt/commit/4c82fccce9bf4237ded41680869529cea4385a90)
- Official metadata: [npm registry release metadata](https://registry.npmjs.org/frappe-gantt/1.2.2)
- Tarball: `https://registry.npmjs.org/frappe-gantt/-/frappe-gantt-1.2.2.tgz`
- Integrity: `sha512-1+uPNRa92LBIeKiZCVhJMiGIifJk5ONaoerXI8eBREXWRZGGoTJR5ATpMpsnAQcyBA6Gnq5wIht4eL+e4eHMBA==`
- Tarball SHA-1 reported by npm: `36bf15e74e179ac707341b663a49493a05a7fdf5`
- License: MIT, copyright 2024 Frappe Technologies Pvt. Ltd. The installed `license.txt` is copied verbatim to [`LICENSES/frappe-gantt-MIT.txt`](../LICENSES/frappe-gantt-MIT.txt).

`package-lock.json` pins the package and integrity used by `npm ci`.

The application adapter subclasses the installed npm package.

## API findings in 1.2.2

These findings come from `src/index.js`, `src/bar.js`, `src/defaults.js` and `src/date_utils.js` in the installed package. [Official configuration documentation](https://docs.frappe.io/gantt/config) provides the general public API; release source remains the reference for version-specific behavior.

| Area | Verified behavior | Integration implication |
| --- | --- | --- |
| CSS export | `exports` exposes the package entry and a `style` condition, but no `./dist/frappe-gantt.css` subpath. | The old deep package import fails in Vite. Resolve the installed stylesheet explicitly. |
| Views | Predefined views include Day, Week, Month and Year; there is no predefined Quarter view. `change_view_mode` accepts a full mode object. | Supply an explicit Quarter mode with a `3m` step. |
| Custom modes | Supplying `view_modes` makes `setup_options` select the first array entry. | Supply the selected full mode as `view_mode` when configuring the adapter. |
| Padding | With `infinite_padding: false`, a mode's `padding` accepts a string or a two-element array, e.g. `['6m', '9m']`. | Independently extend each side without fake anchor tasks or extra task rows. |
| Infinite padding | `infinite_padding: true` installs its own inner-container mousewheel expansion. | Disable it when the application owns outer viewport scrolling and range expansion. |
| Native snapping | `snap_at` accepts duration strings such as `1d`, `7d`, `30d`; `unit` also has special meaning. Defaults are one day, seven days in Month and thirty days in Year. | The adapter implements the selected day interval explicitly so the model always contains whole ISO dates. A `30d` interval is thirty days, not a variable-length calendar month. |
| End date | A date-only task `end` is inclusive: `setup_tasks` adds 24 hours internally. `date_change` supplies the internal exclusive end minus one second. | Pass the stored inclusive ISO end directly. Do not add a day on input or subtract a day from the callback's formatted date. |
| Date callbacks | `Bar.update_bar_position` calls `date_changed` during each movement, not only at mouse release. | Do not rebuild the editor or create undo history for every upstream movement event. Commit one interaction once on release. |
| Month/year arithmetic | `diff` uses fractional month calculations, `convert_scales` treats months as 30 days and years as 365 days, while `add` truncates its quantity to an integer. | Native fractional month/year drag geometry cannot reliably round-trip arbitrary ISO dates. Use calendar-tick interpolation and civil-day arithmetic in the application adapter. |
| CSS task classes | `Bar.refresh` calls `classList.add(custom_class)` with a single argument. | Pass a single class token; add other visual classes separately. A space-separated string throws `InvalidCharacterError`. |
| Cleanup | There is no public `destroy` method. Native `bind_bar_events` adds an anonymous `document` mouseup listener. `render` itself does not register a document listener. | Override `bind_bar_events` for the application pointer adapter, and dispose the adapter's own listeners and animation frames explicitly. |

## Application adapter boundary

The adapter uses a subclass override of `bind_bar_events()` to keep native movement and its anonymous global listener disabled. Application pointer handling owns movement, resizing, snapping and edge auto-pan. Calendar ticks (`dates` and `config.column_width`) provide the date-to-position mapping; positions interpolate using civil days between calendar tick dates. The stored model dates remain inclusive ISO `YYYY-MM-DD` strings.

Bar positions and widths are written directly, followed by label and handle positioning. Calling upstream `update_bar_position` would reintroduce its month/year conversion and per-move date callbacks. Timeline changes must preserve a date's viewport position, and must not change model dates. A completed gesture records one model edit and only locks the properties that actually changed.

The subclass hook, tick arrays and bar helpers are internal to Frappe Gantt. Rerun the interaction tests before upgrading the pinned package.
