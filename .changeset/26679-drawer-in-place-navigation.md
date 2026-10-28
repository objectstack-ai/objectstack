---
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-list': patch
'@object-ui/react': patch
'@object-ui/i18n': patch
---

feat(app-shell,components): the record drawer opens a related row or a lookup in place, one level at a time, and its bar names no object

Clause-②: no
Metadata-protocol: none

The console's record drawer is one drawer (objectstack#26679):

- **The bar.** Its left side is empty at the root: no object name and no "n / N" position. Its right side holds `↑` `↓` (previous / next through the level's sibling set, disabled at the ends; `↑` / `↓` and `k` / `j` while no text field, menu or grid has the keyboard), `⤢` (icon only) and `✕`. `NavigationOverlay` gains three optional props for it — `onBack`, `trail` and `stepper` — and keeps its title as the accessible name only, on every host.
- **The root steps through the list.** `ListView` reports the rows it shows, in their order, through a new `onRowsChange` host prop (beside `onTotalChange`, answered by a paged grid; a board or a grouped grid reports no rows). The object page hands them to its drawer, so `↑` `↓` at the root move to the previous / next row, disabled at the first and the last.
- **In place.** A related row, a lookup value or any record link inside the drawer opens that record in the same drawer and keeps the previous one on a stack. The bar shows `←` and the path (each ancestor returns to its level); `←` or `Esc` goes back one level, `Esc` at the root closes, `✕` closes the whole stack. `↑` `↓` one level down step through the rows the parent's related list showed, never across levels. Each level keeps its own `?tab=`. An object that declares `navigation.mode: 'page'` still opens its page.
- **⤢ at any level** opens that record's page with the levels below it as its `?from=` trail, so its back link reads the record it was opened from; the page offers "Collapse to drawer", which returns to the drawer with the stack restored.
- **On the record page**, a related row or a lookup opens its record in a drawer over the page, under the same rules.
- **`data-table` inside a dialog.** A table drawn inside a dialog now opens its rows: the row click ignored every click with a dialog ancestor, so a related list inside a record drawer drew pointer rows that opened nothing. Only a dialog portalled out of the row (one that does not contain it) still stops the click.
- **What a reload keeps.** The root stays `?recordId=` on an object list; the levels above it live in memory, so a reload shows the root record.

Published-type additions, all optional: `RelatedRecordHandlers.onView` receives the ids of the rows on show as a third argument, and `RelatedList`'s `onRowClick` receives those rows as its third argument. The i18n packs gain `detail.collapseToDrawer` in all ten languages. In zh, the `⤢` label (`detail.openAsFullPage` and `console.objectView.expandToPage`, kept byte-identical) reads 整页打开.
