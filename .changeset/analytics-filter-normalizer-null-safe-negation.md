---
'@objectstack/service-analytics': patch
'@objectstack/spec': patch
---

analytics: `$ne` / `$nin` / `$notContains` in a dashboard `where` keep the rows that have no value

Second batch of the #5298 ruling, after PR #5962 landed it on `driver-sql`,
`read-scope-sql` and `formula`. An analytics filter meaning "not this" now
returns the rows whose column is empty, the same answer every other backend
gives — a `stage != 'won'` widget shows the deals with no stage set.

The Cube face was the last surface still splitting on it, and it split three
ways for one filter. Measured on the package's own fixture before the change,
for `{stage: {$ne: 'won'}}` with rows 3-4 carrying a NULL `stage`:

| compiler | was | now |
|---|---|---|
| `NativeSQLStrategy` raw SQL | `2` | `2,3,4` |
| `ObjectQLStrategy` display-SQL echo | `2` | `2,3,4` |
| `ObjectQLStrategy` engine condition | `2,3,4` | `2,3,4` |

The engine column was already right — because `driver-sql` guards for itself
since #5962, not because the analytics layer did — so which rows a widget drew
depended on which compiler downstream caught the leaf, and the `/analytics/sql`
echo described a narrower query than the one that ran.

`filter-normalizer` now emits the guard as tree STRUCTURE (an `or` of the null
predicate with the comparison) rather than as a SQL trick in one strategy, so
all three compilers of that tree produce one predicate and none of them needs
to know the rule. Which operators are guarded is decided by the polarity table
the `$not` rewrite already consults, not by a second list of operator names:
positive comparisons (`$eq`, `$in`, `$contains`, the ordering family) compile
byte-identically to before, `$ne: null` stays `IS NOT NULL`, an empty `$nin`
stays the TRUE constant, and `{$not: {stage: {$ne: 'won'}}}` still means
"stage is won" rather than widening.

`FILTER_LOGIC_CASES` is unchanged: the `$ne` and `$not` null rows enrol in
#5903's PR, which clears the last backend (`driver-turso` remote). The spec
table's measured blocker matrix drops the Cube row it no longer describes.
