---
"@objectstack/spec": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-mongodb": patch
---

fix(data): a paged read with no `orderBy` is a partition too — the shape every list view actually sends (#4363)

objectui#3106's server half closed the **sorted** paged read: a non-empty
`orderBy` now carries a unique tie-breaker, so `ORDER BY status LIMIT 50 OFFSET
50` can no longer serve one row twice while never serving another. It stopped
there deliberately. This closes the half it left, which is the more common one.

A list view whose metadata configures no `sort`, on which nobody has clicked a
column header, sends no `$orderby` at all. `SqlDriver` and `MongoDBDriver` then
emitted a bare `LIMIT`/`OFFSET` — and neither backend promises anything about
the order that slices:

- **SQL** leaves the row order of an unordered read to the plan. Small tables
  hand back insertion order in practice, which is exactly why this survives
  testing; a parallel scan, an index scan, or a `VACUUM` need not.
- **MongoDB** returns natural order, which describes where a document currently
  sits in its extent — and moves when the document does.

Every row ties with every other on an empty sort key, so this is the same defect
at full strength rather than a different one: page 2 repeats a row page 1 showed
and drops one nobody sees, with every page full and every row real.

Both drivers now order a paged read by their unique key column when the caller
supplied no sort keys — the same `id` the tie-breaker was already appending, now
standing alone. `driver-memory` again needed no change: it slices its backing
array, and two reads with no write between them see the identical sequence. The
contract asks for a partition, not for id order.

**Unpaged reads are untouched, deliberately.** The rule keys off `limit`/
`offset`, not off `orderBy` being absent. A read with neither hands back the
whole matching set, so no caller can be shown a partial view of it, and sorting
every read in the system would change plan selection to buy nothing. `limit`
alone does count as paged: page one of a walk is routinely `limit=50` with no
offset, and ordering only the later pages would leave the defect fully intact.

`SqlDriver` keeps the existing restriction to objects it created itself
(`initObjects` records them). It matters more here than for the sorted case: on
a federated table (ADR-0015) there is no requested sort for #3821's ladder to
fall back to, so a wrong guess about `id` would turn a reshuffle into a failed
read. Those tables now get a warning — once per object, behavior unchanged —
because the contract states determinism as a MUST, and a MUST that quietly does
not hold is the same invisible failure the rule was written against.

`findOne` is deliberately outside all of this, and the contract now says so.
Engines reach a driver with `limit: 1`, which is shaped exactly like page one of
a walk, but it promises *a* matching record rather than a position in a
sequence — nothing for a second call to be inconsistent with. Reading it as a
page would put `ORDER BY id LIMIT 1` on the hottest read in the system, which is
the classic shape for a planner to abandon the predicate's own index: measured
on Postgres 16 over 2M rows, `WHERE owner_id = ? LIMIT 1` went 0.08 ms → 7.8 ms
and swapped the `owner_id` index for the primary key. `MongoDBDriver.findOne`
has never sorted, so this also puts the two drivers back in step.

The obligation is normative on `IDataDriver.find` and the cases are shared —
`PAGINATION_UNORDERED_CASES` alongside `PAGINATION_CASES` in
`@objectstack/spec/data` — so a future driver is held to both halves by a gate
rather than by remembering.
