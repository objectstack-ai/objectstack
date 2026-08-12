---
"@objectstack/driver-memory": patch
---

fix(driver-memory): the analytics echo renders the query it describes (#7117)

`MemoryAnalyticsService` has two exits for one normalized filter tree, and they
disagreed about what the LIKE family MEANS. `query()` builds a real containment
pattern; `generateSql()` emitted the comparand as a bare literal with no
wildcard anywhere, so `{name: {$contains: 'acme'}}` echoed

```sql
WHERE name LIKE 'acme'
```

— an **equality** — beside a chart drawn from every row *containing* `acme`.
The echo's only job is reproducing execution, so an author who ran it to debug
the chart got a **narrower** row set and read the filter as broken.
`$notContains` mirrored it through `NOT LIKE`.

**What the echo emits now.** The `$contains` family renders `GLOB '*v*'` /
`NOT GLOB`, and `$icontains` renders `lower(col) GLOB lower('*v*')`. `GLOB`
rather than `LIKE` because this exit emits SQLite-shaped SQL and SQLite's `LIKE`
folds ASCII case unconditionally: #4706 Q2 = A rules the `$contains` family
case-**sensitive**, and #7723 put this package's execution faces on that answer,
so a `LIKE` echo would have contradicted execution on a second axis the moment
the missing wildcards were added. The two halves are one fix because `GLOB`
speaks a different pattern language from `LIKE` — choosing the construct and
rendering the wildcards are the same decision. The translation is the spec's
shared `likePatternToGlobPattern`, and the comparand is escaped first, so an
author's own `%` / `_` / `*` / `?` / `[` stay literal instead of becoming the
match-every-row bypass (#5567).

**The `|| '='` fallback is gone with it.** `operatorToSql` was a
name→name map, which cannot hold a wildcard, a list, or a null-safe negation;
it is now a builder table keyed by `CubeOperator`, the shape #5374 gave the
mingo exit, so a widened vocabulary fails to compile until its SQL spelling
exists. Three operators were reaching that fallback and are fixed with it —
measured against `query()` on a six-row fixture:

| `where` | `query()` | echoed, before | echoed, now |
|---|---|---|---|
| `{name: {$in: [a, b]}}` | both rows | `name = a` — one row | `name IN (a, b)` |
| `{name: {$nin: [a]}}` | the other five | `name = a` — the **complement** | `(name IS NULL OR name NOT IN (a))` |
| `{name: {$exists: true}}` | five rows | `name = 1` — **no** rows | `name IS NOT NULL` |

Three smaller divergences on the same builder went with them: negations are
null-safe (`$ne` / `$nin` / `$notContains` kept only rows whose column was not
NULL, where the pipeline returns them — the #5146 / #5297 rule the rest of the
repo already follows); an empty `$in` / `$nin` list now renders a predicate
instead of no `WHERE` at all (an empty `$in` echoed the whole table while the
pipeline returns nothing); and a bare-day `$lte` bound renders half-open, as the
pipeline has read it since #4042.

`$startsWith` and `$endsWith` never reached the fallback and are unchanged: this
face does not lower them, so both exits refuse them with `INVALID_FILTER` / 400
(#5345).

Only the *displayed* SQL changes — this exit produces the statement shown for
transparency, never the query that runs, and `query()`'s rows are untouched.
