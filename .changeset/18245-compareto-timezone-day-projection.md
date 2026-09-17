---
'@objectstack/service-analytics': patch
---

fix(service-analytics): resolve `compareTo`'s comparison window on the reference calendar, not UTC

`DatasetExecutor`'s `compareTo` day math carried its own local `parseUTC`/`toISODate` pair
and read every bound on the UTC calendar. The lowered preset window is a pair of INSTANTS
that open and close at the *reference zone's* midnight, so projecting them onto UTC days
moved a boundary in every non-UTC zone — and in opposite directions either side of the
meridian. `this_month` + `compareTo: { kind: 'previousYear' }` frozen at 2026-09-09 compared
30-day September against a 31-day window: `Asia/Shanghai` opened at `2025-08-31`,
`America/New_York` closed at `2025-10-01`. No error, no warning — a slightly-too-wide
comparison leg rendered exactly like a correct one.

The local pair is deleted. The bare-calendar-day arithmetic (year shift, previous-period
length, bucket ordinals) now runs through `@objectstack/core`'s `zonedDateStartToUtcMs` on
its zone-free UTC proxy, and the one seam that turns instants into days — the lowered
window's projection — goes through the same package's `bucketDateKey`, threaded with the
timezone `buildQuery` already resolves the primary pass in. UTC callers are unaffected.
