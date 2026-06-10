---
"@objectstack/service-analytics": minor
---

Analytics now renders date dimensions as human bucket labels instead of raw
epoch millis, and buckets them by their declared granularity.

- A date dimension with an explicit `dateGranularity` is now grouped by that
  bucket (the executor promotes it to a time dimension), so a "monthly" trend
  chart shows one point per month rather than one per raw timestamp.
- Grouped date values are formatted to a sort-stable label per granularity
  (`year` → `2026`, `quarter` → `2026-Q2`, `month` → `2026-04`, `day`/`week`
  → `2026-04-15`), so charts no longer show `1777632968596`.

Pairs with the dimension display-label resolution (select option labels / lookup
names) shipped previously.
