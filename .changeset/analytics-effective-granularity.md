---
"@objectstack/service-analytics": patch
---

fix(analytics): apply the EFFECTIVE date granularity to bucket labels and drill ranges (#3588 follow-up)

`selection.dateGranularity` (shipped in #3652) reached the `GROUP BY` but not the
post-processing: the bucket-label formatter and the drill-range inverter both
kept reading the DATASET dimension's default. A query was grouped one way and
described another. Found by driving a real dashboard query in a browser against
a dataset whose dimension declares `dateGranularity: 'month'`:

- selection `year` → the row came back labelled **`1970-01`** — a year bucket
  re-formatted with the dataset's month granularity, its `"2026"` key re-read as
  2026 *milliseconds* past the epoch;
- selection `day` → day buckets were re-labelled as months, so ten distinct days
  collapsed into two duplicated keys;
- selection `quarter` / `year` / `day` / `week` → `drillRanges` came back empty,
  silently removing drill-through from every bucketed chart.

Granularity precedence now lives in one exported function,
`resolveDimensionGranularity`, called from all three sites that must agree — the
query's `GROUP BY`, the label formatter, and the range inverter. The drift was
possible only because each site resolved it independently.

Two consequences beyond the override case:

- A dataset dimension that declares **no** granularity but is bucketed by the
  widget now gets drill ranges too. Previously the range sidecar keyed off the
  dataset's own `dateGranularity`, so this case — the one #3588 is actually
  about — could never drill.
- `formatDateBucket` no longer mistakes a bare year key for an epoch timestamp.
  A year bucket's canonical key IS `"2026"`, which is the only bucket key that
  collides with the pure-digit epoch heuristic (`"2026-Q2"`, `"2026-07"` and
  `"2026-07-15"` all fail it). Being idempotent over already-formatted keys is
  that function's stated contract; the year case just never held.
