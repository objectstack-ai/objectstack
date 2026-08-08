---
'@objectstack/driver-sql': patch
'@objectstack/driver-memory': patch
'@objectstack/driver-mongodb': patch
'@objectstack/driver-turso': patch
'@objectstack/spec': minor
---

drivers: `limit: 0` returns no records, on every driver and every read door

`limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
drivers did not honour it, in three different ways — and the ones that disagreed
returned **more** data than was requested, which on an ADR-0021 RLS read scope is
over-reach rather than a loose filter. Reachable since #6578: the client now puts
`top=0` on the wire, so the answer depended on which driver a deployment configured.

**`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
`{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
as zero records (measured), so presence is sufficient there.

**`driver-mongodb` — the value was forwarded faithfully, to a client that means
something else by it.** `buildFindOptions` already tested presence, so `0` arrived
exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as *no limit*, so
the answer was still the whole collection. Fixed with an explicit short-circuit that
returns the empty result **before the client is consulted** (`[]` from `find`, `null`
from `findOne`, which had the same hole). No round trip is made for a query whose
answer is already known, and no future change in the upstream driver's reading of `0`
can move this behaviour. Deliberately `=== 0`, not `<= 0`.

**`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
goes through, has always compiled `limit` on presence. Two others compiled it on
truthiness:

- `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
  rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
- `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
  where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
  other than the one that would run.

`offset` moved with `limit` at both doors for internal consistency only. That half is
**measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

**`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
for **every** `N`, and only on the remote transport (the local half goes through knex,
which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
statement knex does.

Result sets only ever get **narrower**. A caller who wants every row should omit
`limit` rather than pass `0`.

`@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
**five** drivers answer it, with **no DEBT rows**: future drift goes red at
`check:driver-conformance` rather than being discovered in production.
