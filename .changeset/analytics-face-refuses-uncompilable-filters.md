---
"@objectstack/driver-memory": minor
---

fix(driver-memory): the analytics (cube) face REFUSES a filter it cannot compile instead of silently dropping it (#5345)

**This is an observable behaviour change on a shipped surface, and it will turn
some working-looking dashboards red.** That is the point: the widgets it breaks
were returning inflated aggregates, and some of them were returning rows the
caller had no permission to read.

## What was happening

`MemoryAnalyticsService` lowers `AnalyticsQuery.where` into a flat, cube-style
`{member, operator, values}` list. Anything that did not fit was answered with
`continue` — in two places, and with a comment presenting it as a feature
("ignore so a partial query still runs rather than failing entirely"):

| dropped | why it did not fit |
|---|---|
| `$or` (whole branch) | no expression in a flat AND-list |
| `$not` (whole branch) | same |
| `$between` | no row in the mongo→cube operator table |
| `$startsWith` / `$endsWith` | same |
| `$null` | same |
| `$regex` | same — and `plugin-auth`'s ObjectQL adapter emits it |

Dropping a predicate does not narrow a query, it **widens** it: fewer
constraints means more rows. A widget filtered to two stages with
`{$or: [{stage: 'won'}, {stage: 'lost'}]}` aggregated the **entire table** and
rendered as a perfectly normal chart. Measured on the shared
`FILTER_LOGIC_CASES` fixture, **15 of its 17 cases** returned a wider row set
than the standard specifies — usually every row. Of the two that did agree, one
(`a $or nested under a top-level $and`) agreed by *coincidence*: its dropped
`$or` happened to be redundant against a surviving sibling key, which is the
best illustration available of why "the number looked right" was never evidence.

`$not` makes it more than a wrong number. `cel-to-filter.ts` compiles a CEL
`!expr` RLS read scope into `{$not: {…}}`, so the dropped branch was the read
scope itself — the aggregate included records the caller is not allowed to see.

## What changes for you

A `where` carrying any of the shapes above now raises **`INVALID_FILTER` / 400**
(the ADR-0112 envelope every sibling filter refusal in this driver already
speaks, reaching REST callers as a 400 since #5366) naming the offending
operator or combinator and its position, e.g.:

> Filter operator `"$between"` on field `"amount"` at `where.amount` is declared
> by the Filter Protocol but cannot be compiled by driver-memory's analytics
> (cube) face. Supported operators on this surface: `$eq, $ne, $gt, $gte, $lt,
> $lte, $in, $nin, $contains, $notContains, $exists`.

Both entry points refuse identically — `query()` and `generateSql()`.

**The fix, per shape:**

- `$between` on a range → the two bounds, which this face has always compiled:
  `{ closed_at: { $gte: '2026-01-01', $lte: '2026-01-31' } }`, or a
  `timeDimensions[].dateRange`, which is unaffected.
- `$startsWith` / `$endsWith` / `$regex` → `$contains`, or move the query to
  `find()`.
- `$null` → `{ field: { $exists: false } }` for the absent case.
- `$or` / `$not` → restate as the implicit AND of field keys where the intent
  allows it; where it does not, the cube pipeline genuinely cannot express it,
  and the query belongs on `find()`.

Nothing that was **compiled** changes. All eleven supported operators, `$and`,
implicit equality, nested-relation flattening, time dimensions and the empty
filter produce byte-identical pipelines.

## Why refuse rather than teach the cube pipeline `$or`

This is the call ADR-0078 / #4286 made for `objectql`'s `having` — an ignored
operator there "silently returns UNFILTERED aggregates", so it throws — and the
posture #3948 established for every filter backend: a filter that cannot be
compiled is refused loudly, never skipped. It is also where the two neighbouring
faces landed (#5366, #5368).

Mechanically, the refusal is not a new check bolted onto this face. It reuses
the package's single filter gate, `assertFilterConditionShape`, which now takes
the calling face's declared capabilities; and the analytics face derives those
capabilities from its own mongo→cube operator table, so widening what it accepts
and teaching it to compile the operator are now the same edit. The shared
`FILTER_LOGIC_CASES` conformance table covers this third face for the first time
(it watched only two of the driver's three), holding it to: agree with
`find()`, or refuse — never a third, quieter answer.
