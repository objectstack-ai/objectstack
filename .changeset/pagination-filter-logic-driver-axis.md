---
---

Test-only: run the two remaining `@objectstack/spec/data` shared matrices
`driver-sql` consumes — `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` and
`FILTER_LOGIC_CASES` — across the ADR-0053 D-A3 DRIVER axis (`driver {SQLite,
Postgres at minimum}`) instead of a hard-coded `better-sqlite3` client (#4714,
finishing what #4245 started for the temporal matrix). Both files now sweep once
per cell of `DIALECT_CELLS` — SQLite always, live Postgres and MySQL whenever
`OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are provisioned — over the same
cases, asserting the same row-id sets cell for cell, with issue-prefixed table
names so parallel suites cannot collide on a live server. The paged-read
property test is the one that gains: on SQLite it passes with or without the
tie-breaker (a twelve-row table hands ties back in rowid order every time),
while on live Postgres removing the tie-breaker makes it serve one row twice and
another never — objectui#3106 verbatim. `declareUnprovisionedCell` moves into
`live-dialect-matrix.testkit.ts` so all three matrices share one non-vacuity
guard: a missing URL is a named skip, and a red under
`OS_EXPECT_LIVE_DIALECT_MATRIX=1`. No new CI job — the existing
`Temporal Conformance (live PG + MySQL)` workflow already runs this whole
package against both servers. Releases nothing.
