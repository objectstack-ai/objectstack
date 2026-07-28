---
"@objectstack/spec": minor
---

feat(spec): `ListColumn` gains `prefix` and the `{ type, field }` `summary` form (objectui#2231)

Two list-column capabilities the ObjectUI grid renderer has shipped for a while
were missing from the protocol, so they lived on as a local `.extend()` in
`@object-ui/types` — the exact fork-shaped drift objectui#2231 is closing. Both
are now spec-owned:

- **`prefix`** (`ColumnPrefixSchema`) — Airtable-style compound cells: render a
  second field inline before the cell value (e.g. a status badge in front of the
  record name), so a list carries two signals in one column.
  `{ field, type?: 'badge' | 'text' }`, `type` defaulting to `'text'`.
- **`summary` object form** (`ColumnSummaryConfigSchema`) — `{ type, field? }`,
  for a footer that aggregates a field OTHER than the column's own (an `amount`
  column summing `amount_in_base_currency`). The shorthand `summary: 'sum'` is
  unchanged and remains the common case. `type` reuses `ColumnSummarySchema`, so
  both forms share one aggregation vocabulary and cannot drift apart.

Additive and backward compatible: every previously valid `ListColumn` still
parses. New exports: `ColumnPrefixSchema` / `ColumnPrefix` and
`ColumnSummaryConfigSchema` / `ColumnSummaryConfig`.
