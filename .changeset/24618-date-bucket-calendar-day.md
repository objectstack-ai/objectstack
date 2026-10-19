---
'@objectstack/objectql': patch
---

fix(objectql): a `date` dimension buckets on its own calendar day under every timezone on the in-memory path, as the SQL pushdown path already did

Clause-②: no (no authorable key, export or signature moves; the in-memory answer for a `date` dimension under a non-UTC zone now equals the stored day, which is what the pushdown path answers)

- **A `Field.date` is a calendar day, not an instant (ADR-0053).** When `engine.aggregate` buckets in memory (any non-UTC `timezone` forces that path), a `groupBy` item with a `dateGranularity` on a field the object declares a `date` is now labelled by that field's own `YYYY-MM-DD`, with no zone. Before, the value was read as that day's UTC midnight and placed on the requested zone's calendar, so in every zone west of UTC each row landed one day early: `2026-10-01` bucketed as `2026-09-30`, and month, quarter and year totals moved across their edges (`POST /api/v1/analytics/query` with `timezone: "America/New_York"` answered `{2026-09: 1, 2026-10: 5, 2026-11: 4}` for six October and four November deliveries).
- **A `datetime` keeps the zone.** An instant still lands on the requested zone's calendar day, unchanged. So does a field the declaration cannot type: `applyInMemoryAggregation` called without its `fields` argument, an undeclared field, or a `formula`.
- **The value is read by the `date` storage rule first** (`temporalStorageForm(value, 'date')` in `@objectstack/core`): a bare `YYYY-MM-DD` is itself, and a `Date` handed back by a driver is its UTC calendar day.
