---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
'@objectstack/spec': minor
---

drivers: `limit: 0` means no records on every read door, and an offset can stand alone

`limit: 0` was ruled in #6485 to mean **return no records**. `SqlDriver.findRows()` —
the door `find()` goes through — has always compiled `limit` on **presence**
(`query.limit !== undefined`), which is what that ruling depends on. Two other doors
in the same driver compiled it on **truthiness** (`if (query.limit)`), and `0` is
falsy, so the clause was dropped and the read that asked for nothing was answered
with everything:

- **`findWithWindowFunctions()`** — the live window-function read door (#4286). It
  returns rows, so this was user-visible wrong data: measured on `main`, three rows
  seeded, `{ limit: 0 }` returned **3 of 3** where `find()` returned 0. Result sets
  only ever get **narrower** here; a caller who wants every row should omit `limit`
  rather than pass `0`.
- **`analyzeQuery()` / `explain()`** — returns a plan. It compiled
  `select * from "orders"` where `find()` sent `... order by "id" asc limit ?`, so it
  explained a statement other than the one that would run — the one thing an EXPLAIN
  must not do.

`offset` moved with `limit` at both doors for internal consistency only. That half is
**measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
and MySQL alike, so no statement and no row set moves. It is pinned as the no-op it
is rather than reported as a fix.

**`driver-turso` remote transport: an `OFFSET` with no `LIMIT` was a syntax error.**
Surfaced by the new conformance control that reads with a bare offset. SQLite's
grammar is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses
independently, so `find(obj, { offset: N })` with no `limit` produced
`near "OFFSET": syntax error` — for **every** `N`, not a boundary value, and only on
the remote transport (the local half goes through knex, which synthesises the
`LIMIT -1` no-limit sentinel). Remote now builds the same statement knex does, so the
two transports answer a bare offset the same way instead of one working and one
throwing.

`@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
case-set that pins this across drivers — with controls, so "return nothing, always"
cannot pass it. Additive: no existing export moved. The SQL family (`driver-sql`,
`driver-sqlite-wasm`, `driver-turso` on both transports) answers it. `driver-memory`
and `driver-mongodb` carry DEBT rows in `check:driver-conformance`: both are
#5499-frozen and they diverge for two *different* reasons — memory drops the slice on
truthiness (measured: `{ limit: 0 }` returns the whole table), while mongodb forwards
`0` faithfully to a client that defines it as *no limit*. Both are recorded on their
rows as objectstack#6577's frozen half.
