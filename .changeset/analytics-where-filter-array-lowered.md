---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a `where` written as a `FilterArray` is lowered instead of silently dropped (#5334)

**Observable behaviour change.** An analytics query whose `where` arrived as an
ARRAY had its filter **deleted**: `normalizeAnalyticsFilterTree` answered every
array with `return null`, so no predicate was compiled, no error was raised, and
the widget charted the **entire dataset**. The compiled SQL stayed perfectly
valid — just broader than the author asked for — which is why it was invisible
to every test that asserts a SQL string. The issue's own measurement:
`generateSql({cube:'deals', measures:['total'], dimensions:['id'], where:
[['stage','=','won']]})` emitted `SELECT id AS "id", COUNT(*) AS "total" FROM
"deal" GROUP BY id` with an empty `params`. It now emits the bound `WHERE` and
returns the two won deals.

`FilterArray` (`['stage','=','won']`, `['and', […], […]]`, `[[…], […]]`) is
INPUT-ONLY authoring sugar (#5285), and #5158's ruling C says every door into
the runtime lowers it through the single `parseFilterAST` sink before anything
downstream sees a filter. #5329 closed ObjectQL's six entry points that way and
deleted the four drivers' private array dialects. Analytics is the **fifth
door**: it compiles `where` itself — to SQL (`NativeSQLStrategy`) or to a
`FilterCondition` for the engine (`ObjectQLStrategy`) — so nothing upstream
lowers for it. It now gives the same three answers the engine door gives:

- `[]` — "no filter", not a failed filter: no predicate, no error (unchanged).
- A well-formed `FilterArray` — **lowered** through `parseFilterAST`, so both
  spellings of one filter select the same rows on both strategies.
- Any other non-empty array — **refused** with `INVALID_FILTER` / 400
  (ADR-0112), the envelope the drivers' `filterArrayReachedDriverError` uses.
  This is where the undeclared INFIX form (`[condA, 'or', condB]`) lands, and
  where a list of `FilterCondition` objects (`[{stage:'won'}]`) lands — neither
  is a `FilterArray`, `parseFilterAST` has no lowering for either, and dropping
  them is what returned the unfiltered dataset.

Lowering rather than refusing keeps one dashboard's metadata meaning one thing:
the same `where` on a plain `find()` already lowers at the engine door, so
refusing it here would have forked the product by which face read the metadata.
