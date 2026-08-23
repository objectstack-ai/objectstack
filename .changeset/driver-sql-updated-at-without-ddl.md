---
"@objectstack/driver-sql": patch
---

fix(driver-sql): `updated_at` is stamped on a deployment that never runs the driver's DDL (#11067)

`SqlDriver.update()` refreshed `updated_at` only for tables in
`tablesWithTimestamps`, and every one of that set's **four** fill sites is
downstream of DDL: `initObjects`' `createTable` branch, its "the existing table
already has an `updated_at` column" branch (decided from a physical
`columnInfo()`), its rotation branch, and `aliasShardBookkeeping`'s
rotation-shard copy. (The card reported three; the rotation branch inside
`initObjects` is the fourth.)

So a deployment that manages DDL out-of-band — `skipSchemaSync` /
`OS_SKIP_SCHEMA_SYNC=1`, documented in
`content/docs/deployment/environment-variables.mdx` as "skip the implicit
`db:sync` on boot; use after running migrations manually" — booted with that set
empty and never stamped. The column carries only an INSERT-time `DEFAULT now()`,
with no `ON UPDATE` clause or trigger on any dialect, so `updated_at` recorded
the row's **creation** time forever. Nothing errored: list-view sorts, delta and
incremental sync, cache invalidation and audit answers were simply wrong.
Measured before the fix on SQLite, live Postgres 16.13 and live MySQL 8.0.46 —
a row backdated to `2020-01-01T00:00:00Z` and then updated through the driver
came back still reading `2020-01-01T00:00:00Z` on all three.

The fix is a pair, and the second half is what keeps it a bug fix rather than a
contract change.

1. **Inferred from the declared shape, at registration time.**
   `registerObjectMetadata()` — the DDL-free entry point a `skipSchemaSync` boot
   already calls — now records that a managed object's table is *expected* to
   carry `updated_at`, because every table this driver's own DDL creates gets
   `created_at`/`updated_at` unconditionally. That costs **zero round trips**,
   which is the currency `skipSchemaSync` exists to save. It is kept in a new
   `updatedAtColumnState` map rather than in `tablesWithTimestamps`, because it
   is an inference and that set means "observed".

2. **A lazy, one-shot fallback for the table where the inference is wrong.** On
   a hand-migrated table that genuinely lacks the column, (1) alone would turn an
   `update()` that succeeds today into a loud failure — a *new rejection for a
   call that works*. Instead, the first stamped UPDATE to such a table is
   speculative: if it fails, the driver asks the database (`columnInfo()`)
   whether `updated_at` is really absent, and only then re-issues the caller's
   own statement without the stamp, logging a warning naming the divergence. Any
   other failure rethrows the **original** error untouched. Deliberately not
   keyed to the dialect's error text: the three dialects spell it three ways
   (`42703`, `ER_BAD_FIELD_ERROR`, `no such column`), and those strings are
   version-dependent.

Steady state is free in both directions. A successful stamped UPDATE proves the
column exists — a column named in a `SET` list that is not there is a parse/plan
error on every dialect here, whatever the row count — so one success settles the
table permanently; a resolved absence is cached and never re-probed. Tables the
driver's DDL built were already in `tablesWithTimestamps` and never enter the
speculative state at all, so the DDL path is byte-for-byte unchanged.

When the caller has a transaction open, the speculative write is fenced in a
knex nested transaction (a `SAVEPOINT`) via the existing
`attemptWithoutPoisoning` — on Postgres any statement error aborts the whole
transaction (`25P02`), so an unfenced `try/catch` whose recovery issues SQL on
that transaction could never run there (#8269).

Two narrowings, both deliberate:

- **The insert path is untouched.** `stampInsertTimestamps` writes `created_at`
  as well, and none of the evidence above says anything about `created_at`, so
  it keeps reading `tablesWithTimestamps` exactly as before.
- **Federated/external objects are untouched.** `registerExternalObject` does
  not route through managed registration, so a remote table is never presumed to
  carry audit columns.

Pinned by `sql-driver-timestamps-without-ddl.test.ts`, which runs the card's
repro sketch plus the missing-column leg, the round-trip budget, the
caller-transaction leg and an unrelated-failure leg across SQLite **and** live
Postgres / MySQL through `declareDialectCell`, so an unprovisioned dialect is
reported rather than omitted.
