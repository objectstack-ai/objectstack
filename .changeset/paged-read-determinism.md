---
"@objectstack/spec": patch
"@objectstack/driver-sql": patch
"@objectstack/driver-mongodb": patch
---

fix(data): paging a sorted read is a partition of the result set, not five queries that share a WHERE clause (objectui#3106)

`ORDER BY status LIMIT 50 OFFSET 50` names a sort key that does not identify a
row, and no backend promises that rows with equal keys keep the same relative
arrangement between two queries. MongoDB documents this outright — `sort` +
`skip`/`limit` on a non-unique key "may return the same document more than
once". So page 2 could repeat a row page 1 already showed and skip one nobody
ever saw:

```
page 1: ORDER BY status LIMIT 5 OFFSET 0   -> [r05 r07 r11 r04 …]
page 2: ORDER BY status LIMIT 5 OFFSET 5   -> [r04 …]        r04 again; one row never served
```

Every page is full, every row is real and belongs, and the duplicate sits
several screens from the omission — which is why this is found by a user
counting records, never by reading a response.

`SqlDriver` and `MongoDBDriver` now append a unique tie-breaker to any non-empty
`orderBy`, in the last requested key's direction (determinism holds either way,
but a same-direction suffix is the one an index can still walk in one pass).
`driver-memory` already conformed — `Array#sort` is stable over a table whose
order does not move — and now has a suite saying so, because that property is
implicit and easy to lose in a refactor that looks like a speed-up.

`SqlDriver` adds it only for objects it created itself (`initObjects` records
those). A federated table (ADR-0015) may have no `id` column, and guessing there
would be worse than doing nothing: the unknown-column error is answered by
#3821's ladder retrying with **no ORDER BY at all**, trading a reshuffle among
ties for the loss of the caller's whole sort.

The obligation is now normative on `IDataDriver.find`, with shared cases in
`@objectstack/spec/data` (`PAGINATION_CASES`) that all three drivers run — so a
future driver is held to it by a gate rather than by remembering.

Not covered by this change: a paged read with **no** `orderBy`. Same defect,
wider blast radius, so it was carved out to #4363 rather than folded in — and
closed there, in the same release. The contract, the shared cases and both
drivers now cover a paged read whatever its `orderBy`, including none at all.
