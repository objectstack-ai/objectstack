---
"@objectstack/driver-memory": patch
---

`driver-memory` analytics: `dateRange: 'today'` no longer counts the first instant of tomorrow (#16179)

`parseDateRangeString('today')` returns the day's start instant and the **next** day's start instant, and the analytics call site compared that upper bound with `$lte`. `nextUtcCalendarDay` widens only a bare `YYYY-MM-DD` and returns `null` for a full timestamp — its documented contract — so the half-open branch was never taken and the window closed at both ends. `'today'` was one day **plus one instant** long: two adjacent day windows overlapped at midnight and a row stamped exactly there was counted in **both**, silently.

Measured through `MemoryAnalyticsService.query()` against the built package, rows at `2026-09-06T00:00:00.000Z` / `2026-09-06T12:00:00.000Z` / `2026-09-07T00:00:00.000Z`, clock frozen inside 2026-09-06:

| `dateRange` | before | after |
|:--|:--|:--|
| `'today'` | all three, including `2026-09-07T00:00:00.000Z` | the first two |
| `['2026-09-06T00:00:00.000Z', '2026-09-07T00:00:00.000Z']` | all three | all three — **unchanged** |

⭐ **An explicit `dateRange: [a, b]` is deliberately untouched.** `$lte` on a caller-written timestamp end is the reading this package publishes today, and narrowing it would silently change what an existing query answers; the repair is confined to what the driver's own preset resolution emits. A bare-day end likewise keeps its whole-day widening (`< nextUtcCalendarDay(day)`).

⚠️ Behaviour change for a caller using `dateRange: 'today'`: a row stamped at exactly the next day's midnight — `00:00:00.000` in the query's timezone — moves out of today's answer and into tomorrow's. That is the double-count being removed, not coverage being lost.
