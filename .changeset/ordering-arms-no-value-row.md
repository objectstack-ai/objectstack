---
"@objectstack/driver-memory": patch
---

fix(driver-memory): a row with no value is not inside `$gt` / `$gte` / `$lt` / `$lte` (#13553)

The reference matcher (`memory-matcher.ts`) compared a stored `null` instead of first
deciding whether the comparison meant anything, so on a **numeric** column a no-value row
landed inside a bound: JS coerces `null` to `0`, which makes `null >= -1` a true comparison
between two numbers. Measured on `{id:'1',n:5} {id:'2',n:0} {id:'3',n:null} {id:'4'}`, the
matcher answered `['1','2','3']` for `{n: {$gte: -1}}` and `['2','3']` for `{n: {$lte: 1}}`
where this package's live mingo path answered `['1','2']` and `['2']` — so row 3 was both
greater than `-1` and less than `1` at the same time.

The four arms now answer EXCLUDE for a no-value row, which is what the live path already
answered and what the platform's settled reading gives: only the negation-carrying operators
(`$ne` / `$nin` / `$notContains`) admit a no-value row (#5298 option A, re-affirmed
2026-08-10). Both readings of "no value" reach that one answer — a stored `null` and an
absent key — where before only the absent key was excluded, by a guard that never saw the
other reading.

A **string** column is unaffected and was the reason three earlier cards passed over this:
`null >= '2026-07-01'` compares `0` against `NaN` and is false, so the same four arms looked
correct on every ISO-date fixture #13494, #13495 and #13549 used.

Two things deliberately do NOT move. `$between` keeps deciding the no-value case in
`valueWithinRange`, whose answer is the opposite one (a range with both ends absent selects
the no-value rows, #13495). And a no-value **comparand** in an ordering position
(`{$gte: null}`) keeps today's answer exactly: it is the one null-comparand position the
filter contract still accepts — the 2026-08-31 ruling refused the three siblings
(`$in` / `$nin` null members, `$between` null endpoints, #13357) and #5332's landing had
already recorded this one in writing as a position no ruling covers.

⭐ What this closes beyond the four cells: this package's live path compiles `$between` INTO
`$gte` + `$lte`, so `{n: {$between: [-1,1]}}` and `{n: {$gte: -1, $lte: 1}}` are one predicate
to it. After #13549 landed, this face answered them differently on the same row. It no longer
does.
