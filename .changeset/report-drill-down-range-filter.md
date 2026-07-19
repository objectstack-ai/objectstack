---
'@objectstack/core': minor
'@objectstack/service-analytics': minor
---

feat(analytics): emit a half-open date-range drill scope for granularity-bucketed date dimensions (#1752)

A report/dashboard cell grouped by a `dateGranularity` date dimension ("2026-Q2")
covers a SPAN of records, so drilling it needs a range (`>= start AND < nextStart`),
which the equality drill contract (`drillRawRows`) can't express — date dims were
therefore excluded from drill metadata and a drill landed on an unscoped superset.

- **`@objectstack/core`** adds `bucketKeyToCalendarRange(key, granularity)`, the
  inverse of `bucketDateValue`: it turns a canonical bucket key into its half-open
  `[start, end)` calendar span (`YYYY-MM-DD`, `end` exclusive). Pure, timezone-naive
  calendar arithmetic; returns `null` for unbucketable / out-of-range keys so the
  caller falls back to an unscoped (superset) drill rather than emit a wrong bound.
- **`@objectstack/service-analytics`** emits a `drillRanges` sidecar (aligned to
  `rows` by index — the range companion to `drillRawRows`) for `date` +
  `dateGranularity` dimensions, computed from the canonical bucket key in the
  pre-label-resolution snapshot pass. A `datetime` field under a non-UTC reference
  timezone is omitted (host drills a superset) until instant-boundary support
  lands; a tz-naive `date` field is exact under any timezone (ADR-0053).

Consumed by objectui's report drill-through to scope the drilled record list to the
clicked time bucket.
