---
'@objectstack/cli': patch
---

fix(cli): `os migrate stored-references` reads a database the release has not booted yet, instead of exiting 1 with `INVALID_FILTER`

Clause-②: no
Metadata-protocol: none

The ADR-0150 D10 upgrade report, run before the release's first boot on a database an earlier release wrote, exited 1 with `INVALID_FILTER` on the first D8 table (`sys_user_permission_set`): it filtered on the package column, which that boot adds, and the report's boot is read-only. It now reads such a table as nothing bound yet. Every row names no package, which is the state the boot's backfill starts from, so each row is asked the one resolution rule, and the report lists the rows the backfill will leave null: the same rows it lists once the columns exist. One notice (on stderr under `--json`) names each table and the column it has not got yet. The report adds no column and exits 0, and its `--json` document keeps its shape. The bind works on that database too: it boots as a write, which adds the columns, and writes the one row.

Only a package column the boot measured missing (the held-back schema sync's `add_columns`) is read this way. Any other refused read is still reported, and the command still exits 1.
