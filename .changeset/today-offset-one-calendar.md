---
"@objectstack/service-automation": patch
---

Flow templates: `{TODAY() + n}` and `{TODAY() - n}` now do their day arithmetic on the same calendar they render on (UTC), so the resolved date no longer lands a day off across a DST transition.

The offset branch of the template resolver shifted the day on the **local** calendar (`getDate` / `setDate`) and then rendered the result on the **UTC** one (`toISOString`). `setDate` preserves wall-clock time, so a local day shift moves the underlying instant by exactly n x 24 hours only while every local day in the window is 24 hours long. Across a spring-forward the window is 23 hours and across a fall-back 25, and when that one hour of slack crosses a UTC midnight the rendered date comes out a day early (spring-forward) or a day late (fall-back).

The window is narrow — roughly one hour per DST-observing zone, twice a year — but the values written through it persist: a quote expiration, a follow-up date, a close date. Measured across 34 zones at every 30 minutes of 2026 for offsets `+1` and `-1` (1,191,360 instant-offset pairs), the old spelling disagreed with the UTC day in 190 of them, spread over 24 DST-observing zones; the new spelling disagrees in none.

The same branch serves `{NOW() + n}`, which likewise now moves the instant by exactly n x 24 hours instead of preserving a wall-clock time across the transition.

Nothing else moves. The bare `{TODAY()}` and `{NOW()}` forms never entered this branch and are byte-for-byte unchanged — they already resolved on UTC, and the offset forms now agree with them. This is not a timezone feature: these tokens remain timezone-unaware by design, and whether they should be is a separate question.
