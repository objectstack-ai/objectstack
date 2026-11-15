---
'@objectstack/skills': patch
---

docs(skills): the query skill teaches that a column with no value fails an ordering filter, and where a per-measure filter runs

Clause-②: no
Metadata-protocol: none

objectstack-query's `rules/filters.md` gains the rule that `$gt` / `$gte` / `$lt` / `$lte` / `$between` never match a row whose column is null or absent, in `where`, an aggregation's `filter` and `having` alike, with the `$or` + `$null: true` spelling that keeps those rows; the same section says `null` is not an ordering comparand. `rules/aggregation.md` no longer says a per-measure `filter` always forces the in-memory path: a driver that declares `supports.aggregationFilter` (`driver-sql`; `driver-turso` outside remote mode) runs it in the database, where it answers and is refused as the same condition is in that datasource's `where`, text collation included; on any other driver the engine evaluates it over the scoped rows. Its `having` section says `avg` / `min` / `max` over no rows is `null` and so fails an ordering test. One eval case covers the rule in a measure filter. Two restatements in `filters.md` were removed to pay for the new text: the case-sensitivity paragraph SKILL.md § String Operators carries, and a second `$between` example.
