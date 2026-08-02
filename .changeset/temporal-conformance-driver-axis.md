---
---

Test-only: run the ADR-0053 D-A3 temporal conformance matrix across the DRIVER
axis the ADR declares — `driver {SQLite, Postgres at minimum}` — instead of four
hard-coded `better-sqlite3` drivers (#4245). All four sweeps (canonical
datetime, relative tokens, `Field.time`, legacy storage) now run once per cell
of `DIALECT_CELLS`: SQLite always, live Postgres and MySQL whenever
`OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL` are provisioned, over the same
`TEMPORAL_CASES` / `TEMPORAL_TIME_CASES` and asserting the same row-id sets cell
for cell. Adds the D-B3 server-timezone axis as an executed guard (server ≠ UTC
≠ process, and server ≠ process) so a cell cannot pass vacuously, and
`OS_EXPECT_LIVE_DIALECT_MATRIX=1` in the `Temporal Conformance (live PG +
MySQL)` CI job so a lost `OS_TEST_*_URL` is a red rather than a silent return to
SQLite-only coverage. Releases nothing.
