---
'@objectstack/plugin-security': patch
---

perf(plugin-security): claim seed ownership with one predicate write per unowned shape (#14530)

`claimSeedOwnership` — the pass that hands seeded business records to the first
platform admin — scanned every `owner_id`-declaring object twice at
`limit: 10_000` and then issued **one single-id `update` per matched id**: up to
20 000 full engine writes for one object, each paying the whole middleware,
validation and hook chain. It now issues **one predicate write per unowned
shape** instead: `owner_id IS NULL`, then `owner_id = usr_system`. Two writes
per object, whatever the row count. The scans are gone with the loop — the
predicates they resolved are the predicates the writes now carry, so the matched
set is unchanged row for row, and the count reported per object is the
affected-row count the write itself resolves.

Measured on a real ObjectQL engine (in-memory driver, one sharing-rule-covered
object, shared box): 2 000 rows 2 122 ms → 171 ms; 5 000 rows 10 658 ms → 448 ms,
with engine `update` calls falling from N to 2.

The second half is what the batch buys downstream. plugin-sharing's `rule-hooks`
already routes a write whose row set exceeds `RULE_RECOMPUTE_ROW_CAP` (1 000)
into one set-based revoke plus one queued `evaluateAllRulesForObject`, but that
branch reads **one write's** row set, and every write in the old loop
legitimately carried a single row — so the batch existed only in the caller,
where nothing downstream could see it. Batching here is what lets machinery
already built for this shape do its job; `plugin-sharing` is unchanged.

**One behaviour change, at the edge.** A predicate write carries no `limit`, so
nothing truncates at 10 000 any more; what bounds it now is the engine's own
per-row hook ceiling (`MAX_BULK_PER_ROW_HOOK_ROWS`, 10 000), which refuses a
predicate write whole rather than firing per-row hooks past it. The reachable
population per predicate per run is therefore the same 10 000 the scan limit
allowed. What changed is the boundary behaviour: an object with more than 10 000
rows under one predicate used to have its first 10 000 claimed **silently**,
leaving a half-claimed table nothing re-runs automatically; it now claims none
of them and logs the engine's refusal, which names the count, the ceiling and
both routes out. Loud and recoverable in place of silent and undetectable.

`patch`: no declared surface moves, no export changes, and the only observable
delta at the boundary is a failure mode becoming loud.
