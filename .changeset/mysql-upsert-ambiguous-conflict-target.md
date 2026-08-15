---
"@objectstack/driver-sql": minor
---

fix(driver-sql): refuse a MySQL upsert whose named conflict target another UNIQUE key can absorb (#8755)

`ON DUPLICATE KEY UPDATE` — the only merge statement MySQL compiles — carries no
conflict target, so the merge lands on whichever UNIQUE key the row collides with
first. `#8621` closed the half where nothing backed the named target; this closes
the half where the target IS backed and a *second* UNIQUE key absorbs the
conflict instead.

Measured on live MySQL 8.0.46, `email` and `tax_id` both `unique: true`, the
caller naming `email`: the second upsert merged on `tax_id`, across two different
values of the named key, leaving one row and no error. The identical call on
SQLite and PostgreSQL raises `UNIQUE constraint failed: …tax_id` and leaves the
seeded row untouched.

**Accept-set change, MySQL only.** An `upsert(object, data, conflictKeys)` naming
a non-primary target on a table that carries any other UNIQUE key is now refused
before the statement is compiled — `code: 'VALIDATION_ERROR'`, `status: 400`,
nothing written and no auto-number reserved. The message names the colliding
index and both workarounds: drop or rename the extra UNIQUE key, or run the
object on a dialect that honours the target.

Deliberately unchanged: a table whose only UNIQUE key IS the conflict target (the
common shape) merges exactly as before, as do the `conflictKeys`-less default and
an explicitly named primary key. The MySQL dialect limit and that residue are
documented under *Database Drivers → MySQL*.
