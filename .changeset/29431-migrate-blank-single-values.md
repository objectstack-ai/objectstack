---
'@objectstack/cli': patch
---

feat(cli): `os migrate blank-single-values` rewrites the `''` still stored on optional single-value option, reference and file columns to `null`

Clause-②: no
Metadata-protocol: none

Since #29277 the write door stores a cleared optional `select`, `radio`, `lookup`, `master_detail`, `user`, `tree`, `image`, `file`, `avatar`, `video` or `audio` value as `null` (maintainer ruling B on #29346). Rows cleared before that still hold `''`, which `$empty: true` does not find on those types. This new command is the one-time clean that ruling binds, as an `os migrate` data step of its own (server seat ruling on #29431, record 6588116815), not part of `os migrate value-shapes`, which rewrites nothing.

- **Columns.** Read from `blankAsNullColumns` in `@objectstack/core`, the rule the write door and the seed replay read: its optional single-value columns on the `$empty` table's `null_only` row. A `required` column, a `multiple: true` column and a text-like column are never touched.
- **Dry run by default.** It counts the stored `''` per object and column and writes no row. `--apply` rewrites each affected row's `''` columns to `null` through the engine. `--object` narrows the walk and refuses a name the deployment does not declare. `--apply` refuses a SQLite file another process holds unless `--force`.
- **No flag.** Nothing is gated on it. A re-run that reports zero is the verification.
