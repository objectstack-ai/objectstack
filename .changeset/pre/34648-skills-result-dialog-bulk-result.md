---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ui` teaches an action's `resultDialog` (its `table` format included) and the aggregate bulk handler's `BulkActionResult`

Clause-②: no
Metadata-protocol: none

`rules/actions.md` gains a `resultDialog` entry beside `preflight`: the keys of the one-shot dialog, the `fields` row, the six formats, and `format: 'table'` with its required `columns` (one row per element of the array, one cell per column). It states that a `text` or `code-list` cell has no copy control while a `secret` or `qrcode` cell keeps its own. A second entry says how an `execution: 'aggregate'` bulk handler's return value is read: one with a top-level `succeeded` or `failed` member is read as a `BulkActionResult`, and any other form of those members is reported as unreadable. One eval case for `resultDialog`.
