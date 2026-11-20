---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ui` teaches an action's `resultDialog` (its `table` format included) and the aggregate bulk handler's `BulkActionResult`

Clause-②: no
Metadata-protocol: none

`rules/actions.md` gains a `resultDialog` entry beside `preflight`: the keys of the one-shot dialog, the `fields` row, the six formats, and `format: 'table'` with its required `columns` (one row per element of the array, one cell per column). It states that a `text` or `code-list` cell has no copy control while a `secret` or `qrcode` cell keeps its own. A second entry teaches what an `execution: 'aggregate'` bulk handler resolves with when it wrote some rows and refused others, `{ succeeded: string[], failed: [{ id, message }] }`, that it resolves and does not throw, and how the console counts the ids. One eval case for each.
