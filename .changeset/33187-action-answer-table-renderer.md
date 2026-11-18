---
'@object-ui/app-shell': patch
'@object-ui/core': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(app-shell): the action result dialog draws a `table` answer field as rows, and Import Users shows its result per row in one

Clause-②: yes (widening) — the console now draws `format: 'table'` fields (declared since the spec half) instead of their label alone, and `sys_user.import_sso_users` draws its per-row report as a table instead of JSON; no input is refused that was accepted before
Metadata-protocol: none

The console's action result dialog, and the param dialog's preflight panel that shares its field renderer, draw a field with `format: 'table'` as a table: one row per element of the array, one cell per entry of the field's `columns`, in order, under the column's `label` (or its `path`). A cell reads its `path` in the element; a missing key or a `null` draws an empty cell, a value that fits the column's `format` draws in it, and anything else draws as one line of JSON. An element that is not a plain object draws as JSON in its row's first cell. An empty array draws the header over a "No rows to display" line. The dialog widens when it draws a table.

A `code-list` field now draws as a code list only when its value is an array of strings, as the renderer contract says; any other array draws as JSON.

`@objectstack/platform-objects`: on a cloud-managed environment, the Import Users result shows one row per CSV line, with the email, whether it succeeded, whether the address was already pending, whether the hosting organization was told and why not, why a row was not added, the columns that were not applied, and a manager that was not linked. The summary counts stay above it.

`@objectstack/spec`: `columns` is no longer marked `[PLANNED — not yet rendered]`, and the renderer contract now says that a `null` cell value draws an empty cell and that only a plain object is read by column paths (an array or `null` element draws as JSON). It also says that inside a table cell `text` and `code-list` draw the value alone with no copy control, while `secret` keeps its mask, reveal and copy and `qrcode` keeps its code and copy. Its liveness rows are `live`.

`@object-ui/core`: `ResultDialogFieldSpec` gains `columns`, derived from the contract's answer-field row like its `label` and `format`, so the console's table renderer reads it off the runner's own type.
