---
'@objectstack/plugin-security': patch
---

perf(plugin-security): claim seed ownership with a predicate write per object, paged only when the engine refuses it (#14530)

`claimSeedOwnership` — the pass that hands seeded business records to the first
platform admin — scanned every `owner_id`-declaring object twice at
`limit: 10_000` and then issued **one single-id `update` per matched id**: up to
20 000 full engine writes for one object, each paying the whole middleware,
validation and hook chain. The unit of work is now the **set**, not the row: one
predicate write per unowned shape (`owner_id IS NULL`, then
`owner_id = usr_system`), so the matched set is the same set the old two-scan
rule resolved — row for row — while the write count stops scaling with N. The
count reported per object is the sum of the affected-row counts those writes
resolve, never a length this pass counted for itself.

Measured on a real ObjectQL engine (in-memory driver, one sharing-rule-covered
object, shared box): 2 000 rows 2 122 ms to 208 ms; 5 000 rows 10 658 ms to
528 ms, with engine `update` calls falling from N to two per object.

The second half is what the batch buys downstream. plugin-sharing's `rule-hooks`
already routes a write whose row set exceeds `RULE_RECOMPUTE_ROW_CAP` (1 000)
into one set-based revoke plus one queued `evaluateAllRulesForObject`, but that
branch reads **one write's** row set, and every write in the old loop
legitimately carried a single row — so the batch existed only in the caller,
where nothing downstream could see it. Batching here is what lets machinery
already built for this shape do its job; `plugin-sharing` is unchanged.

**And a paged fallback, because one write cannot always carry the set.** A
predicate write carries no `limit`, so the bound becomes the engine's own
`MAX_BULK_PER_ROW_HOOK_ROWS` (10 000): `beforeUpdate` / `afterUpdate` hooks are
contracted to fire per matched row on a predicate write (ADR-0058 D6), and every
object carries such hooks in practice, so the engine refuses an over-sized write
**whole** — nothing written. Measured: 21 000 unowned rows re-owned **nothing**,
where the old loop re-owned 10 000 of them. This pass decides `owner_id`, a
record-access field, so an unclaimed object is a permission outcome and not an
observability detail. The refusal is now answered by taking one page of ids off
the top (half the ceiling) and re-attempting the whole set, until one write can
carry what is left. Re-measured after paging: the same 21 000-row object claims
**all 21 000**, in 8 engine writes and 3 reads.

The order is not cosmetic. Paging unconditionally measured 13x slower on the
sizes every real install has — an `id IN (…)` page is a linear scan of the id
list per row in `InMemoryDriver`, so an always-paged claim is quadratic there
where the natural predicate is linear (5 000 rows: 528 ms whole-set versus
5 865 ms always-paged). The page is what the engine's refusal buys, not the
default.

`patch`: no declared surface moves, no export changes, and the reachable
population strictly grows.
