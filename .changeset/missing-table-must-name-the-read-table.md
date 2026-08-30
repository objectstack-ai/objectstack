---
"@objectstack/metadata": minor
"@objectstack/objectql": patch
"@objectstack/metadata-protocol": patch
---

fix(metadata,objectql,metadata-protocol): require a missing-table error to name the table that was READ (#13324)

`isMissingTableError` answers the one question that licenses a fail-soft caller
to treat an empty result as the truth: "did this read fail because the table has
not been provisioned yet?". It matched the *shape* of the dialect phrase and
never asked WHICH table the phrase names.

Measured on a real libsql database: a view whose base table is gone fails with
`no such table: main.<base>` when the view itself is read. The phrase matches,
so a read of a relation that **exists and may be backed by rows** was classified
benign, and every fail-soft consumer on that path — `probeInstallOrganizations`,
`resolveFileReferences`, `seedAutonumber`, the cascade-delete dependents probe,
`DatabaseLoader`, `SeedLoaderService`, the `sys_metadata` overlay reads —
computed its answer from data it never read. That is a false "benign", the
direction the module's own docblock calls far more expensive than a false
"real".

The predicate now takes the object the caller was reading and refuses the
benign verdict when the phrase names a different relation. Shape alone cannot
separate the two cases: measured, a view over a missing base table and a
genuine missing table the caller qualified produce byte-identical messages, so
the read's name is a parameter rather than another regex.

The parameter is **optional** — omitting it reproduces the previous behaviour
exactly, so no external caller of `@objectstack/metadata/errors` changes. Every
in-repo call site now passes it. The comparison folds away schema/database
qualifiers, the legacy `namespace__short` prefix and case, so every shape
recognised before for a genuine missing table (sqlite `no such table: X`,
Postgres `relation "x" does not exist`, MySQL `table "x" doesn't exist`,
`unknown table`, the SQLSTATE and errno limbs) still answers benign.
