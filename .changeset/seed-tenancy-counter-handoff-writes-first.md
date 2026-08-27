---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the #8686 tenancy backfill writes the merged autonumber high-water mark before it deletes anything (#12394)

The seed/API tenancy handoff destroyed the counter it was supposed to move. It ran two
independent statements — an `UPDATE` of the organization-scoped `_objectstack_sequences`
row, then an unconditional `DELETE` of the `'__global__'` one — and on a **fresh install**
there is no organization-scoped row yet, because no API create has happened. The `UPDATE`
matched nothing, which is a success on every dialect; the `DELETE` ran regardless; the
counter table was left empty. `SqlDriver.getNextSequenceValue` then re-entered the
`if (!existing)` bootstrap its own docstring reserves for first allocation, re-derived the
counter from `MAX(data)`, and **re-issued a business identifier that had already been
handed out** — measured on 17.1.0: `ACC-000009` on two different records.

The zero-row case is the *normal* first-boot shape, not an edge case: it is precisely the
shape `buildSplitProbeSql`'s `LEFT JOIN` was widened to catch, so the repair fired on
exactly the installs where its merge loop body never executed.

The handoff is now one ordered decision per scope:

1. **write** the merged mark — `INSERT` when the organization-scoped row is absent,
   `UPDATE` when it exists;
2. **read it back** — "the statement did not throw" was never evidence a row was written,
   and an `UPDATE` matching zero rows is exactly the defect above;
3. **then** retire the `'__global__'` row, addressed by its own stored `key_hash`, so a
   retirement can only ever hit the row whose mark was just merged.

A throw at any step leaves the `'__global__'` row in place — which is the state the next
boot's split probe detects and retries — so a failed repair now loses nothing.

Per **scope**, because a `{YYYYMMDD}` / `{field}` / per-parent format runs one counter row
per rendered prefix. The old merge was scope-blind in both directions: it could raise every
scope's counter to one merged value, and it deleted every scope's `'__global__'` row.

The merge rule itself is unchanged and is the 2026-08-15 ruling's: the greater of the two
**counters**, never the data max. That rule is the whole point — a counter is allowed to
sit ahead of its rows (a rolled-back insert burns a number, by design), and that gap is
exactly what the old handoff threw away.

Graded **patch**: a defect repair inside an existing migration. It adds no export to
`@objectstack/metadata-protocol`'s public index — the new SQL builders are module-scoped
for their own unit tests, matching the index's own recorded rule that an export added so a
test can import a value is the shape to catch before it ships.

No change to the allocator. Reaching `if (!existing)` is not evidence of lost state — a new
tenant, a new day and a new `{field}` group each reach it legitimately, and a destroyed
counter leaves no row behind to tell the two apart — so a guard there would fire on the hot
path and still not detect this. The repair belongs where the state was destroyed.
