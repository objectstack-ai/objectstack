---
"@objectstack/spec": patch
"@objectstack/service-analytics": patch
---

feat(analytics): order the time axis by default, and give reports a sort declaration (#3916)

A matrix report with a date dimension across rendered its columns in arbitrary
order — `2026-07-01, 2026-07-05, …, 2026-07-02`. Declaring `dateGranularity` on
the dataset dimension made the bucket keys *sortable* (`2026-07`, `2026-Q3`)
without making anything *sort* them, and the report author had no way to ask:
`DatasetSelection.order` existed on the wire, but `ReportSchema` had no ordering
field at all (dashboard widgets had their own `options.sortBy` channel; reports
did not). Nothing in the chain supplied an order either — `resolveOrdering`
returned `undefined` unless the selection carried one explicitly, the ObjectQL
aggregate path has no ordering grammar so its buckets came back in Map-insertion
order, and the pivot builds its column headers in row-arrival order.

- **A selected time dimension is now chronological by default.** When a
  selection states no `order` (and no `limit`, whose own fallback already
  ordered by every dimension), each selected dimension the cube types as `time`
  defaults to ASCENDING, in selection order. Bucket keys are minted sort-stable
  precisely so this works — `2026-07` sorts after `2026-06`, `2026-Q3` after
  `2026-Q1`. This lands on both strategy paths: a real `ORDER BY` where native
  SQL serves the query, and the executor's post-pass where a date-bucketed query
  is handed to the ObjectQL path. Null / empty buckets stay last, as everywhere
  else. Deliberately narrow: only time dimensions get a default, so grids with
  nothing wrong with them are not reordered.
- **Reports can declare an ordering.** `ReportSchema.order` (and
  `blocks[].order` for a `joined` report) is a list of `{ by, direction }` sort
  keys, most significant first — an array, not a `Record`, because key order is
  the contract and JSON object key order should not have to be. `by` must name a
  dimension the report groups by (`rows` / `columns`) or a measure it displays
  (`values`); anything else fails at authoring time rather than becoming an
  ordering that silently does nothing. Duplicate keys are rejected. A `joined`
  report orders per block — declaring `order` on the container is an error.
  `reportSelectionOrder()` lowers the list into the `DatasetSelection.order` a
  renderer posts, and returns `undefined` for an empty list so the runtime's own
  defaults still apply.

An explicit `order` still wins outright — the chronological default is a
default, not a policy, so "newest month first" is one declaration away.

`report.order` ships as `planned` + `authorWarn` in the liveness ledger: the
framework half is complete and live (schema, lowering helper, executor), but
objectui's `DatasetReportRenderer` does not yet carry `report.order` into the
selection it posts. The default time-axis ordering needs no renderer change and
is live now.
