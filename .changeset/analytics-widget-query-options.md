---
"@objectstack/spec": patch
"@objectstack/service-analytics": patch
"@objectstack/rest": patch
---

feat(analytics): honour widget `dateGranularity`, `sortBy`/`sortOrder`, and `limit` in the dataset query (#3588)

Three presentation options were accepted by the metadata layer and then dropped
by the analytics query builder. They reached no SQL, produced no error, and the
only way to notice was to read the `sql` a dataset response echoes — so a
dashboard could declare `dateGranularity: 'month'` and quietly render one bar
per record.

- **`dateGranularity` now buckets.** `DatasetSelection` gained an optional
  `dateGranularity`, applied to every selected `date` dimension. Precedence per
  dimension: an explicit `timeDimensions` granularity, then the selection's,
  then the dataset dimension's own default. A widget can bucket a trend by month
  without the dataset committing every other consumer to that granularity.
- **`order` / `limit` / `offset` now apply on every path.** They are applied to
  the ASSEMBLED grid — after measure-scoped sub-queries merge, after `compareTo`
  columns attach, and after derived measures are computed — so a derived measure
  is a valid sort key and the ObjectQL aggregate path (which has no ordering
  grammar, and which native SQL hands every date-bucketed query to) orders
  identically to native SQL. A single-query selection still pushes the window
  down into the statement. An `order` key that names nothing the selection
  projects is now rejected (400) rather than silently ignored.
- **`limit` is deterministic.** Without an `order`, a limit orders by the
  selected dimensions first, so it truncates a reproducible window instead of an
  arbitrary subset.
- **Widget `options` is a contract again.** The four query-affecting keys
  (`dateGranularity`, `sortBy`, `sortOrder`, `limit`) plus `stageOrder` are
  declared on `DashboardWidgetOptionsSchema`, so a typo like `sortDirection` is
  an author-time error. The bag stays open — renderer extras (`icon`, `columns`,
  `striped`, …) pass through untouched.

Two latent bugs surfaced while fixing the above and are fixed here too:

- `order`/`limit` were forwarded to EVERY sub-query. A measure-scoped
  supplementary query selects one measure, so an inherited `ORDER BY` named a
  column it never selected, and an inherited `LIMIT` truncated it before the
  merge — dropping rows from the assembled grid. Nothing hit this only because
  nothing passed `order`.
- The `compareTo` pass built its query by hand and skipped granularity
  resolution, so a month-bucketed primary grid was merged against raw-timestamp
  comparison rows. No dimension key matched and every `<measure>__compare`
  column came back empty.

`ObjectQLStrategy` now also echoes a representative `sql` (with `date_trunc`,
`WHERE`, `ORDER BY`, and `LIMIT`; filter values parameterized, never inlined).
Previously the `sql` field simply vanished from the response whenever a query
was date-bucketed, leaving an author unable to tell "not implemented" from "this
strategy doesn't report".
