---
"@objectstack/service-analytics": patch
---

fix(service-analytics): `compareTo` applies measure-scoped filters, so `<measure>__compare` is the same measure as the column beside it (#4820)

A dataset measure declared with its own `filter` is scoped by running a
supplementary grouped sub-query — `combineFilters(baseFilter, measureFilters[m])`
— and merging it back by dimension key. The `compareTo` pass did not: it issued
**one** shifted query over every base measure with only the base filter as its
`where`, and never consulted `compiled.measureFilters` at all.

For a dataset like

```ts
measures: [
  { name: 'revenue',   aggregate: 'sum',   field: 'amount' },
  { name: 'won_count', aggregate: 'count', filter: { stage: 'closed_won' } },
]
```

the current-period column was scoped and the comparison column was not — two
different measures rendered side by side under one label:

| # | measures | where | |
|:---|:---|:---|:---|
| 1 | `revenue` | — | current |
| 2 | `won_count` | `{"stage":"closed_won"}` | current |
| 3 | `revenue`, `won_count` | **absent** | shifted |

`won_count__compare` was therefore a count of **every** opportunity in the
previous window, inflated by exactly the rows the measure exists to exclude.
The error runs one way: the comparison period always looks better, so a "won
deals vs. last month" tile reads as a collapse when nothing went wrong. Only
filter-scoped measures were affected — the unfiltered ones next to them compared
correctly, which is what made it survive.

The comparison window now runs the **same pass** as the current period —
unfiltered measures in one shifted query plus one shifted sub-query per
filter-scoped measure, merged by dimension key — through a single shared
implementation, so the two paths cannot re-diverge at the next change. The
dataset filter, the presentation's `runtimeFilter` and the measure's own filter
compose identically in both windows; the only difference between them is the
shifted `dateRange`.

Numbers reported by existing dashboards change where a filtered measure was
compared: with 3 won deals this month against 1 won of 5 opportunities last
month, `won_count__compare` was `5` and is now `1`.

Cost: one extra query per filter-scoped measure when `compareTo` is set.
Selections whose measures carry no filter are untouched and still compare in a
single shifted query.

The empty-group fill (#4708) covers the new seam: a group the measure's filter
empties in the *previous* window now reports `0` for a `count`/`sum` compare
column rather than blanking it, exactly as it already did for the current period.
