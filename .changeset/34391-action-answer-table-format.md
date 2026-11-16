---
'@objectstack/spec': minor
---

feat(spec): an action's answer fields gain a `table` format, so a per-row answer is drawn as rows, not raw JSON

Clause-②: yes (widening) — `format: 'table'` joins the field formats of `resultDialog.fields` and `preflight.fields`, and the field row gains `columns`; the only new refusals fall on the new value and the new key, and every action that parsed before still parses unchanged
Metadata-protocol: added

An action whose server answers a list of rows (adding several people, importing a CSV) can now say how to show it. A field in `resultDialog.fields` (or `preflight.fields`, which shares the row) takes `format: 'table'` with `columns`, one entry per cell: `{ path, label?, format? }`, where `path` is read in one element of the array.

**FROM → TO.** FROM: the answer's list could only be shown as a JSON block (`format: 'json'`). TO: `{ path: 'rows', format: 'table', columns: [{ path: 'email', label: 'Email' }, { path: 'reason', label: 'Reason' }] }` draws one row per element, one cell per column, in `columns` order, with the column `label` (or its `path`) as the header.

Refused at parse, each with a message that names the fix:

- `format: 'table'` without `columns`, or with an empty list. The columns are never guessed from the elements' keys.
- `columns` beside any other `format`, or on a field with no `format` (the dialog-level default is never `table`).
- `table` as a cell `format` (a table does not nest) and as the dialog-level `resultDialog.format` (a default carries no `columns`).

The renderer contract is stated on `resultDialog`. The console's table renderer is still to come: until it lands, a `table` field draws its label alone, and `columns` is marked `[PLANNED — not yet rendered]`.
