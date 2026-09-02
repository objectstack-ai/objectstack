---
'@objectstack/plugin-security': patch
---

perf(plugin-security): claim seed ownership with paged predicate writes (#14530)

`claimSeedOwnership` — the pass that hands seeded business records to the first
platform admin — scanned every `owner_id`-declaring object twice at
`limit: 10_000` and then issued **one single-id `update` per matched id**: up to
20 000 full engine writes for one object, each paying the whole middleware,
validation and hook chain. The unit of work is now a **page**, not a row: read
at most 5 000 unowned ids, re-own them with one predicate write, repeat until
the predicate is exhausted — for each of the two unowned shapes (`owner_id IS
NULL`, then `owner_id = usr_system`). The matched set is unchanged row for row,
and the count reported per object is the sum of the affected-row counts the page
writes resolve rather than a length this pass counted for itself.

Measured on a real ObjectQL engine (in-memory driver, one sharing-rule-covered
object, shared box): 2 000 rows 2 122 ms → 208 ms; 5 000 rows 10 658 ms → 528 ms,
with engine `update` calls falling from N to one per page.

The second half is what the batch buys downstream. plugin-sharing's `rule-hooks`
already routes a write whose row set exceeds `RULE_RECOMPUTE_ROW_CAP` (1 000)
into one set-based revoke plus one queued `evaluateAllRulesForObject`, but that
branch reads **one write's** row set, and every write in the old loop
legitimately carried a single row — so the batch existed only in the caller,
where nothing downstream could see it. Batching here is what lets machinery
already built for this shape do its job; `plugin-sharing` is unchanged, and the
page size is deliberately far above that cap so a full page is still seen as a
batch.

**Why paged rather than one write per object.** A predicate write carries no
`limit`, so "one write per object" is the obvious shape — and the engine refuses
it whole above `MAX_BULK_PER_ROW_HOOK_ROWS` (10 000), because `beforeUpdate` /
`afterUpdate` hooks are contracted to fire per matched row on a predicate write
(ADR-0058 D6) and every object carries such hooks in practice. Measured: 21 000
unowned rows re-owned **nothing**, where the old loop re-owned 10 000 of them.
This pass decides `owner_id`, a record-access field, so an unclaimed object is a
permission outcome and not an observability detail. Paging keeps the batch and
the coverage: the same 21 000-row case now claims every one of them, and the
page size is derived from that ceiling rather than chosen, so it moves with it.

`patch`: no declared surface moves, no export changes, and the reachable
population strictly grows.
