---
'@objectstack/service-analytics': patch
---

fix(analytics): a field constraint mixing `$` operators with non-`$` sibling keys is refused (400 `INVALID_FILTER`), not silently narrowed to its operators

**Observable behaviour change.** A `where` field wrapper that carries `$`-operator
keys and non-`$` keys at once used to compile its operators and silently DROP
every non-`$` sibling. It is now refused with `INVALID_FILTER` / 400, the
envelope every other refusal at this door already carries. Ruled Option A
(refuse) on #6444, 2026-08-08; Option B (flattening the siblings as nested
paths) was rejected because it would compile the likely-real cause — a dropped
`$` — into a predicate on a non-existent member such as `amount.gte`.

| `where` | used to normalize to | reading |
|---|---|---|
| `{d: {$eq: 1, nested: 'x'}}` | `d equals [1]` | the `nested` conjunct vanished in silence |
| `{amount: {gte: 10, $lte: 20}}` | `amount lte 20` | the missing-`$` typo: the lower bound silently gone |
| `{$not: {d: {$null: true, nested: 'x'}}}` | `NOT(d set AND d notSet)` | a contradiction that negates to TRUE — every row |

Every row WIDENED the query — a dropped conjunct returns rows the author
excluded, with nothing to read (the #3650 family this module refuses everywhere
else). Unlike #6386's `undefined` comparand, this shape survives JSON, so it can
sit in stored dashboard / report / dataset metadata as well as in-process
callers of `AnalyticsService.query({ where })`.

**What to change if this refuses your filter.** The message names the offending
key(s) and both repairs, because the shape has two readings this door cannot
tell apart:

- an operator missing its `$` was meant → spell it with the prefix
  (`gte` → `$gte`: `{ "amount": { "$gte": 10, "$lte": 20 } }`);
- a nested-relation member was meant → give it a wrapper of its own with no `$`
  siblings (`{ "d": { "nested": "x" } }` compiles to the member `d.nested`) and
  AND it with the operator constraint explicitly via `$and`.

⛔ **The two pure shapes do not move.** A wrapper that is all `$`-operators
compiles exactly as before (`{amount: {$gte: 10, $lte: 20}}` stays the AND of
its bounds), and a wrapper that is all non-`$` keys keeps flattening to the
dotted member (`{d: {nested: 'x'}}` → `d.nested`). `$null` / `$exists` flag
semantics, the `null` comparand rulings (#5332 / #5526) and the sibling door
`read-scope-sql.ts` — which has always failed closed on this shape — are
untouched.
