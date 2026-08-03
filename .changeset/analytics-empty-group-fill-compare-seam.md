---
"@objectstack/service-analytics": minor
---

fix(service-analytics): a measure a query never reported reads 0 for a count/sum on every merge seam (#4708)

A dataset measure carrying its own `filter` runs as a separate grouped
sub-query and is merged back onto the selected dimensions. A `GROUP BY` over a
filtered row set emits **no group at all** for a dimension value the filter
excludes entirely, so the measure comes back **absent**, not `0` — and
`computeDerived` treats an absent operand as unknowable, so every ratio over it
goes null too. The cell then renders blank, which is visually identical to "no
data for this row" and means the opposite.

The bias runs the worst possible way: the rows that blank are the ones whose
numerator matched nothing — the **worst-performing rows**. A `lead_source` that
won nothing rendered as "no data" while one that won everything rendered fine.

The empty-group value is now filled **by aggregate kind** into every measure
column the assembled grid lists but no query reported:

| aggregate | over an excluded group | why |
|:---|:---|:---|
| `count`, `count_distinct` | `0` | "how many rows matched" has an exact answer when the answer is none |
| `sum` | `0` | the identity element of the empty set |
| `avg`, `min`, `max` | stays `null` | genuinely undefined — there is nothing to average |

Filling all five with `0` would trade this lie for its mirror image, reporting a
measurement nobody made, so the kinds are judged separately (via
`emptyGroupValueFor`, shared with the authoring-side coherence checks).

**Only cells are filled, never rows.** A dimension value no query reported at
all has genuinely no data and stays out of the grid.

**What changes beyond the measure-scoped seam.** The fill previously ran before
the `compareTo` merge, and that merge *appends* a row for every bucket the
PREVIOUS window had and this one does not. Every base measure on those rows —
including unfiltered ones — was absent, so a lead source that sold last month
and nothing this month rendered as "no data" instead of `0`: the same worst-row
bias, one merge later. The fill now runs after every merge and covers all base
measures plus their `<measure>__compare` columns.

Widgets that worked around this with `?? 0` in the consumer or a `coalesce` in
the measure can drop it; the coercion belongs in the executor, which is the only
layer that knows which aggregate produced the gap.

**New export.** `fillEmptyGroups(rows, columnAggregates)` is exported from the
package root beside `mergeByDimensions`, so a host assembling a grid outside
`DatasetExecutor` can apply the same aggregate-kind rule rather than
reimplementing it — which is what makes this a `minor` rather than a `patch`.
