---
'@objectstack/cli': patch
---

feat(cli): `os migrate blank-multi-values` rewrites the `[]` and `''` still stored on optional multi-value columns to `null`

Clause-②: no
Metadata-protocol: none

Since #29343 the write door stores a cleared optional multi-value value (`[]` or `''` on a `multiselect`, `checkboxes` or `tags` column, or on a `multiple: true` `select`, `radio`, `lookup`, `user`, `file` or `image` column) as `null` (ruling A on #29343). Rows cleared before that still hold the JSON text `'[]'` or `'""'`, so `= null`, grouping and the read shape split them from rows cleared since. This new command is the one-time clean that ruling's execution step 3 binds, an `os migrate` data step of its own beside `blank-single-values`, not part of `os migrate value-shapes`, which rewrites nothing.

- **Columns.** Read from `blankAsNullColumns` in `@objectstack/core`, the rule the write door and the seed replay read: its optional columns on the `$empty` table's `multi_value` row. A `required` column, a `readonly` column (a platform-stamped `[]`, such as `sys_activity.changed_fields`) and a single-value column are never touched, nor is a non-empty list.
- **Dry run by default.** It counts the stored `[]` and `''` per object and column and writes no row. `--apply` rewrites each affected row's blank columns to `null` through the engine. `--object` narrows the walk and refuses a name the deployment does not declare. `--apply` refuses a SQLite file another process holds unless `--force`.
- **No flag.** Nothing is gated on it. A re-run that reports zero is the verification.
