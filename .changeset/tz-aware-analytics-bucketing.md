---
"@objectstack/core": minor
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/service-analytics": minor
---

feat(analytics): timezone-aware date bucketing (ADR-0053 Phase 2)

Analytics day/week/month/quarter/year buckets now resolve on a **reference timezone's** calendar days, so a row near a tz day-boundary lands in the bucket a user in that zone would expect — identically on SQLite and Postgres.

Per ADR-0053 decision **D2**, bucketing is done **in-memory, uniformly** for non-UTC zones rather than emitting dialect-specific `date_trunc … AT TIME ZONE` (SQLite has no tz database and MySQL needs tz tables loaded, so splitting by dialect would shift bucket boundaries for the same data). `engine.aggregate({ timezone })` therefore forces the in-memory aggregation path when a non-UTC reference tz is set — the date-range `where` still goes to the driver, so only matching rows are fetched. **UTC / unset keeps the native driver fast path unchanged.**

- New shared `calendarPartsInTz` / `calendarPartsInTzOrUtc` util in `@objectstack/core` (DST-safe via `Intl.DateTimeFormat`, never hand-rolled offset math; falls back to UTC for an unset/`'UTC'`/invalid zone).
- `EngineAggregateOptions` and the analytics `executeAggregate` bridge / `ObjectQLStrategy` thread the reference timezone (sourced from the dataset selection / `ExecutionContext`) through to `applyInMemoryAggregation` → `bucketDateValue`, and the draft-preview evaluator's `bucketDate`.
- `formatDateBucket` (dimension labels) stays UTC-only by design: it re-labels values that were *already* bucketed upstream, so re-applying a timezone there would shift a correct bucket by a day.
