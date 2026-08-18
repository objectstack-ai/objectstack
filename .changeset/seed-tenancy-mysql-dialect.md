---
"@objectstack/metadata-protocol": minor
"@objectstack/runtime": patch
---

fix(metadata-protocol): compile the seed-tenancy backfill's statements for the connected dialect, so they run on MySQL (#9381)

`seed-tenancy-backfill.ts` quoted every identifier the ANSI way (`"x"`) on every
dialect. MySQL does not run with `ANSI_QUOTES` — measured on a live MySQL 8.0.46,
whose `sql_mode` is
`ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`,
and nothing in `driver-sql` sets one — so `"x"` is a string literal there and all
seven statements failed with `ER_PARSE_ERROR`. The repair for #8686 therefore
never ran on MySQL, silently: a migration must not fail a boot, so every call site
turns the failure into a warning and the symptom was a skipped repair in the log
rather than an error.

The statements are now compiled for the driver actually connected, and the seam
carries the dialect with it (`resolveSeedTenancySeam` returns `{ exec, client }`;
`backfillSeedTenancy` takes that pair) so a caller cannot lose it. Two further
MySQL-only defects in the same statements, both measured on the same server, are
fixed with it: `last_value` is a reserved word on MySQL 8.0 and is now quoted
wherever it is unqualified, and the stamp's exclusion sub-SELECTs go through a
derived table because MySQL refuses `UPDATE t … (SELECT … FROM t)` with
`ER_UPDATE_TABLE_USED`. SQLite and PostgreSQL keep the exact ANSI spelling they
had (both re-verified live).

`resolveSeedTenancyExec` stays exported and unchanged for callers that resolve the
dialect themselves; `backfillSeedTenancy` now takes the seam object instead of a
bare exec.
