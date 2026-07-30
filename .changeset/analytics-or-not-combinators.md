---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a `$or` / `$not` filter no longer vanishes from an analytics query (#4128 follow-up)

The last of the silently-dropped filter family. `normalizeAnalyticsFilters`
produced a flat **array**, which cannot carry a disjunction, so both strategies
skipped `$or` and `$not` outright — a widget or dataset whose filter used
either compiled a WHERE clause that simply did not contain it, and drew every
row. That is #3650's symptom, and unlike a rejected query it looks like a
working chart.

The normalizer now produces a **tree** (`normalizeAnalyticsFilterTree`), and
each strategy compiles it the way its own backend expresses a disjunction:

- **`NativeSQLStrategy`** builds the WHERE recursively, routing every leaf
  through its existing clause emitter — so the storage-form coercion and the
  calendar-day upper-bound rule (#3777) apply at every depth, including inside
  an `$or`. Parentheses are explicit rather than relying on SQL precedence.
- **`ObjectQLStrategy`** hands `$or` / `$not` to the engine, which speaks them
  natively. AND-ed leaves still merge per field exactly as before, so a query
  without combinators produces byte-identical engine input.
- **`/analytics/sql`** renders the same tree, so the echoed statement keeps
  reproducing what executes rather than showing a conjunction where the engine
  runs a disjunction.
- The **cross-object envelope check** now sees members nested inside an `$or`.
  It rejects cross-object filters, so a member it could not see was a filter it
  could not reject.

Empty `$and` / `$or` arrays now throw instead of being ignored, matching the
fail-closed stance of `read-scope-sql.ts` — the compiler in this same package
that has always handled the full tree, and whose semantics the tree walker now
mirrors deliberately.

Cover is `native-sql-filter-logic-conformance.test.ts`, which runs the shared
combinator table (`FILTER_LOGIC_CASES`, #3774) against a real SQLite engine and
asserts row ids. The analytics raw-SQL path now stands beside `driver-sql`,
`driver-memory`, `formula` and `read-scope-sql` under that one standard; 14 of
its 17 cases fail without this change.
