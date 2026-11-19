---
'@objectstack/skills': patch
---

docs(skills): `objectstack-ui` teaches an action's `resultDialog`, its `table` format included

Clause-②: no
Metadata-protocol: none

`rules/actions.md` gains a `resultDialog` entry beside `preflight`: the keys of the one-shot dialog, the `fields` row, the six formats, and `format: 'table'` with its required `columns` (one row per element of the array, one cell per column). It states that a `text` or `code-list` cell has no copy control while a `secret` or `qrcode` cell keeps its own. One eval case asks for a list of rejected rows.
