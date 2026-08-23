---
"@objectstack/driver-sql": patch
---

**Fix:** on SQLite the builtin `created_at`/`updated_at` audit columns now take the same canonical ISO-8601 `DEFAULT` a declared `Field.datetime` NOW() column in the same table already gets (#11321).

`createAuditTimestampColumn`'s non-MySQL branch was `table.timestamp(name).defaultTo(this.knex.fn.now())`. On SQLite `knex.fn.now()` compiles to an unqualified `CURRENT_TIMESTAMP`, which renders a zone-**naive**, space-separated, second-precision `'YYYY-MM-DD HH:MM:SS'`. A declared `defaultValue: 'NOW()'` field in the **same table** already got `(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` from `nowColumnDefault`, so one table carried two spellings of one conceptual value:

```
created_at  "2026-08-23 14:54:17"          <- builtin audit  (naive)
when        "2026-08-23T14:54:17.796Z"     <- declared field (canonical)
```

That naive spelling is the one `updatedAtStamp()`'s own docblock condemns: `Date.parse` reads a zone-less string as LOCAL time, silently shifting the instant by the host offset on a non-UTC runtime. It is also the pre-canonical storage form `backfillCanonicalDatetimes` exists to converge — reached here by a path writing it *today*, not by legacy data.

The SQLite branch is now routed through `nowColumnDefault('datetime')` — the existing single source for "what does NOW() mean in DDL on this dialect" — rather than restating the expression, so the two cannot drift apart again. **Postgres and MySQL are untouched**: `knex.fn.now()` on Postgres is a real zone-aware `TIMESTAMP` that never had the ambiguity, and MySQL keeps the `now(3)` precision match from #11224.

`rebuildSqliteTablePatched` — the whole-table rebuild SQLite drift reconciliation uses — re-emitted the audit default itself as `knex.fn.now()`. That method is SQLite-only, so leaving it would have silently **reverted** a canonically-created table the moment any unrelated drift (a relaxed NOT NULL, an orphaned column) triggered a rebuild. Fixed in the same change: a rebuild hands back the column `initObjects` would have built.

**Graded `patch`, not `minor`, on a measurement rather than a judgement.** The change alters emitted DDL, so the question that decides the grade is what it does to databases that already exist:

- **Existing tables are not altered.** Both call sites are `CREATE TABLE` only; `initObjects`' `alterTable` branch adds declared fields and never the audit columns. A table already on disk keeps `default CURRENT_TIMESTAMP`.
- **They do not start reporting drift.** Measured on live in-memory SQLite through the real `detectManagedDrift` entry point against a table carrying the old default: **zero** entries. Two independent guards — `BUILTIN_COLUMNS` skips `created_at`/`updated_at` in both of `diffManagedTable`'s loops, and the only `default_mismatch` producer is the #4560 runtime-token check, for which `isAppResolvedDefaultToken('NOW()')` is pinned `false`. The measurement carries a positive control: in the same call on the same table, drift reports `unmapped_column` **and** `default_mismatch` for a `current_user` column, so the default-reading dimension is demonstrably live and still says nothing about the audit columns.
- **Rows already written naive keep reading correctly.** `formatOutput`'s `repairNaiveUtcAuditTimestamp` folds them to canonical on read — the same disposition `nowColumnDefault` already documents for declared fields.

So no deployment changes behaviour on upgrade; only newly-created tables get the corrected default.

The population this actually repairs is wider than "writes that bypass the driver". `stampInsertTimestamps` fills both columns app-side, but it gates on `tablesWithTimestamps`, which only DDL-running paths populate. On the documented `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` posture, `registerObjectMetadata` (the DDL-free registration door) deliberately does not touch that set — so the set is empty, the stamp returns early, and **the driver's own `create()` door reaches the column DEFAULT**. Measured, one table, one row per boot posture: `created_at "2026-08-23T14:54:17.791Z"` on a normal boot versus `"2026-08-23 14:54:17"` on a `skipSchemaSync` boot, with the declared NOW() sibling canonical in both — because its canonical shape lives in the column DEFAULT rather than in an app-side stamp. That asymmetry is the argument for fixing this in DDL, and it is now closed.
